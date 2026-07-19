import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AccessControlService } from '../../access-control/access-control.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { getOptionalRequestAuthContext } from '../auth-context'
import {
  ALLOW_PASSWORD_CHANGE_REQUIRED_METADATA,
  OPTIONAL_SESSION_METADATA,
  PUBLIC_ROUTE_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from '../decorators/auth.decorators'

const AUTHENTICATION_REQUIRED_CODE = 'AUTHENTICATION_REQUIRED'
const AUTHENTICATION_REQUIRED_MESSAGE = '需要登录'
const FORBIDDEN_CODE = 'FORBIDDEN'
const FORBIDDEN_MESSAGE = '权限不足'

/**
 * 对声明了权限的路由执行实时授权。这里不缓存权限集合，确保角色或授权关系变更后，
 * 下一个请求立即使用 PostgreSQL 当前真相。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControl: AccessControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()]
    const requiredPermissions =
      this.reflector.getAllAndOverride<readonly string[]>(
        REQUIRED_PERMISSIONS_METADATA,
        targets,
      )
    const bypassesBusinessPermissions = [
      PUBLIC_ROUTE_METADATA,
      OPTIONAL_SESSION_METADATA,
      ALLOW_PASSWORD_CHANGE_REQUIRED_METADATA,
    ].some(
      (metadataKey) =>
        this.reflector.getAllAndOverride<boolean>(metadataKey, targets) === true,
    )

    // 首期只有 health/login、optional logout 和强制改密 allowlist 能绕过业务权限。
    // 这使遗漏 @RequirePermissions 的普通 Controller 默认为拒绝，而不是隐式公开。
    if (
      bypassesBusinessPermissions &&
      (requiredPermissions === undefined || requiredPermissions.length === 0)
    ) {
      return true
    }

    // 空权限列表不能成为绕过默认拒绝的方式。
    if (requiredPermissions === undefined || requiredPermissions.length === 0) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        FORBIDDEN_CODE,
        FORBIDDEN_MESSAGE,
      )
    }

    const request = context.switchToHttp().getRequest<unknown>()
    if (typeof request !== 'object' || request === null) {
      return this.rejectAuthenticationRequired()
    }

    const authContext = getOptionalRequestAuthContext(request)
    if (authContext === null) {
      return this.rejectAuthenticationRequired()
    }

    const grantedPermissions = await this.accessControl.getPermissionCodes(
      authContext.userId,
    )
    if (!this.accessControl.hasAll(grantedPermissions, requiredPermissions)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        FORBIDDEN_CODE,
        FORBIDDEN_MESSAGE,
      )
    }

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
