import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type {
  INestApplication,
  NestApplicationOptions,
  Type,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger'

import { API_PREFIX } from '../app.constants'
import { ApiError } from '../infrastructure/http/api-error.dto'
import {
  MISSING_OPERATION_ID_PREFIX,
  OPENAPI_TITLE,
  OPENAPI_VERSION,
} from './openapi.constants'

export function missingOperationIdFactory(
  controllerKey: string,
  methodKey: string,
  version?: string,
): string {
  return `${MISSING_OPERATION_ID_PREFIX}${controllerKey}_${methodKey}${version ?? ''}`
}

export type OpenApiApplicationFactory = (
  rootModule: Type<unknown>,
  options: NestApplicationOptions,
) => Promise<INestApplication>

const defaultApplicationFactory: OpenApiApplicationFactory = (
  rootModule,
  options,
) => NestFactory.create(rootModule, options)

function readServerPackageVersion(): string {
  // src/openapi 与编译后的 dist/openapi 到 server/package.json 都恰好是两级目录。
  const packageJson = JSON.parse(
    readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
  ) as { version?: unknown }

  if (typeof packageJson.version !== 'string') {
    throw new Error('Server package version is missing')
  }

  return packageJson.version
}

/**
 * 通过 preview application 扫描 Controller metadata，不初始化监听端口。
 * 无论文档扫描成功或抛错，都必须关闭已创建应用，避免测试与离线生成器泄漏资源。
 */
export async function createOpenApiDocument(
  rootModule: Type<unknown>,
  applicationFactory: OpenApiApplicationFactory = defaultApplicationFactory,
): Promise<OpenAPIObject> {
  const application = await applicationFactory(rootModule, {
    preview: true,
  })

  try {
    application.setGlobalPrefix(API_PREFIX)
    const configuration = new DocumentBuilder()
      .setOpenAPIVersion(OPENAPI_VERSION)
      .setTitle(OPENAPI_TITLE)
      .setVersion(readServerPackageVersion())
      .addTag('health')
      .build()

    return SwaggerModule.createDocument(application, configuration, {
      extraModels: [ApiError],
      operationIdFactory: missingOperationIdFactory,
    })
  } finally {
    await application.close()
  }
}
