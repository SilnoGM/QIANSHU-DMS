import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '../../generated/prisma/client'

const DATABASE_POOL_MAX = 10
const DATABASE_CONNECTION_TIMEOUT_MS = 5_000
const DATABASE_QUERY_TIMEOUT_MS = 5_000
const DATABASE_INITIALIZATION_ERROR_MESSAGE = 'Database initialization failed'
const DATABASE_SHUTDOWN_ERROR_MESSAGE = 'Database shutdown failed'
const DATABASE_IDLE_ERROR_MESSAGE = 'PostgreSQL idle client emitted an error'

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name)
  private readonly pool: Pool

  constructor(configService: ConfigService) {
    const connectionString =
      configService.getOrThrow<string>('DATABASE_URL')
    const pool = new Pool({
      connectionString,
      max: DATABASE_POOL_MAX,
      connectionTimeoutMillis: DATABASE_CONNECTION_TIMEOUT_MS,
      query_timeout: DATABASE_QUERY_TIMEOUT_MS,
    })

    // PrismaPg 接管查询适配，但外部创建的 Pool 仍由本服务明确管理完整生命周期。
    super({ adapter: new PrismaPg(pool) })
    this.pool = pool

    // idle client 错误可能携带连接信息；应用日志只保留固定、可告警的安全文本。
    this.pool.on('error', () => {
      this.logger.error(DATABASE_IDLE_ERROR_MESSAGE)
    })
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect()
    } catch {
      // NestFactory 尚未返回 application 时，外层无法调用 close；服务必须自行收口部分初始化资源。
      await this.releaseDatabaseResources()
      throw new Error(DATABASE_INITIALIZATION_ERROR_MESSAGE)
    }
  }

  async onModuleDestroy(): Promise<void> {
    const cleanupFailed = await this.releaseDatabaseResources()

    if (cleanupFailed) {
      // Nest 会记录 shutdown hook 异常堆栈；必须创建无 cause 的固定错误，避免泄露驱动详情。
      throw new Error(DATABASE_SHUTDOWN_ERROR_MESSAGE)
    }
  }

  private async releaseDatabaseResources(): Promise<boolean> {
    let cleanupFailed = false

    try {
      await this.$disconnect()
    } catch {
      cleanupFailed = true
    }

    try {
      // PrismaPg 默认不会关闭外部 Pool，因此即使 disconnect 失败也必须继续显式释放。
      await this.pool.end()
    } catch {
      cleanupFailed = true
    }

    return cleanupFailed
  }
}
