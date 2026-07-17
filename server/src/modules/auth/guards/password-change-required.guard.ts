import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { ApiException } from '../../../infrastructure/http/api.exception'
import { getOptionalRequestAuthContext } from '../auth-context'
import { ALLOW_PASSWORD_CHANGE_REQUIRED_METADATA } from '../decorators/auth.decorators'

const PASSWORD_CHANGE_REQUIRED_CODE = 'PASSWORD_CHANGE_REQUIRED'
const PASSWORD_CHANGE_REQUIRED_MESSAGE = '必须先修改密码'

/** 强制改密 Session 只能进入显式 allowlist，不能依赖 Controller 自行判断。 */
@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isAllowed =
      this.reflector.getAllAndOverride<boolean>(
        ALLOW_PASSWORD_CHANGE_REQUIRED_METADATA,
        [context.getHandler(), context.getClass()],
      ) ?? false

    if (isAllowed) {
      return true
    }

    const request = context.switchToHttp().getRequest<unknown>()
    if (typeof request !== 'object' || request === null) {
      return true
    }

    const authContext = getOptionalRequestAuthContext(request)
    if (authContext === null || !authContext.mustChangePassword) {
      return true
    }

    throw new ApiException(
      HttpStatus.FORBIDDEN,
      PASSWORD_CHANGE_REQUIRED_CODE,
      PASSWORD_CHANGE_REQUIRED_MESSAGE,
    )
  }
}
