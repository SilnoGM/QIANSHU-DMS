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
  REQUIRE_AUTHENTICATED_SESSION_METADATA,
  REQUIRED_ANY_PERMISSIONS_METADATA,
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
    const requiredAnyPermissions =
      this.reflector.getAllAndOverride<readonly string[]>(
        REQUIRED_ANY_PERMISSIONS_METADATA,
        targets,
      )
    const hasRequiredPermissions =
      requiredPermissions !== undefined && requiredPermissions.length > 0
    const hasRequiredAnyPermissions =
      requiredAnyPermissions !== undefined && requiredAnyPermissions.length > 0
    const requiresAuthenticatedSession =
      this.reflector.getAllAndOverride<boolean>(
        REQUIRE_AUTHENTICATED_SESSION_METADATA,
        targets,
      ) === true
    const bypassesBusinessPermissions = [
      PUBLIC_ROUTE_METADATA,
      OPTIONAL_SESSION_METADATA,
      ALLOW_PASSWORD_CHANGE_REQUIRED_METADATA,
    ].some(
      (metadataKey) =>
        this.reflector.getAllAndOverride<boolean>(metadataKey, targets) === true,
    )

    if (requiresAuthenticatedSession) {
      // 同一路由不能同时选择“仅登录”与业务权限两套授权模型；冲突声明必须默认拒绝，
      // 避免装饰器顺序或后续重构意外放宽权限。
      if (hasRequiredPermissions || hasRequiredAnyPermissions) {
        return this.rejectForbidden()
      }

      const request = context.switchToHttp().getRequest<unknown>()
      if (typeof request !== 'object' || request === null) {
        return this.rejectAuthenticationRequired()
      }

      if (getOptionalRequestAuthContext(request) === null) {
        return this.rejectAuthenticationRequired()
      }

      return true
    }

    // all 与 any 是互斥的授权模型；同时声明时失败关闭，不猜测调用方意图。
    if (hasRequiredPermissions && hasRequiredAnyPermissions) {
      return this.rejectForbidden()
    }

    // 首期只有 health/login、optional logout 和强制改密 allowlist 能绕过业务权限。
    // 这使遗漏 @RequirePermissions 的普通 Controller 默认为拒绝，而不是隐式公开。
    if (
      bypassesBusinessPermissions
      && !hasRequiredPermissions
      && !hasRequiredAnyPermissions
    ) {
      return true
    }

    // 空权限列表不能成为绕过默认拒绝的方式。
    if (!hasRequiredPermissions && !hasRequiredAnyPermissions) {
      return this.rejectForbidden()
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
    const allowed = hasRequiredPermissions
      ? this.accessControl.hasAll(grantedPermissions, requiredPermissions)
      : this.accessControl.hasAny(grantedPermissions, requiredAnyPermissions)
    if (!allowed) {
      return this.rejectForbidden()
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

  private rejectForbidden(): never {
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      FORBIDDEN_CODE,
      FORBIDDEN_MESSAGE,
    )
  }
}
