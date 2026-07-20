import { SetMetadata } from '@nestjs/common'

/**
 * 使用进程内 Symbol 隔离认证元数据，避免与 NestJS、第三方库或业务装饰器的字符串
 * key 冲突。Guard 只读取当前 handler 与 controller class 上的这些明确声明。
 */
export const PUBLIC_ROUTE_METADATA = Symbol('qianshu.auth.public')
export const OPTIONAL_SESSION_METADATA = Symbol('qianshu.auth.optional-session')
export const ALLOW_PASSWORD_CHANGE_REQUIRED_METADATA = Symbol(
  'qianshu.auth.allow-password-change-required',
)
export const REQUIRE_AUTHENTICATED_SESSION_METADATA = Symbol(
  'qianshu.auth.require-authenticated-session',
)
export const REQUIRED_PERMISSIONS_METADATA = Symbol(
  'qianshu.auth.required-permissions',
)

export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE_METADATA, true)

export const OptionalSession = (): MethodDecorator & ClassDecorator =>
  SetMetadata(OPTIONAL_SESSION_METADATA, true)

export const AllowPasswordChangeRequired = ():
  MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_METADATA, true)

/**
 * 声明路由只要求正常登录身份，不要求任何业务权限。
 *
 * 该元数据只由 PermissionGuard 消费；AuthenticationGuard 和
 * PasswordChangeRequiredGuard 仍按全局顺序执行，因此它不能把匿名请求或强制改密
 * Session 变成可访问状态。
 */
export const RequireAuthenticatedSession = ():
  MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_AUTHENTICATED_SESSION_METADATA, true)

export const RequirePermissions = (
  ...permissionCodes: readonly string[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(
    REQUIRED_PERMISSIONS_METADATA,
    // 防止装饰器调用方随后修改原数组，导致运行期授权要求漂移。
    Object.freeze([...permissionCodes]),
  )
