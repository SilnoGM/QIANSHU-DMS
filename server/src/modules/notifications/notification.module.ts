import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { AuthModule } from '../auth/auth.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { NotificationAdminController } from './notification-admin.controller'
import { NotificationAdminService } from './notification-admin.service'
import { NotificationInboxController } from './notification-inbox.controller'
import { NotificationInboxService } from './notification-inbox.service'
import { NotificationPreferenceController } from './notification-preference.controller'
import { NotificationPreferenceService } from './notification-preference.service'
import { SystemNotificationService } from './system-notification.service'
import { WecomAdminController } from './wecom-admin.controller'
import { WecomAdminService } from './wecom-admin.service'
import { WecomAppHttpTransport } from './wecom-app.transport'
import { WecomDispatchService } from './wecom-dispatch.service'
import { WecomMediaService } from './wecom-media.service'
import { WecomRobotHttpTransport } from './wecom-robot.transport'
import { WECOM_SECRET_KEY, WecomSecretService } from './wecom-secret.service'
import { WECOM_TOKEN_FETCH, WecomTokenService } from './wecom-token.service'
import { WECOM_APP_TRANSPORT, WECOM_ROBOT_TRANSPORT } from './wecom.types'

/**
 * 通知中心基础模块。
 *
 * 发布入口、站内收件箱、企业微信派发与管理端共用同一通知域。
 * 全局模块：业务模块只需注入 SystemNotificationService，不再各自导入本模块。
 * PrismaModule 与 ConfigModule 都是全局模块，不需要在这里重复导入。
 */
@Global()
@Module({
  imports: [AuthModule, MediaModule, NumberingModule],
  controllers: [NotificationAdminController, NotificationInboxController, NotificationPreferenceController, WecomAdminController],
  providers: [
    SystemNotificationService,
    WecomAdminService,
    NotificationAdminService,
    NotificationInboxService,
    NotificationPreferenceService,
    {
      provide: WECOM_SECRET_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): string | null =>
        config.get<string>('WECOM_APP_SECRET_KEY') ?? null,
    },
    {
      provide: WECOM_TOKEN_FETCH,
      useValue: globalThis.fetch,
    },
    WecomSecretService,
    WecomMediaService,
    WecomTokenService,
    WecomAppHttpTransport,
    WecomRobotHttpTransport,
    {
      provide: WECOM_APP_TRANSPORT,
      useExisting: WecomAppHttpTransport,
    },
    {
      provide: WECOM_ROBOT_TRANSPORT,
      useExisting: WecomRobotHttpTransport,
    },
    WecomDispatchService,
  ],
  exports: [SystemNotificationService],
})
export class NotificationModule {}
