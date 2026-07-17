import { AuthModule } from './modules/auth/auth.module'
import { HealthModule } from './modules/health/health.module'

// 正式运行应用与 OpenAPI preview 必须消费同一清单，避免路由和快照随两份手工列表漂移。
export const HTTP_MODULES = [HealthModule, AuthModule] as const
