import { Global, Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { AssistantAdminController } from './assistant-admin.controller'
import { AssistantAdminService } from './assistant-admin.service'
import { NotificationAdminController } from './notification-admin.controller'
import { NotificationAdminService } from './notification-admin.service'
import { NotificationInboxController } from './notification-inbox.controller'
import { NotificationInboxService } from './notification-inbox.service'
import { AssistantDispatchService } from './assistant-dispatch.service'
import { GeweAssistantAdminTransport } from './gewe-assistant-admin.transport'
import { GeweAssistantTransport } from './gewe-assistant.transport'
import { ASSISTANT_ADMIN_TRANSPORT, ASSISTANT_TRANSPORT, ASSISTANT_TRANSPORT_OPTIONS } from './notification.types'
import { SystemNotificationService } from './system-notification.service'

/**
 * 通知中心基础模块。
 *
 * 发布入口、千树小助理派发、站内收件箱与管理端共用同一通知域。
 * 全局模块：业务模块只需注入 SystemNotificationService，不再各自导入本模块。
 * PrismaModule 与 ConfigModule 都是全局模块，不需要在这里重复导入。
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [AssistantAdminController, NotificationAdminController, NotificationInboxController],
  providers: [
    SystemNotificationService,
    AssistantAdminService,
    NotificationAdminService,
    NotificationInboxService,
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
