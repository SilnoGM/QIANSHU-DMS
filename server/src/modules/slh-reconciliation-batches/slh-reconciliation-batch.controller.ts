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
  SlhReconciliationSettlementCreateDto, SlhReconciliationSettlementDto,
  SlhReconciliationSettlementListDto, SlhReconciliationSettlementListQueryDto,
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
/** 确认结算的失败出口：界面值与重算不一致、汇率变化、已有相同结果、提交标识复用等都要能与刷新重试区分。 */
const settlementErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: [
    'SLH_RECON_BATCH_NOT_IN_PROGRESS', 'SLH_RECON_BATCH_STATE_CHANGED', 'SLH_RECON_BATCH_IDEMPOTENCY_CONFLICT',
    'SLH_RECON_SETTLEMENT_SOURCE_MISSING', 'SLH_RECON_SETTLEMENT_RATE_UNAVAILABLE', 'SLH_RECON_SETTLEMENT_RATE_CHANGED',
    'SLH_RECON_SETTLEMENT_MISMATCH', 'SLH_RECON_SETTLEMENT_UNCHANGED', 'SLH_RECON_SETTLEMENT_KEY_REUSED',
    'SLH_RECON_SALES_CURRENCY_UNSUPPORTED',
  ] },
]
/** 创建批次的专属失败出口：顺联航对账仅支持台币销售单。 */
const createErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['SLH_RECON_SALES_CURRENCY_UNSUPPORTED'] },
]
/**
 * 完成批次的新增失败出口：全量已核对门禁、待审收款占位与代收超收退回。
 * 超收退回会先在同一事务里把相关行重置为未核对、作废其结算记录，再以 409 响应。
 */
const completeErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: [
    'SLH_RECON_BATCH_UNRECONCILED_MEMBERS', 'SLH_RECON_BATCH_PENDING_RECEIPTS',
    'SLH_RECON_SETTLEMENT_COD_OVERCOLLECTED', 'SLH_RECON_SALES_CURRENCY_UNSUPPORTED',
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
  @ApiContractResponse({ status: 201, type: SlhReconciliationBatchDetailDto }) @contract('slh_reconciliation_batches_create', true, [notFound, ...writeErrors, ...createErrors])
  create(@Body() input: SlhReconciliationBatchCreateDto, @Headers('idempotency-key') key: unknown, @Req() request: object) {
    return this.commands.create(context(request), input, key)
  }

  @Get(':id') @RequirePermissions('slh-bills:reconcile') @ApiContractResponse({ status: 200, type: SlhReconciliationBatchDetailDto }) @contract('slh_reconciliation_batches_get', false, [notFound])
  detail(@Param() params: SlhReconciliationBatchIdDto) { return this.queries.detail(params.id) }

  @Post(':id/complete') @HttpCode(200) @RequirePermissions('slh-bills:reconcile')
  @ApiContractResponse({ status: 200, type: SlhReconciliationBatchDetailDto }) @contract('slh_reconciliation_batch_complete', true, [notFound, ...writeErrors, ...completeErrors])
  complete(@Param() params: SlhReconciliationBatchIdDto, @Req() request: object) {
    return this.commands.complete(context(request), params.id)
  }

  @Post(':id/settlements') @HttpCode(201) @RequirePermissions('slh-bills:reconcile')
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: 201, type: SlhReconciliationSettlementDto }) @contract('slh_reconciliation_settlement_create', true, [notFound, ...settlementErrors])
  settle(
    @Param() params: SlhReconciliationBatchIdDto,
    @Body() input: SlhReconciliationSettlementCreateDto,
    @Headers('idempotency-key') key: unknown,
    @Req() request: object,
  ) {
    return this.commands.settle(context(request), params.id, input, key)
  }

  @Get(':id/settlements') @RequirePermissions('slh-bills:reconcile')
  @ApiContractResponse({ status: 200, type: SlhReconciliationSettlementListDto }) @contract('slh_reconciliation_settlements_list', false, [notFound])
  settlements(@Param() params: SlhReconciliationBatchIdDto, @Query() query: SlhReconciliationSettlementListQueryDto) {
    return this.queries.settlements(params.id, query)
  }
}
