import { ConfigService } from '@nestjs/config'

import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { AuthMetricLogger } from '../../infrastructure/observability/auth-metric.logger'
import { AuthContextService } from './auth-context.service'
import { AuthController } from './auth.controller'
import { AuthModule } from './auth.module'
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

type ProviderDefinition =
  | object
  | (new (...args: never[]) => unknown)

describe('AuthModule metadata', () => {
  it('registers the five Auth endpoints and all authentication services', () => {
    const controllers = Reflect.getMetadata('controllers', AuthModule) as
      | unknown[]
      | undefined
    const providers = Reflect.getMetadata('providers', AuthModule) as
      | ProviderDefinition[]
      | undefined

    expect(controllers).toEqual([AuthController])
    expect(providers).toEqual(
      expect.arrayContaining([
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
        AuthMetricLogger,
      ]),
    )
  })

  it('constructs PasswordProvider from the bounded Argon2 configuration', () => {
    const providers = Reflect.getMetadata('providers', AuthModule) as Array<{
      provide?: unknown
      inject?: unknown[]
      useFactory?: (
        config: ConfigService,
        metrics: AuthMetricLogger,
      ) => unknown
    }>
    const passwordDefinition = providers.find(
      (provider) => provider.provide === PasswordProvider,
    )
    const config = {
      getOrThrow: jest.fn((path: string) => {
        if (path === 'auth.argon2.concurrency') return 3
        if (path === 'auth.argon2.queueLimit') return 9
        throw new Error('Unexpected configuration path')
      }),
    } as unknown as ConfigService

    const metrics = new AuthMetricLogger({ log: jest.fn() })

    expect(passwordDefinition?.inject).toEqual([
      ConfigService,
      AuthMetricLogger,
    ])
    expect(passwordDefinition?.useFactory?.(config, metrics)).toBeInstanceOf(
      PasswordProvider,
    )
    expect(config.getOrThrow).toHaveBeenCalledWith(
      'auth.argon2.concurrency',
    )
    expect(config.getOrThrow).toHaveBeenCalledWith(
      'auth.argon2.queueLimit',
    )
  })
})
