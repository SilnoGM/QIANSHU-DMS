import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { DatabaseHealthIndicator } from './database-health.indicator'
import { HealthController } from './health.controller'

@Module({
  imports: [
    TerminusModule.forRoot({
      // Terminus 默认会记录包含 indicator 详情的失败日志；API 只需返回脱敏的 503 状态体。
      logger: false,
    }),
  ],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator],
})
export class HealthModule {}
