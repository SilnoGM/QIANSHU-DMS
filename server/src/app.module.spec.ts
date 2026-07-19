import { APP_GUARD } from '@nestjs/core'

import { AppModule } from './app.module'
import { AuditModule } from './modules/audit/audit.module'
import { AuthModule } from './modules/auth/auth.module'
import { AuthenticationGuard } from './modules/auth/guards/authentication.guard'
import { CsrfProtectionGuard } from './modules/auth/guards/csrf-protection.guard'
import { PasswordChangeRequiredGuard } from './modules/auth/guards/password-change-required.guard'
import { PermissionGuard } from './modules/auth/guards/permission.guard'
import { PermissionsModule } from './modules/permissions/permissions.module'
import { RolesModule } from './modules/roles/roles.module'
import { UsersModule } from './modules/users/users.module'

describe('AppModule authentication composition', () => {
  it('imports Auth and all management modules into the live HTTP application', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[]

    expect(imports).toEqual(
      expect.arrayContaining([
        AuthModule,
        UsersModule,
        RolesModule,
        PermissionsModule,
        AuditModule,
      ]),
    )
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
