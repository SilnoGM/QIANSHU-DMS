import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequireAnyPermissions, RequirePermissions } from '../auth/decorators/auth.decorators'
import { AssistantTestSendDto } from './assistant-admin.dto'
import {
  NotificationCancelResultDto,
  NotificationChannelPolicyDto,
  NotificationChannelPolicyPathDto,
  NotificationChannelPolicyUpdateDto,
  NotificationEventDto,
  NotificationOverviewDto,
  NotificationRecordDetailDto,
  NotificationRecordOptionsDto,
  NotificationRecordPageDto,
  NotificationRecordQueryDto,
  NotificationTemplateCreateDto,
  NotificationTemplateDto,
  NotificationTemplatePreviewDto,
  NotificationTemplatePreviewResultDto,
  NotificationTemplateUpdateDto,
  NotificationUuidParamDto,
} from './notification-admin.dto'
import { NotificationAdminService, type NotificationAdminContext } from './notification-admin.service'

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

function context(request: object): NotificationAdminContext {
  return {
    actorUserId: getRequestAuthContext(request).userId,
    requestId: getRequestId(request),
  }
}

@ApiTags('notifications')
@Controller('notifications')
export class NotificationAdminController {
  constructor(private readonly notifications: NotificationAdminService) {}

  @Get('overview')
  @RequirePermissions('notification-record:read')
  @ApiContractResponse({ status: 200, type: NotificationOverviewDto })
  @contract('notifications_overview_get')
  overview() {
    return this.notifications.overview()
  }

  @Get('events')
  @RequireAnyPermissions('notification-policy:read', 'notification-template:read')
  @ApiContractResponse({ status: 200, type: [NotificationEventDto] })
  @contract('notifications_events_list')
  listEvents() {
    return this.notifications.listEvents()
  }

  @Get('templates')
  @RequirePermissions('notification-template:read')
  @ApiContractResponse({ status: 200, type: [NotificationTemplateDto] })
  @contract('notifications_templates_list')
  listTemplates(@Query('channel') channel?: string) {
    return this.notifications.listTemplates(channel)
  }

  @Post('templates')
  @HttpCode(201)
  @RequirePermissions('notification-template:update')
  @ApiContractResponse({ status: 201, type: NotificationTemplateDto })
  @contract('notifications_templates_create', true, [
    { status: 409, codes: ['NOTIFICATION_TEMPLATE_EXISTS'] },
    { status: 422, codes: ['NOTIFICATION_TEMPLATE_LINK_REQUIRED', 'NOTIFICATION_TEMPLATE_SINGLE_BRACE', 'NOTIFICATION_TEMPLATE_UNDECLARED_VARIABLE', 'NOTIFICATION_TEMPLATE_DOMAIN_CONFLICT'] },
  ])
  createTemplate(@Body() input: NotificationTemplateCreateDto, @Req() request: object) {
    return this.notifications.createTemplate(context(request), input)
  }

  @Patch('templates/:id')
  @RequirePermissions('notification-template:update')
  @ApiContractResponse({ status: 200, type: NotificationTemplateDto })
  @contract('notifications_templates_update', true, [
    { status: 404, codes: ['NOTIFICATION_TEMPLATE_NOT_FOUND'] },
    { status: 409, codes: ['NOTIFICATION_TEMPLATE_STATE_CHANGED'] },
    { status: 422, codes: ['NOTIFICATION_TEMPLATE_LINK_REQUIRED', 'NOTIFICATION_TEMPLATE_SINGLE_BRACE', 'NOTIFICATION_TEMPLATE_UNDECLARED_VARIABLE', 'NOTIFICATION_TEMPLATE_DOMAIN_CONFLICT'] },
  ])
  updateTemplate(@Param() params: NotificationUuidParamDto, @Body() input: NotificationTemplateUpdateDto, @Req() request: object) {
    return this.notifications.updateTemplate(context(request), params.id, input)
  }

  @Post('templates/:id/preview')
  @HttpCode(200)
  @RequirePermissions('notification-template:read')
  @ApiContractResponse({ status: 200, type: NotificationTemplatePreviewResultDto })
  @contract('notifications_templates_preview', true, [{ status: 404, codes: ['NOTIFICATION_TEMPLATE_NOT_FOUND'] }])
  previewTemplate(@Param() params: NotificationUuidParamDto, @Body() input: NotificationTemplatePreviewDto) {
    return this.notifications.previewTemplate(params.id, input)
  }

  @Post('templates/:id/test')
  @HttpCode(200)
  @RequirePermissions('notification-template:update')
  @ApiContractResponse({ status: 200, type: AssistantTestSendDto })
  @contract('notifications_templates_test', true, [
    { status: 404, codes: ['NOTIFICATION_TEMPLATE_NOT_FOUND'] },
    { status: 422, codes: ['ASSISTANT_ACCOUNT_OFFLINE', 'ASSISTANT_ACCOUNT_UNAVAILABLE', 'NOTIFICATION_TEMPLATE_CHANNEL_UNSUPPORTED'] },
    { status: 429, codes: ['ASSISTANT_RATE_LIMITED'] },
    { status: 503, codes: ['ASSISTANT_OUTBOUND_BLOCKED', 'ASSISTANT_UPSTREAM_UNAVAILABLE'] },
  ])
  testTemplate(@Param() params: NotificationUuidParamDto, @Body() input: NotificationTemplatePreviewDto) {
    return this.notifications.testTemplate(params.id, input)
  }

  @Get('channel-policies')
  @RequirePermissions('notification-policy:read')
  @ApiContractResponse({ status: 200, type: [NotificationChannelPolicyDto] })
  @contract('notifications_policies_list')
  listPolicies(@Query('eventType') eventType?: string, @Query('channel') channel?: string) {
    return this.notifications.listPolicies(eventType, channel)
  }

  @Put('channel-policies/:eventType/:channel')
  @RequirePermissions('notification-policy:update')
  @ApiContractResponse({ status: 200, type: NotificationChannelPolicyDto })
  @contract('notifications_policies_update', true, [{ status: 409, codes: ['NOTIFICATION_POLICY_STATE_CHANGED'] }])
  upsertPolicy(
    @Param() params: NotificationChannelPolicyPathDto,
    @Body() input: NotificationChannelPolicyUpdateDto,
    @Req() request: object,
  ) {
    return this.notifications.upsertPolicy(context(request), params.eventType, params.channel, input)
  }

  @Get('records')
  @RequirePermissions('notification-record:read')
  @ApiContractResponse({ status: 200, type: NotificationRecordPageDto })
  @contract('notifications_records_list')
  listRecords(@Query() query: NotificationRecordQueryDto) {
    return this.notifications.listRecords(query)
  }

  @Get('records/options')
  @RequirePermissions('notification-record:read')
  @ApiContractResponse({ status: 200, type: NotificationRecordOptionsDto })
  @contract('notifications_records_options')
  listRecordOptions() {
    return this.notifications.listRecordOptions()
  }

  @Get('records/:id')
  @RequirePermissions('notification-record:read')
  @ApiContractResponse({ status: 200, type: NotificationRecordDetailDto })
  @contract('notifications_records_get', false, [{ status: 404, codes: ['NOTIFICATION_RECORD_NOT_FOUND'] }])
  getRecord(@Param() params: NotificationUuidParamDto) {
    return this.notifications.getRecord(params.id)
  }

  @Post('records/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('notification-record:manage')
  @ApiContractResponse({ status: 200, type: NotificationCancelResultDto })
  @contract('notifications_records_cancel', true, [{ status: 404, codes: ['NOTIFICATION_RECORD_NOT_FOUND'] }])
  cancelRecord(@Param() params: NotificationUuidParamDto, @Req() request: object) {
    return this.notifications.cancelRecord(context(request), params.id)
  }
}
