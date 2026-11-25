import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  NotificationEventConfigDto,
  NotificationEventConfigPreviewDto,
  NotificationEventConfigPreviewResultDto,
  NotificationEventConfigSummaryDto,
  NotificationEventConfigUpdateDto,
  NotificationEventTypeParamDto,
} from './notification-admin.dto'
import { NotificationEventConfigService, type NotificationEventConfigContext } from './notification-event-config.service'

function contract(operationId: string, mutation = false, errors: ApiContractErrorOptions[] = []) {
  return ApiApplicationContract({
    operationId,
    session: 'required',
    authorization: true,
    csrf: mutation,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      ...errors,
    ],
  })
}

function context(request: object): NotificationEventConfigContext {
  return {
    actorUserId: getRequestAuthContext(request).userId,
    requestId: getRequestId(request),
  }
}

/**
 * 事件渠道配置与渠道独享内容。没有模板 CRUD、模板选择或模板使用次数。
 */
@ApiTags('notifications')
@Controller('notifications/event-configs')
export class NotificationEventConfigController {
  constructor(private readonly configs: NotificationEventConfigService) {}

  @Get()
  @RequirePermissions('notification-policy:read')
  @ApiContractResponse({ status: 200, type: [NotificationEventConfigSummaryDto] })
  @contract('notifications_event_configs_list')
  list() {
    return this.configs.list()
  }

  @Get(':eventType')
  @RequirePermissions('notification-policy:read')
  @ApiContractResponse({ status: 200, type: NotificationEventConfigDto })
  @contract('notifications_event_configs_get', false, [
    { status: 404, codes: ['NOTIFICATION_EVENT_NOT_FOUND'] },
  ])
  get(@Param() params: NotificationEventTypeParamDto) {
    return this.configs.get(params.eventType)
  }

  @Post(':eventType/preview')
  @HttpCode(200)
  @RequirePermissions('notification-policy:read')
  @ApiContractResponse({ status: 200, type: NotificationEventConfigPreviewResultDto })
  @contract('notifications_event_configs_preview', true, [
    { status: 404, codes: ['NOTIFICATION_EVENT_NOT_FOUND'] },
  ])
  preview(
    @Param() params: NotificationEventTypeParamDto,
    @Body() input: NotificationEventConfigPreviewDto,
  ) {
    return this.configs.preview(params.eventType, input)
  }

  @Put(':eventType')
  @RequirePermissions('notification-policy:update')
  @ApiContractResponse({ status: 200, type: NotificationEventConfigDto })
  @contract('notifications_event_configs_update', true, [
    { status: 404, codes: ['NOTIFICATION_EVENT_NOT_FOUND'] },
    { status: 409, codes: ['NOTIFICATION_EVENT_CONFIG_STATE_CHANGED'] },
    {
      status: 422,
      codes: [
        'NOTIFICATION_EVENT_CHANNEL_DUPLICATE',
        'NOTIFICATION_EVENT_CHANNEL_METHOD_INVALID',
        'NOTIFICATION_EVENT_TARGET_MODE_INVALID',
        'NOTIFICATION_EVENT_TTL_UNSUPPORTED',
        'NOTIFICATION_EVENT_QUIET_HOURS_UNSUPPORTED',
        'NOTIFICATION_EVENT_SENSITIVE_UNSUPPORTED',
        'NOTIFICATION_EVENT_QUIET_HOURS_INVALID',
        'NOTIFICATION_EVENT_CONTENT_INVALID',
      ],
    },
  ])
  update(
    @Param() params: NotificationEventTypeParamDto,
    @Body() input: NotificationEventConfigUpdateDto,
    @Req() request: object,
  ) {
    return this.configs.update(context(request), params.eventType, input)
  }
}
