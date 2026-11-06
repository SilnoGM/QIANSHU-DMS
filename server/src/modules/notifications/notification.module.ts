import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { AssistantAdminController } from './assistant-admin.controller'
import { AssistantAdminService } from './assistant-admin.service'
import { AssistantDispatchService } from './assistant-dispatch.service'
import { GeweAssistantAdminTransport } from './gewe-assistant-admin.transport'
import { GeweAssistantTransport } from './gewe-assistant.transport'
import { ASSISTANT_ADMIN_TRANSPORT, ASSISTANT_TRANSPORT, ASSISTANT_TRANSPORT_OPTIONS } from './notification.types'
import { SystemNotificationService } from './system-notification.service'

/**
 * 通知中心基础模块。
 *
 * 阶段 1 只提供发布入口与千树小助理派发；管理端 Controller 与站内渠道在后续批次接入。
 * PrismaModule 与 ConfigModule 都是全局模块，不需要在这里重复导入。
 */
@Module({
  imports: [AuthModule],
  controllers: [AssistantAdminController],
  providers: [
    SystemNotificationService,
    AssistantAdminService,
    GeweAssistantTransport,
    GeweAssistantAdminTransport,
    {
      provide: ASSISTANT_TRANSPORT,
      useExisting: GeweAssistantTransport,
    },
    {
      provide: ASSISTANT_ADMIN_TRANSPORT,
      useExisting: GeweAssistantAdminTransport,
    },
    {
      provide: ASSISTANT_TRANSPORT_OPTIONS,
      useValue: {},
    },
    AssistantDispatchService,
  ],
  exports: [SystemNotificationService],
})
export class NotificationModule {}
