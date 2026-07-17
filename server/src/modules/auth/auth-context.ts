import type { AuthenticatedSession } from './auth-session.service'

const requestAuthContextKey = Symbol('qianshuRequestAuthContext')
const AUTH_CONTEXT_UNAVAILABLE_MESSAGE = 'Authentication context is unavailable'
const AUTH_CONTEXT_ALREADY_ATTACHED_MESSAGE =
  'Authentication context is already attached'

type RequestWithAuthContext = {
  [requestAuthContextKey]?: RequestAuthContext
}

/**
 * 单次请求内可信的身份快照。它只保留后续 Guard 与 Controller 所需的非凭证字段；
 * Cookie、Session secret、原始 token 和 tokenHash 永远不能进入该对象。
 *
 * 时间使用 ISO 字符串而不是可变的 Date，避免下游组件意外修改 Guard 已确认的身份
 * 快照，也可直接用于 AuthContext DTO。
 */
export type RequestAuthContext = Readonly<{
  absoluteExpiresAt: string
  createdAt: string
  displayName: string
  idleExpiresAt: string
  lastActivityAt: string
  mustChangePassword: boolean
  sessionId: string
  userId: string
  username: string
}>

export function attachRequestAuthContext(
  request: object,
  session: AuthenticatedSession,
): RequestAuthContext {
  if (getOptionalRequestAuthContext(request) !== null) {
    // 身份一旦通过 AuthenticationGuard 绑定，后续组件不得替换为另一个用户或 Session。
    throw new Error(AUTH_CONTEXT_ALREADY_ATTACHED_MESSAGE)
  }

  const context: RequestAuthContext = Object.freeze({
    sessionId: session.id,
    userId: session.userId,
    username: session.username,
    displayName: session.displayName,
    mustChangePassword: session.mustChangePassword,
    createdAt: session.createdAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  })

  // Symbol + non-enumerable 属性避免与 Express 字段重名，也避免常规日志或 JSON 序列化
  // 意外携带身份快照；不可写、不可配置保证下游无法覆盖认证结论。
  Object.defineProperty(request, requestAuthContextKey, {
    configurable: false,
    enumerable: false,
    value: context,
    writable: false,
  })

  return context
}

export function getOptionalRequestAuthContext(
  request: object,
): RequestAuthContext | null {
  return (request as RequestWithAuthContext)[requestAuthContextKey] ?? null
}

export function getRequestAuthContext(request: object): RequestAuthContext {
  const context = getOptionalRequestAuthContext(request)
  if (context === null) {
    throw new Error(AUTH_CONTEXT_UNAVAILABLE_MESSAGE)
  }

  return context
}
