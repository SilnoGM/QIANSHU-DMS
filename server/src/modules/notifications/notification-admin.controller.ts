import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequireAnyPermissions, RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  NotificationCancelResultDto,
  NotificationEventDto,
  NotificationOverviewDto,
  NotificationRecordDetailDto,
  NotificationRecordOptionsDto,
  NotificationRecordPageDto,
  NotificationRecordQueryDto,
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
  @RequireAnyPermissions('notification-policy:read', 'wecom-channel:read', 'wecom-app:read')
  @ApiContractResponse({ status: 200, type: [NotificationEventDto] })
  @contract('notifications_events_list')
  listEvents() {
    return this.notifications.listEvents()
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
