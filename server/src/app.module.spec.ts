import { APP_GUARD } from '@nestjs/core'

import { AppModule } from './app.module'
import { AuthModule } from './modules/auth/auth.module'
import { AuthenticationGuard } from './modules/auth/guards/authentication.guard'
import { CsrfProtectionGuard } from './modules/auth/guards/csrf-protection.guard'
import { PasswordChangeRequiredGuard } from './modules/auth/guards/password-change-required.guard'
import { PermissionGuard } from './modules/auth/guards/permission.guard'

describe('AppModule authentication composition', () => {
  it('imports AuthModule into the live HTTP application', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[]

    expect(imports).toContain(AuthModule)
  })

  it('registers the four global guards in the required order', () => {
    const providers = Reflect.getMetadata('providers', AppModule) as Array<{
      provide?: unknown
      useClass?: unknown
    }>
    const guardClasses = providers
      .filter((provider) => provider.provide === APP_GUARD)
      .map((provider) => provider.useClass)

    expect(guardClasses).toEqual([
      CsrfProtectionGuard,
      AuthenticationGuard,
      PasswordChangeRequiredGuard,
      PermissionGuard,
    ])
  })
})
