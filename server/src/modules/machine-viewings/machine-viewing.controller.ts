import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common'
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
} from './machine-viewing.contract'
import {
  CreateMachineViewingDto,
  MachineViewingDto,
  MachineViewingListQueryDto,
  MachineViewingPageDto,
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

/**
 * 看机预约只提供「登记」与「列表」两个动作。
 *
 * 列表的归属范围由服务层按 `data-scope:all` 判定：运营只看本人，采运看全部；
 * 创建只授予运营角色，采运即使能进列表也不持有 create 权限。
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
}
