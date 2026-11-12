import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { MediaHealthCollector } from './media-health.collector'
import { RequestPerformanceInterceptor } from './request-performance.interceptor'
import { RequestPerformanceMetrics } from './request-performance-metrics'
import { SystemResourceIo, SystemResourceSampler } from './system-resource-sampler'
import { SystemStatusController } from './system-status.controller'
import { SystemStatusService } from './system-status.service'

@Module({
  imports: [PrismaModule],
  controllers: [SystemStatusController],
  providers: [
    SystemResourceIo,
    SystemResourceSampler,
    RequestPerformanceMetrics,
    MediaHealthCollector,
    SystemStatusService,
    {
      // 全局拦截器：记录通过 Guard 的业务请求耗时；health 与状态页自身在拦截器内排除。
      provide: APP_INTERCEPTOR,
      useClass: RequestPerformanceInterceptor,
    },
  ],
})
export class SystemStatusModule {}
