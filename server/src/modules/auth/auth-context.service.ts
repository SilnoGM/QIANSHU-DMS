import { HttpStatus, Injectable } from '@nestjs/common'

import { AccessControlService } from '../access-control/access-control.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { RequestAuthContext } from './auth-context'
import type { LoginResult } from './auth.types'
import type { AuthContextDto } from './dto/auth-context.dto'

/** 构造所有 Auth API 共用的非敏感身份响应。 */
@Injectable()
export class AuthContextService {
  constructor(private readonly accessControl: AccessControlService) {}

  async get(auth: RequestAuthContext): Promise<AuthContextDto> {
    try {
      const permissions = await this.accessControl.getPermissionCodes(
        auth.userId,
      )

      return {
        user: {
          id: auth.userId,
          username: auth.username,
          displayName: auth.displayName,
          mustChangePassword: auth.mustChangePassword,
        },
        permissions: this.normalizePermissions(permissions),
        session: {
          createdAt: auth.createdAt,
          lastActivityAt: auth.lastActivityAt,
          idleExpiresAt: auth.idleExpiresAt,
          absoluteExpiresAt: auth.absoluteExpiresAt,
        },
      }
    } catch {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AUTH_SERVICE_UNAVAILABLE',
        '认证服务暂时不可用',
      )
    }
  }

  fromMutationResult(result: LoginResult): AuthContextDto {
    const session = result.issuedSession.session

    // tokenValue 与 Session selector 只用于设置 HttpOnly Cookie，刻意不进入 DTO。
    return {
      user: {
        id: session.userId,
        username: session.username,
        displayName: session.displayName,
        mustChangePassword: session.mustChangePassword,
      },
      permissions: this.normalizePermissions(result.permissions),
      session: {
        createdAt: session.createdAt.toISOString(),
        lastActivityAt: session.lastActivityAt.toISOString(),
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      },
    }
  }

  private normalizePermissions(permissionCodes: readonly string[]): string[] {
    return [...new Set(permissionCodes)].sort()
  }
}
