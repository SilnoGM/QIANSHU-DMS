import {
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Module, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestApplication, NestFactory } from '@nestjs/core'
import pg from 'pg'

const mockPrismaServiceConstructor = jest.fn()

jest.mock('../infrastructure/database/prisma.service', () => {
  const actualModule = jest.requireActual<
    typeof import('../infrastructure/database/prisma.service')
  >('../infrastructure/database/prisma.service')
  const observedPrismaService = new Proxy(actualModule.PrismaService, {
    construct(target, argumentsList, newTarget) {
      mockPrismaServiceConstructor(...argumentsList)
      return Reflect.construct(target, argumentsList, newTarget) as object
    },
  })

  // Proxy 不会自动继承 class-level metadata；完整复制后 Nest 才能真实校验 ConfigService 依赖图。
  for (const metadataKey of Reflect.getMetadataKeys(
    actualModule.PrismaService,
  )) {
    Reflect.defineMetadata(
      metadataKey,
      Reflect.getMetadata(metadataKey, actualModule.PrismaService),
      observedPrismaService,
    )
  }

  return {
    ...actualModule,
    PrismaService: observedPrismaService,
  }
})

import { PrismaService } from '../infrastructure/database/prisma.service'
import { PrismaModule } from '../infrastructure/database/prisma.module'
import { OpenApiModule } from './openapi.module'

@Module({ imports: [PrismaModule] })
class MissingConfigModule {}

interface EnvironmentValue {
  present: boolean
  value: string | undefined
}

function captureEnvironmentValue(name: string): EnvironmentValue {
  return {
    present: Object.hasOwn(process.env, name),
    value: process.env[name],
  }
}

function restoreEnvironmentValue(
  name: string,
  original: EnvironmentValue,
): void {
  if (original.present) {
    process.env[name] = original.value
    return
  }

  delete process.env[name]
}

describe('OpenApiModule', () => {
  const originalDatabaseUrl = captureEnvironmentValue('DATABASE_URL')
  const originalDotenvConfigPath = captureEnvironmentValue(
    'DOTENV_CONFIG_PATH',
  )

  beforeEach(() => {
    mockPrismaServiceConstructor.mockClear()
    delete process.env.DATABASE_URL
    process.env.DOTENV_CONFIG_PATH = '/dev/null'
  })

  afterAll(() => {
    restoreEnvironmentValue('DATABASE_URL', originalDatabaseUrl)
    restoreEnvironmentValue(
      'DOTENV_CONFIG_PATH',
      originalDotenvConfigPath,
    )
  })

  it('preserves the PrismaService constructor injection metadata on the observed class', () => {
    expect(
      Reflect.getMetadata('design:paramtypes', PrismaService) as unknown,
    ).toEqual([ConfigService])
  })

  it('keeps Nest dependency validation active when ConfigService is missing', async () => {
    const createAndClosePreview = async (): Promise<void> => {
      const application = await NestFactory.create(
        MissingConfigModule,
        {
          preview: true,
          logger: false,
          abortOnError: false,
        },
      )
      await application.close()
    }

    await expect(createAndClosePreview()).rejects.toThrow(
      /ConfigService/,
    )
  })

  it('isolates the preview module from a canary .env during a fresh import', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'qianshu-openapi-import-'),
    )
    const originalCwd = process.cwd()
    const databaseUrl = captureEnvironmentValue('DATABASE_URL')
    const dotenvConfigPath = captureEnvironmentValue(
      'DOTENV_CONFIG_PATH',
    )
    const canaryDatabaseUrl =
      'postgresql://canary:must-not-load@127.0.0.1:5432/canary'
    let application: INestApplication | undefined
    let moduleInitSpy: jest.SpyInstance | undefined
    let connectSpy: jest.SpyInstance | undefined
    let poolConstructorSpy: jest.SpyInstance | undefined
    let listenSpy: jest.SpyInstance | undefined

    try {
      await writeFile(
        join(temporaryDirectory, '.env'),
        `DATABASE_URL=${canaryDatabaseUrl}\n`,
        'utf8',
      )
      delete process.env.DATABASE_URL
      delete process.env.DOTENV_CONFIG_PATH
      process.chdir(temporaryDirectory)
      mockPrismaServiceConstructor.mockClear()

      await jest.isolateModulesAsync(async () => {
        const isolatedPg = (await import('pg')).default
        const isolatedNestCore = await import('@nestjs/core')
        const isolatedConfig = await import('@nestjs/config')
        const isolatedPrismaModule = await import(
          '../infrastructure/database/prisma.service'
        )
        poolConstructorSpy = jest.spyOn(isolatedPg, 'Pool')
        listenSpy = jest.spyOn(
          isolatedNestCore.NestApplication.prototype,
          'listen',
        )
        moduleInitSpy = jest.spyOn(
          isolatedPrismaModule.PrismaService.prototype,
          'onModuleInit',
        )
        connectSpy = jest.spyOn(
          isolatedPrismaModule.PrismaService.prototype,
          '$connect',
        )
        const originalParameterTypes = Reflect.getMetadata(
          'design:paramtypes',
          isolatedPrismaModule.PrismaService,
        ) as unknown

        // isolateModules 为 ConfigService 创建独立 class token；测试 Proxy 需对齐该 token，等价于真实 fresh process 的 metadata 身份。
        Reflect.defineMetadata(
          'design:paramtypes',
          [isolatedConfig.ConfigService],
          isolatedPrismaModule.PrismaService,
        )

        try {
          const isolatedOpenApiModule = await import(
            './openapi.module'
          )

          application = await isolatedNestCore.NestFactory.create(
            isolatedOpenApiModule.OpenApiModule,
            {
              preview: true,
              logger: false,
              abortOnError: false,
            },
          )
          await application.close()
          application = undefined

          expect(typeof isolatedOpenApiModule.OpenApiModule).toBe(
            'function',
          )
        } finally {
          Reflect.defineMetadata(
            'design:paramtypes',
            originalParameterTypes,
            isolatedPrismaModule.PrismaService,
          )
        }
      })

      expect(process.env.DATABASE_URL).toBeUndefined()
      expect(
        Object.values(process.env).includes(canaryDatabaseUrl),
      ).toBe(false)
      expect(mockPrismaServiceConstructor).not.toHaveBeenCalled()
      expect(moduleInitSpy).not.toHaveBeenCalled()
      expect(connectSpy).not.toHaveBeenCalled()
      expect(poolConstructorSpy).not.toHaveBeenCalled()
      expect(listenSpy).not.toHaveBeenCalled()
    } finally {
      await application?.close()
      moduleInitSpy?.mockRestore()
      connectSpy?.mockRestore()
      poolConstructorSpy?.mockRestore()
      listenSpy?.mockRestore()
      process.chdir(originalCwd)
      restoreEnvironmentValue('DATABASE_URL', databaseUrl)
      restoreEnvironmentValue(
        'DOTENV_CONFIG_PATH',
        dotenvConfigPath,
      )
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it('creates the complete preview graph without constructing or starting database and HTTP resources', async () => {
    const moduleInitSpy = jest.spyOn(
      PrismaService.prototype,
      'onModuleInit',
    )
    const connectSpy = jest.spyOn(PrismaService.prototype, '$connect')
    const poolConstructorSpy = jest.spyOn(pg, 'Pool')
    const listenSpy = jest.spyOn(NestApplication.prototype, 'listen')
    let application: INestApplication | undefined

    try {
      application = await NestFactory.create(OpenApiModule, {
        preview: true,
        logger: false,
        abortOnError: false,
      })
      await application.close()
      application = undefined

      expect(mockPrismaServiceConstructor).not.toHaveBeenCalled()
      expect(moduleInitSpy).not.toHaveBeenCalled()
      expect(connectSpy).not.toHaveBeenCalled()
      expect(poolConstructorSpy).not.toHaveBeenCalled()
      expect(listenSpy).not.toHaveBeenCalled()
    } finally {
      await application?.close()
      moduleInitSpy.mockRestore()
      connectSpy.mockRestore()
      poolConstructorSpy.mockRestore()
      listenSpy.mockRestore()
    }
  })
})
