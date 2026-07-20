import { AuditModule } from './modules/audit/audit.module'
import { AuthModule } from './modules/auth/auth.module'
import { HealthModule } from './modules/health/health.module'
import { PermissionsModule } from './modules/permissions/permissions.module'
import { ProfileModule } from './modules/profile/profile.module'
import { RolesModule } from './modules/roles/roles.module'
import { UsersModule } from './modules/users/users.module'

// 正式运行应用与 OpenAPI preview 必须消费同一清单，避免路由和快照随两份手工列表漂移。
export const HTTP_MODULES = [
  HealthModule,
  AuthModule,
  ProfileModule,
  UsersModule,
  RolesModule,
  PermissionsModule,
  AuditModule,
] as const
