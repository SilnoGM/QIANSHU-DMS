import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator'
import {
  MACHINE_VIEWING_PERMISSION_CREATE,
  MACHINE_VIEWING_PERMISSION_READ,
  MACHINE_VIEWING_PERMISSION_UPDATE,
} from './machine-viewing.contract'
import {
  CreateMachineViewingDto,
  MachineViewingDto,
  MachineViewingIdParamsDto,
  MachineViewingListQueryDto,
  MachineViewingManualNotificationTextDto,
  MachineViewingPageDto,
  MachineViewingStatusCountsDto,
  MachineViewingStatusCountsQueryDto,
  MachineViewingStatusTransitionDto,
  UpdateMachineViewingDto,
} from './machine-viewing.dto'
import { MachineViewingQueryService } from './machine-viewing-query.service'
import { MachineViewingService, type MachineViewingCommandContext } from './machine-viewing.service'

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
      { status: 422, codes: ['VALIDATION_FAILED', 'MACHINE_VIEWING_VALIDATION_FAILED'] },
      ...errors,
    ],
  })
}

function context(request: object): MachineViewingCommandContext {
  return { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }
}

const notFound: ApiContractErrorOptions = { status: 404, codes: ['MACHINE_VIEWING_NOT_FOUND'] }
const stateChanged: ApiContractErrorOptions = { status: 409, codes: ['MACHINE_VIEWING_STATE_CHANGED'] }

/**
 * 看机预约：登记、列表、编辑、状态流转（含反馈录入与取消）。
 *
 * 列表与写操作的归属范围都由服务层按 `data-scope:all` 判定：运营只看/只改本人，
 * 采运看全部；创建只授予运营角色，采运即使能进列表也不持有 create 权限。
 */
@ApiTags('machine-viewings')
@Controller('machine-viewings')
export class MachineViewingController {
  constructor(
    private readonly queries: MachineViewingQueryService,
    private readonly service: MachineViewingService,
  ) {}

  @Get()
  @RequirePermissions(MACHINE_VIEWING_PERMISSION_READ)
  @ApiContractResponse({ status: HttpStatus.OK, type: MachineViewingPageDto })
  @contract('machine_viewings_list')
  list(
    @Query() query: MachineViewingListQueryDto,
    @CurrentUserId() actorUserId: string,
  ): Promise<MachineViewingPageDto> {
    return this.queries.listForActor(actorUserId, query)
  }

  @Get('status-counts')
  @RequirePermissions(MACHINE_VIEWING_PERMISSION_READ)
  @ApiContractResponse({ status: HttpStatus.OK, type: MachineViewingStatusCountsDto })
  @contract('machine_viewings_status_counts')
  statusCounts(
    @Query() query: MachineViewingStatusCountsQueryDto,
    @CurrentUserId() actorUserId: string,
  ): Promise<MachineViewingStatusCountsDto> {
    return this.queries.statusCounts(actorUserId, query)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(MACHINE_VIEWING_PERMISSION_CREATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: HttpStatus.CREATED, type: MachineViewingDto })
  @contract('machine_viewings_create', true, [
    {
      status: 409,
      codes: ['MACHINE_VIEWING_CONFLICT', 'MACHINE_VIEWING_IDEMPOTENCY_CONFLICT'],
    },
  ])
  create(
    @Body() input: CreateMachineViewingDto,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Req() request: object,
  ): Promise<MachineViewingDto> {
    return this.service.create(context(request), input, idempotencyKey)
  }

  @Patch(':id')
  @RequirePermissions(MACHINE_VIEWING_PERMISSION_UPDATE)
  @ApiContractResponse({ status: HttpStatus.OK, type: MachineViewingDto })
  @contract('machine_viewings_update', true, [notFound, stateChanged])
  update(
    @Param() params: MachineViewingIdParamsDto,
    @Body() input: UpdateMachineViewingDto,
    @Req() request: object,
  ): Promise<MachineViewingDto> {
    return this.service.update(context(request), params.id, input)
  }

  @Post(':id/status-transitions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MACHINE_VIEWING_PERMISSION_UPDATE)
  @ApiContractResponse({ status: HttpStatus.OK, type: MachineViewingDto })
  @contract('machine_viewings_transition_status', true, [notFound, stateChanged])
  transition(
    @Param() params: MachineViewingIdParamsDto,
    @Body() input: MachineViewingStatusTransitionDto,
    @Req() request: object,
  ): Promise<MachineViewingDto> {
    return this.service.transition(context(request), params.id, input)
  }

  @Get(':id/manual-notification-text')
  @RequirePermissions(MACHINE_VIEWING_PERMISSION_UPDATE)
  @ApiContractResponse({ status: HttpStatus.OK, type: MachineViewingManualNotificationTextDto })
  @contract('machine_viewings_manual_notification_text', false, [
    notFound,
    stateChanged,
    { status: 422, codes: ['MACHINE_VIEWING_NOTIFICATION_TEXT_UNAVAILABLE'] },
  ])
  manualNotificationText(
    @Param() params: MachineViewingIdParamsDto,
    @CurrentUserId() actorUserId: string,
  ): Promise<MachineViewingManualNotificationTextDto> {
    return this.service.manualNotificationText(actorUserId, params.id)
  }

  @Post(':id/manual-notifications')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MACHINE_VIEWING_PERMISSION_UPDATE)
  @ApiContractResponse({ status: HttpStatus.OK, type: MachineViewingDto })
  @contract('machine_viewings_mark_manually_notified', true, [notFound, stateChanged])
  markManuallyNotified(
    @Param() params: MachineViewingIdParamsDto,
    @Req() request: object,
  ): Promise<MachineViewingDto> {
    return this.service.markManuallyNotified(context(request), params.id)
  }
}
