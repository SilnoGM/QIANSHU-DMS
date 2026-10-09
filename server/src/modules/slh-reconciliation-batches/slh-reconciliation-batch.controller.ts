import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { SlhBillPageDto } from '../slh-bills/slh-bill.dto'
import {
  SlhReconciliationBatchCandidateQueryDto, SlhReconciliationBatchCreateDto, SlhReconciliationBatchDetailDto,
  SlhReconciliationBatchIdDto, SlhReconciliationBatchListQueryDto, SlhReconciliationBatchPageDto,
  SlhReconciliationBillOptionPageDto, SlhReconciliationBillOptionQueryDto,
  SlhReconciliationReconcilableCountsDto, SlhReconciliationReconcilableCountsRequestDto,
} from './slh-reconciliation-batch.dto'
import { SlhReconciliationBatchQueryService } from './slh-reconciliation-batch-query.service'
import { SlhReconciliationBatchService } from './slh-reconciliation-batch.service'

function contract(operationId: string, mutation = false, errors: ApiContractErrorOptions[] = []) {
  return ApiApplicationContract({ operationId, session: 'required', authorization: true, csrf: mutation, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] }, { status: 422, codes: ['VALIDATION_FAILED'] }, ...errors] })
}
const notFound: ApiContractErrorOptions = { status: 404, codes: ['SLH_RECON_BATCH_NOT_FOUND', 'SLH_BILL_NOT_FOUND'] }
const writeErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: [
    'SLH_RECON_BATCH_CONFLICT', 'SLH_RECON_BATCH_NO_LINES_TO_RECONCILE', 'SLH_RECON_BATCH_SCOPE_CHANGED',
    'SLH_RECON_BATCH_LINES_NOT_ELIGIBLE', 'SLH_RECON_BATCH_NOT_IN_PROGRESS', 'SLH_RECON_BATCH_STATE_CHANGED',
    'SLH_RECON_BATCH_NUMBERING_UNAVAILABLE', 'SLH_RECON_BATCH_IDEMPOTENCY_CONFLICT',
  ] },
]

/** 对账批次接口：列表、候选/可选账单、静默算可核对行数、详情、创建与完成都已接上实现。 */
function context(request: object) {
  return { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }
}

@ApiTags('slh-reconciliation-batches')
@Controller('slh-reconciliation-batches')
export class SlhReconciliationBatchController {
  constructor(
    private readonly commands: SlhReconciliationBatchService,
    private readonly queries: SlhReconciliationBatchQueryService,
  ) {}

  @Get() @RequirePermissions('slh-bills:reconcile') @ApiContractResponse({ status: 200, type: SlhReconciliationBatchPageDto }) @contract('slh_reconciliation_batches_list')
  list(@Query() query: SlhReconciliationBatchListQueryDto) { return this.queries.list(query) }

  // 必须排在 `:id` 之前，否则会被当成批次主键。
  @Get('candidates') @RequirePermissions('slh-bills:reconcile') @ApiContractResponse({ status: 200, type: SlhBillPageDto }) @contract('slh_reconciliation_batch_candidates')
  candidates(@Query() query: SlhReconciliationBatchCandidateQueryDto) { return this.queries.candidates(query) }

  @Get('selectable-bills') @RequirePermissions('slh-bills:reconcile') @ApiContractResponse({ status: 200, type: SlhReconciliationBillOptionPageDto }) @contract('slh_reconciliation_bill_options')
  selectableBills(@Query() query: SlhReconciliationBillOptionQueryDto) { return this.queries.selectableBills(query) }

  // 批量算「当前可核对」是纯读，但用 POST 传账单标识：不进 URL，也就不进日志与历史记录。
  @Post('reconcilable-counts') @HttpCode(200) @RequirePermissions('slh-bills:reconcile')
  @ApiContractResponse({ status: 200, type: SlhReconciliationReconcilableCountsDto }) @contract('slh_reconciliation_reconcilable_counts', true)
  reconcilableCounts(@Body() input: SlhReconciliationReconcilableCountsRequestDto) { return this.queries.reconcilableCounts(input) }

  @Post() @HttpCode(201) @RequirePermissions('slh-bills:reconcile') @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: 201, type: SlhReconciliationBatchDetailDto }) @contract('slh_reconciliation_batches_create', true, [notFound, ...writeErrors])
  create(@Body() input: SlhReconciliationBatchCreateDto, @Headers('idempotency-key') key: unknown, @Req() request: object) {
    return this.commands.create(context(request), input, key)
  }

  @Get(':id') @RequirePermissions('slh-bills:reconcile') @ApiContractResponse({ status: 200, type: SlhReconciliationBatchDetailDto }) @contract('slh_reconciliation_batches_get', false, [notFound])
  detail(@Param() params: SlhReconciliationBatchIdDto) { return this.queries.detail(params.id) }

  @Post(':id/complete') @HttpCode(200) @RequirePermissions('slh-bills:reconcile')
  @ApiContractResponse({ status: 200, type: SlhReconciliationBatchDetailDto }) @contract('slh_reconciliation_batch_complete', true, [notFound, ...writeErrors])
  complete(@Param() params: SlhReconciliationBatchIdDto, @Req() request: object) {
    return this.commands.complete(context(request), params.id)
  }
}
