import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'
import { ApiException } from '../../infrastructure/http/api.exception'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { SlhBillPageDto } from '../slh-bills/slh-bill.dto'
import {
  SlhReconciliationBatchCandidateQueryDto, SlhReconciliationBatchCreateDto, SlhReconciliationBatchDetailDto,
  SlhReconciliationBatchIdDto, SlhReconciliationBatchListQueryDto, SlhReconciliationBatchPageDto,
  SlhReconciliationBatchPreviewDto, SlhReconciliationBatchPreviewRequestDto, SlhReconciliationBatchReconcileDto,
} from './slh-reconciliation-batch.dto'

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

/**
 * 对账功能已整体冻结（重构第一步）：路径、权限、DTO 与契约声明原样保留，实现不再读写数据库。
 * 读接口返回空集合（对账域当前没有任何对象）；其余接口返回契约已声明的 404。
 * 请求参数仅为保留契约声明与既有校验而留在签名里，空壳实现不消费它们。
 */
const emptyPage = (page?: number, pageSize?: number) => ({ items: [], total: 0, page: page ?? 1, pageSize: pageSize ?? 20 })
const noSuchBill = (): never => { throw new ApiException(404, 'SLH_BILL_NOT_FOUND', '账单不存在') }
const noSuchBatch = (): never => { throw new ApiException(404, 'SLH_RECON_BATCH_NOT_FOUND', '对账批次不存在') }

@ApiTags('slh-reconciliation-batches')
@Controller('slh-reconciliation-batches')
export class SlhReconciliationBatchController {
  @Get() @RequirePermissions('slh-bills:reconcile') @ApiContractResponse({ status: 200, type: SlhReconciliationBatchPageDto }) @contract('slh_reconciliation_batches_list')
  list(@Query() query: SlhReconciliationBatchListQueryDto) { return emptyPage(query.page, query.pageSize) }

  // 必须排在 `:id` 之前，否则会被当成批次主键。
  @Get('candidates') @RequirePermissions('slh-bills:reconcile') @ApiContractResponse({ status: 200, type: SlhBillPageDto }) @contract('slh_reconciliation_batch_candidates')
  candidates(@Query() query: SlhReconciliationBatchCandidateQueryDto) { return emptyPage(query.page, query.pageSize) }

  @Post('match-preview') @HttpCode(200) @RequirePermissions('slh-bills:reconcile')
  @ApiContractResponse({ status: 200, type: SlhReconciliationBatchPreviewDto }) @contract('slh_reconciliation_batch_match_preview', true, [notFound])
  preview(@Body() input: SlhReconciliationBatchPreviewRequestDto): never {
    void input
    return noSuchBill()
  }

  @Post() @HttpCode(201) @RequirePermissions('slh-bills:reconcile') @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: 201, type: SlhReconciliationBatchDetailDto }) @contract('slh_reconciliation_batches_create', true, [notFound, ...writeErrors])
  create(@Body() input: SlhReconciliationBatchCreateDto): never {
    void input
    return noSuchBill()
  }

  @Get(':id') @RequirePermissions('slh-bills:reconcile') @ApiContractResponse({ status: 200, type: SlhReconciliationBatchDetailDto }) @contract('slh_reconciliation_batches_get', false, [notFound])
  detail(@Param() params: SlhReconciliationBatchIdDto): never {
    void params
    return noSuchBatch()
  }

  @Post(':id/reconcile') @HttpCode(200) @RequirePermissions('slh-bills:reconcile')
  @ApiContractResponse({ status: 200, type: SlhReconciliationBatchDetailDto }) @contract('slh_reconciliation_batch_reconcile', true, [notFound, ...writeErrors])
  reconcile(@Param() params: SlhReconciliationBatchIdDto, @Body() input: SlhReconciliationBatchReconcileDto): never {
    void params
    void input
    return noSuchBatch()
  }

  @Post(':id/complete') @HttpCode(200) @RequirePermissions('slh-bills:reconcile')
  @ApiContractResponse({ status: 200, type: SlhReconciliationBatchDetailDto }) @contract('slh_reconciliation_batch_complete', true, [notFound, ...writeErrors])
  complete(@Param() params: SlhReconciliationBatchIdDto): never {
    void params
    return noSuchBatch()
  }
}
