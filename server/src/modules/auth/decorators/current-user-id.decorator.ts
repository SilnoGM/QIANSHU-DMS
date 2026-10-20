import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import { getRequestAuthContext } from '../auth-context'

export { resolveDataScopeActor } from '../../access-control/data-scope'

/**
 * 从 AuthenticationGuard 已绑定的可信会话快照读取当前用户 id。
 *
 * 业务查询统一使用这个值解析数据范围，不接受查询参数或请求体指定用户。
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<object>()
    return getRequestAuthContext(request).userId
  },
)
