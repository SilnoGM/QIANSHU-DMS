import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { CheetahGoConfiguration } from '../../config/cheetahgo.config'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { AdAccountCommandService } from './ad-account-command.service'
import { AdAccountController } from './ad-account.controller'
import { AdAccountQueryService } from './ad-account-query.service'
import { AdAccountSyncService } from './ad-account-sync.service'
import { CheetahGoClient } from './cheetahgo.client'
import { CHEETAHGO_CLIENT } from './cheetahgo.tokens'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdAccountController],
  providers: [
    {
      // 凭据可选：缺省时注入 null，同步任务跳过而不是让整个服务启动失败。
      provide: CHEETAHGO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): CheetahGoClient | null => {
        const appid = config.get<string>('CHEETAHGO_APPID')
        const secret = config.get<string>('CHEETAHGO_SECRET')

        if (!appid || !secret) {
          return null
        }

        return new CheetahGoClient({
          appid,
          secret,
          baseUrl: config.getOrThrow<CheetahGoConfiguration>('cheetahgo').baseUrl,
        })
      },
    },
    AdAccountQueryService,
    AdAccountCommandService,
    AdAccountSyncService,
  ],
})
export class AdAccountsModule {}
