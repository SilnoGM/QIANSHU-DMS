import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import appConfig from '../../config/app.config'
import authConfig from '../../config/auth.config'
import { validateEnvironment } from '../../config/env.validation'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuditService } from '../../modules/audit/audit.service'
import { PasswordPolicyProvider } from '../../modules/auth/providers/password-policy.provider'
import { PasswordProvider } from '../../modules/auth/providers/password.provider'
import { AuthAdminService } from './auth-admin.service'

const passwordProviderDefinition = {
  provide: PasswordProvider,
  inject: [ConfigService],
  useFactory: (config: ConfigService): PasswordProvider =>
    new PasswordProvider({
      maxActive: config.getOrThrow<number>('auth.argon2.concurrency'),
      maxQueued: config.getOrThrow<number>('auth.argon2.queueLimit'),
    }),
}

/**
 * CLI 使用独立 application context，不加载 HTTP controller/guard；但复用完整环境
 * 校验、Prisma 生命周期与认证密码 provider，保证操作的是当前 Server 构建和 Schema。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      load: [appConfig, authConfig],
      validate: validateEnvironment,
    }),
    PrismaModule,
  ],
  providers: [
    AuthAdminService,
    AuditService,
    PasswordPolicyProvider,
    passwordProviderDefinition,
  ],
})
export class AuthAdminModule {}
