import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthContextService } from './auth-context.service'
import { AuthController } from './auth.controller'
import { AuthSessionService } from './auth-session.service'
import { AuthService } from './auth.service'
import { LogoutService } from './logout.service'
import { PasswordChangeService } from './password-change.service'
import { AuthRateLimitService } from './providers/auth-rate-limit.service'
import { AuthSubjectHasher } from './providers/auth-subject-hasher'
import { PasswordPolicyProvider } from './providers/password-policy.provider'
import { PasswordProvider } from './providers/password.provider'
import { SessionCookieProvider } from './providers/session-cookie.provider'
import { SessionTokenProvider } from './providers/session-token.provider'

const passwordProviderDefinition = {
  provide: PasswordProvider,
  inject: [ConfigService],
  useFactory: (config: ConfigService): PasswordProvider =>
    new PasswordProvider({
      maxActive: config.getOrThrow<number>('auth.argon2.concurrency'),
      maxQueued: config.getOrThrow<number>('auth.argon2.queueLimit'),
    }),
}

/** 认证模块集中持有密码容量队列，确保所有登录、改密和管理密码操作共享同一上限。 */
@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthContextService,
    PasswordChangeService,
    LogoutService,
    AuthSessionService,
    AuthRateLimitService,
    AuthSubjectHasher,
    PasswordPolicyProvider,
    SessionCookieProvider,
    SessionTokenProvider,
    AccessControlService,
    AuditService,
    passwordProviderDefinition,
  ],
  exports: [
    AuthSessionService,
    AuthRateLimitService,
    AuthSubjectHasher,
    PasswordPolicyProvider,
    PasswordProvider,
    SessionCookieProvider,
    AccessControlService,
    AuditService,
  ],
})
export class AuthModule {}
