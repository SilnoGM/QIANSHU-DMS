import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { ApiException } from '../../../infrastructure/http/api.exception'
import { attachRequestAuthContext } from '../auth-context'
import { AuthSessionService } from '../auth-session.service'
import {
  OPTIONAL_SESSION_METADATA,
  PUBLIC_ROUTE_METADATA,
} from '../decorators/auth.decorators'
import { SessionCookieProvider } from '../providers/session-cookie.provider'

const AUTHENTICATION_REQUIRED_CODE = 'AUTHENTICATION_REQUIRED'
const AUTHENTICATION_REQUIRED_MESSAGE = '需要登录'

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/**
 * Cookie Header 来自框架边界，测试 double 或代理对象的 getter 也可能抛错。读取失败
 * 统一视为缺少凭证，不能让 Header 内容或底层异常进入认证响应。
 */
function readCookieHeader(request: unknown): unknown {
  if (!isObject(request)) {
    return undefined
  }

  try {
    const headers: unknown = Reflect.get(request, 'headers')
    return isObject(headers) ? Reflect.get(headers, 'cookie') : undefined
  } catch {
    return undefined
  }
}

/**
 * 全局 Session 认证入口。Public 路由完全跳过；OptionalSession 只做不 touch 的有效性
 * 检查，匿名或无效凭证均可继续；其他路由必须得到有效 Session 身份。
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cookieProvider: SessionCookieProvider,
    private readonly sessionService: AuthSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()]
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(
        PUBLIC_ROUTE_METADATA,
        targets,
      ) ?? false

    if (isPublic) {
      return true
    }

    const isOptional =
      this.reflector.getAllAndOverride<boolean>(
        OPTIONAL_SESSION_METADATA,
        targets,
      ) ?? false
    const request = context.switchToHttp().getRequest<unknown>()
    const tokenValue = this.cookieProvider.readValue(readCookieHeader(request))

    if (tokenValue === null) {
      return isOptional ? true : this.rejectAuthenticationRequired()
    }

    // optional-session logout 不能被视为用户活动，因此必须使用不 touch 的验证入口。
    const session = isOptional
      ? await this.sessionService.validateWithoutTouch(tokenValue)
      : await this.sessionService.authenticate(tokenValue)

    if (session === null) {
      return isOptional ? true : this.rejectAuthenticationRequired()
    }
    if (!isObject(request)) {
      return this.rejectAuthenticationRequired()
    }

    attachRequestAuthContext(request, session)
    return true
  }

  private rejectAuthenticationRequired(): never {
    throw new ApiException(
      HttpStatus.UNAUTHORIZED,
      AUTHENTICATION_REQUIRED_CODE,
      AUTHENTICATION_REQUIRED_MESSAGE,
    )
  }
}
