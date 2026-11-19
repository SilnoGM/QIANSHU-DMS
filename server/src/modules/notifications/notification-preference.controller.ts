import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequireAuthenticatedSession } from '../auth/decorators/auth.decorators'
import {
  NotificationPreferenceListDto,
  NotificationPreferenceParamDto,
  NotificationPreferenceUpdateDto,
  NotificationPreferenceUpdateResultDto,
} from './notification-preference.dto'
import { NotificationPreferenceService } from './notification-preference.service'

function contract(operationId: string, mutation = false, errors: ApiContractErrorOptions[] = []) {
  return ApiApplicationContract({
    operationId,
    session: 'required',
    authorization: false,
    csrf: mutation,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      ...errors,
    ],
  })
}

function userId(request: object): string {
  return getRequestAuthContext(request).userId
}

const updateErrors: ApiContractErrorOptions[] = [
  { status: 404, codes: ['NOTIFICATION_EVENT_NOT_FOUND'] },
  { status: 422, codes: ['NOTIFICATION_PREFERENCE_UNAVAILABLE'] },
]

/**
 * 个人通知订阅：只操作当前登录人自己的关闭记录，不要求管理端权限。
 */
@ApiTags('notification-preference')
@RequireAuthenticatedSession()
@Controller('notifications/me/preferences')
export class NotificationPreferenceController {
  constructor(private readonly preferences: NotificationPreferenceService) {}

  @Get()
  @ApiContractResponse({ status: 200, type: NotificationPreferenceListDto })
  @contract('notification_preferences_list')
  list(@Req() request: object) {
    return this.preferences.list(userId(request))
  }

  @Put(':eventType/:channel')
  @ApiContractResponse({ status: 200, type: NotificationPreferenceUpdateResultDto })
  @contract('notification_preference_update', true, updateErrors)
  update(
    @Req() request: object,
    @Param() params: NotificationPreferenceParamDto,
    @Body() body: NotificationPreferenceUpdateDto,
  ) {
    return this.preferences.setMuted(userId(request), params.eventType, params.channel, body.muted)
  }
}
