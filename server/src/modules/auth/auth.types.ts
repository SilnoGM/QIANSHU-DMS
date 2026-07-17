import type { IssuedSession } from './auth-session.service'

/** Controller 从已校验 DTO 、可信代理配置和 Cookie provider 组装的登录输入。 */
export interface LoginInput {
  username: string
  password: string
  sourceIp: string
  requestId: string
  existingSessionToken?: string
}

/**
 * Session secret 只在 Server 内部传递给 Cookie provider，Controller 不得把
 * `issuedSession.tokenValue` 放进 JSON 响应、日志或 OpenAPI example。
 */
export interface LoginResult {
  issuedSession: IssuedSession
  permissions: string[]
}
