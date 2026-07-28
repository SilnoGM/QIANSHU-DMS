import { APP_GUARD } from '@nestjs/core'

import { AuditModule } from './modules/audit/audit.module'
import { AuthModule } from './modules/auth/auth.module'
import { AuthenticationGuard } from './modules/auth/guards/authentication.guard'
import { CsrfProtectionGuard } from './modules/auth/guards/csrf-protection.guard'
import { PasswordChangeRequiredGuard } from './modules/auth/guards/password-change-required.guard'
import { PermissionGuard } from './modules/auth/guards/permission.guard'
import { PermissionsModule } from './modules/permissions/permissions.module'
import { RegionsModule } from './modules/regions/regions.module'
import { RolesModule } from './modules/roles/roles.module'
import { UsersModule } from './modules/users/users.module'

type AppModuleClass = typeof import('./app.module').AppModule

let AppModule: AppModuleClass

const originalDatabaseUrl = process.env.DATABASE_URL

beforeAll(async () => {
  // AppModule 在模块加载时执行运行时环境校验；测试只提供不会建立连接的占位 URL，避免依赖开发机的 .env。
  process.env.DATABASE_URL = 'postgresql://localhost:5432/qianshu_test'
  AppModule = (await import('./app.module')).AppModule
})

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL
    return
  }

  process.env.DATABASE_URL = originalDatabaseUrl
})

describe('AppModule authentication composition', () => {
  it('imports Auth and all registered HTTP modules into the live application', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[]

    expect(imports).toEqual(
      expect.arrayContaining([
        AuthModule,
        UsersModule,
        RolesModule,
        PermissionsModule,
        AuditModule,
        RegionsModule,
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
