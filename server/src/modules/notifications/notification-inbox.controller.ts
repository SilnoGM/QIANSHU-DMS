import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { RequireAuthenticatedSession } from '../auth/decorators/auth.decorators'
import { getRequestAuthContext } from '../auth/auth-context'
import {
  NotificationInboxDetailDto,
  NotificationInboxIdParamDto,
  NotificationInboxNewDto,
  NotificationInboxNewQueryDto,
  NotificationInboxPageDto,
  NotificationInboxQueryDto,
  NotificationInboxReadAllDto,
  NotificationInboxReadAllResultDto,
  NotificationInboxUnreadCountDto,
} from './notification-inbox.dto'
import { NotificationInboxService } from './notification-inbox.service'

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

const notFound: ApiContractErrorOptions = {
  status: 404,
  codes: ['NOTIFICATION_INBOX_NOT_FOUND'],
}

@ApiTags('notification-inbox')
@RequireAuthenticatedSession()
@Controller('notifications/me/inbox')
export class NotificationInboxController {
  constructor(private readonly inbox: NotificationInboxService) {}

  @Get('unread-count')
  @ApiContractResponse({ status: 200, type: NotificationInboxUnreadCountDto })
  @contract('notification_inbox_unread_count')
  unreadCount(@Req() request: object) {
    return this.inbox.unreadCount(userId(request))
  }

  @Get('new')
  @ApiContractResponse({ status: 200, type: NotificationInboxNewDto })
  @contract('notification_inbox_new', false, [{ status: 422, codes: ['NOTIFICATION_INBOX_CURSOR_INVALID'] }])
  newItems(@Query() query: NotificationInboxNewQueryDto, @Req() request: object) {
    return this.inbox.newItems(userId(request), query)
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiContractResponse({ status: 200, type: NotificationInboxReadAllResultDto })
  @contract('notification_inbox_read_all', true)
  readAll(@Body() input: NotificationInboxReadAllDto, @Req() request: object) {
    return this.inbox.readAll(userId(request), input ?? {})
  }

  @Get()
  @ApiContractResponse({ status: 200, type: NotificationInboxPageDto })
  @contract('notification_inbox_list')
  list(@Query() query: NotificationInboxQueryDto, @Req() request: object) {
    return this.inbox.list(userId(request), query)
  }

  @Get(':id')
  @ApiContractResponse({ status: 200, type: NotificationInboxDetailDto })
  @contract('notification_inbox_get', false, [notFound])
  get(@Param() params: NotificationInboxIdParamDto, @Req() request: object) {
    return this.inbox.get(userId(request), params.id)
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiContractResponse({ status: 200, type: NotificationInboxDetailDto })
  @contract('notification_inbox_read', true, [notFound])
  markRead(@Param() params: NotificationInboxIdParamDto, @Req() request: object) {
    return this.inbox.markRead(userId(request), params.id)
  }

  @Post(':id/unread')
  @HttpCode(200)
  @ApiContractResponse({ status: 200, type: NotificationInboxDetailDto })
  @contract('notification_inbox_unread', true, [notFound])
  markUnread(@Param() params: NotificationInboxIdParamDto, @Req() request: object) {
    return this.inbox.markUnread(userId(request), params.id)
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiContractResponse({ status: 200, type: NotificationInboxDetailDto })
  @contract('notification_inbox_archive', true, [notFound])
  archive(@Param() params: NotificationInboxIdParamDto, @Req() request: object) {
    return this.inbox.archive(userId(request), params.id)
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @ApiContractResponse({ status: 200, type: NotificationInboxDetailDto })
  @contract('notification_inbox_unarchive', true, [notFound])
  unarchive(@Param() params: NotificationInboxIdParamDto, @Req() request: object) {
    return this.inbox.unarchive(userId(request), params.id)
  }
}
