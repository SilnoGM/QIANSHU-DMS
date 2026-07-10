import { Injectable } from '@nestjs/common'
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus'

import { PrismaService } from '../../infrastructure/database/prisma.service'

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy<Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const indicator = this.healthIndicatorService.check(key)

    try {
      // 常量 tagged query 不接收外部输入，也没有插值参数，避免健康探测引入 SQL 注入面。
      await this.prisma.$queryRaw`SELECT 1`
      return indicator.up()
    } catch {
      // 驱动异常可能携带连接串、SQL 或服务器详情；健康响应只暴露固定 down 状态。
      return indicator.down()
    }
  }
}
