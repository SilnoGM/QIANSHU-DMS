import type { Type } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import type { SeedCommandOptions } from './seed.runner'
import type { SeedRunResult } from './seed.service'
import { SeedService } from './seed.service'

export interface SeedCliApplication {
  get<T>(type: Type<T>): T
  close(): Promise<void>
}

export type CreateSeedApplication = () => Promise<SeedCliApplication>

export const createSeedApplication = async (): Promise<SeedCliApplication> => {
  // CLI 编排层会被无数据库环境的单元测试导入；仅在真正执行时加载 Module，
  // 环境校验仍在 Nest 初始化前后于真实启动路径内完成。
  const { SeedModule } = await import('./seed.module')
  return NestFactory.createApplicationContext(SeedModule, {
    abortOnError: false,
    logger: false,
  })
}

export async function runSeedCli(
  options: SeedCommandOptions,
  createApplication: CreateSeedApplication = createSeedApplication,
): Promise<SeedRunResult> {
  const application = await createApplication()
  try {
    return await application.get(SeedService).run({ apply: options.apply })
  }
  finally {
    await application.close()
  }
}
