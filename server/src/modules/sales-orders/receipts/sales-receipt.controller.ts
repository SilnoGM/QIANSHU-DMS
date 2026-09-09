import { Body, Controller, Get, Head, Headers, HttpCode, HttpStatus, Param, Post, Query, Req, Res, StreamableFile, applyDecorators } from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../../auth/auth-context'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import { SalesReceiptApprovalContextDto, SalesReceiptApproveDto, SalesReceiptIdDto, SalesReceiptListQueryDto, SalesReceiptOrderIdDto, SalesReceiptOrderVoucherIdDto, SalesReceiptRejectDto, SalesReceiptRequestCreateDto, SalesReceiptRequestDetailDto, SalesReceiptRequestPageDto } from '../dto/sales-receipt.dto'
import { SalesReceiptService } from './sales-receipt.service'
import { SalesReceiptQueryService } from './sales-receipt-query.service'
import { SalesReceiptVoucherService } from './sales-receipt-voucher.service'
import type { SalesOrderDocumentContentResponse } from '../documents/sales-order-document.service'

function contract(operationId: string, mutation = false) {
  return ApiApplicationContract({ operationId, session: 'required', authorization: true, csrf: mutation, badRequest: true, resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] },
      { status: 404, codes: ['SALES_RECEIPT_NOT_FOUND', 'SALES_ORDER_NOT_FOUND', 'SALES_ORDER_DOCUMENT_NOT_FOUND'] },
      { status: 409, codes: ['SALES_RECEIPT_STATE_CHANGED', 'SALES_RECEIPT_CONTEXT_CHANGED', 'SALES_RECEIPT_IDEMPOTENCY_CONFLICT', 'SALES_RECEIPT_REVERSAL_CONFLICT', 'SALES_RECEIPT_NUMBERING_UNAVAILABLE', 'SALES_RECEIPT_NUMBER_CONFLICT'] },
      { status: 422, codes: ['VALIDATION_FAILED', 'SALES_ORDER_CANCELLED', 'SALES_ORDER_COMPLETED', 'SALES_ORDER_PAYMENT_AMOUNT_INVALID', 'SALES_ORDER_AMOUNT_INVALID', 'SALES_ORDER_PAYMENT_METHOD_UNAVAILABLE', 'SALES_ORDER_DOCUMENT_UNAVAILABLE', 'SALES_RECEIPT_AMOUNT_EXCEEDS_AVAILABLE', 'SALES_RECEIPT_RATE_UNAVAILABLE', 'SALES_RECEIPT_CNY_AMOUNT_INVALID', 'SALES_RECEIPT_POSTING_UNAVAILABLE'] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ] })
}
function context(request: object) { return { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) } }
interface ContentResponse { setHeader(name: string, value: string): unknown, status(status: number): unknown }
function contentResult(result: SalesOrderDocumentContentResponse, response: ContentResponse) {
  response.status(result.status)
  for (const [key, value] of Object.entries(result.headers)) response.setHeader(key, value)
  return result.stream ? new StreamableFile(result.stream) : undefined
}
function voucherContract(operationId: string, head = false) {
  return applyDecorators(contract(operationId), ApiContractResponse({ status: 200, ...(head ? { description: 'Private receipt voucher headers.' } : { content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/webp': { schema: { type: 'string', format: 'binary' } }, 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }) }), ApiContractResponse({ status: 304, description: 'Voucher ETag matched.' }))
}

@ApiTags('sales-receipt-requests')
@Controller('sales-receipt-requests')
export class SalesReceiptController {
  constructor(private readonly commands: SalesReceiptService, private readonly queries: SalesReceiptQueryService, private readonly vouchers: SalesReceiptVoucherService) {}
  @Get() @RequirePermissions('sales-receipts:read') @ApiContractResponse({ status: 200, type: SalesReceiptRequestPageDto }) @contract('sales_receipts_list')
  list(@Query() query: SalesReceiptListQueryDto) { return this.queries.list(query) }
  @Get(':id') @RequirePermissions('sales-receipts:read') @ApiContractResponse({ status: 200, type: SalesReceiptRequestDetailDto }) @contract('sales_receipts_get')
  detail(@Param() params: SalesReceiptIdDto) { return this.queries.getById(params.id) }
  @Get(':id/approval-context') @RequirePermissions('sales-receipts:read', 'sales-receipts:review') @ApiContractResponse({ status: 200, type: SalesReceiptApprovalContextDto }) @contract('sales_receipts_approval_context')
  preview(@Param() params: SalesReceiptIdDto, @Req() request: object) { return this.commands.approvalContext(context(request), params.id) }
  @Post(':id/approve') @HttpCode(HttpStatus.OK) @RequirePermissions('sales-receipts:review') @ApiContractResponse({ status: 200, type: SalesReceiptRequestDetailDto }) @contract('sales_receipts_approve', true)
  approve(@Param() params: SalesReceiptIdDto, @Body() body: SalesReceiptApproveDto, @Req() request: object) { return this.commands.approve(context(request), params.id, body) }
  @Post(':id/reject') @HttpCode(HttpStatus.OK) @RequirePermissions('sales-receipts:review') @ApiContractResponse({ status: 200, type: SalesReceiptRequestDetailDto }) @contract('sales_receipts_reject', true)
  reject(@Param() params: SalesReceiptIdDto, @Body() body: SalesReceiptRejectDto, @Req() request: object) { return this.commands.reject(context(request), params.id, body) }
  @Get(':id/voucher') @RequirePermissions('sales-receipts:read') @voucherContract('sales_receipts_get_voucher')
  async voucher(@Param() params: SalesReceiptIdDto, @Headers('if-none-match') tag: unknown, @Res({ passthrough: true }) response: ContentResponse) { return contentResult(await this.vouchers.resolveContent(params.id, undefined, tag, 'GET'), response) }
  @Head(':id/voucher') @RequirePermissions('sales-receipts:read') @voucherContract('sales_receipts_head_voucher', true)
  async headVoucher(@Param() params: SalesReceiptIdDto, @Headers('if-none-match') tag: unknown, @Res({ passthrough: true }) response: ContentResponse) { contentResult(await this.vouchers.resolveContent(params.id, undefined, tag, 'HEAD'), response) }
}

@ApiTags('sales-orders')
@Controller('sales-orders')
export class SalesReceiptOrderController {
  constructor(private readonly commands: SalesReceiptService, private readonly queries: SalesReceiptQueryService, private readonly vouchers: SalesReceiptVoucherService) {}
  @Post(':salesOrderId/receipt-requests') @HttpCode(HttpStatus.CREATED) @RequirePermissions('sales-orders:payment', 'sales-orders:document') @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } }) @ApiContractResponse({ status: 201, type: SalesReceiptRequestDetailDto }) @contract('sales_orders_submit_receipt_request', true)
  submit(@Param() params: SalesReceiptOrderIdDto, @Body() body: SalesReceiptRequestCreateDto, @Headers('idempotency-key') key: unknown, @Req() request: object) { return this.commands.submit(context(request), params.salesOrderId, body, key) }
  @Get(':salesOrderId/receipt-requests') @RequirePermissions('sales-orders:read') @ApiContractResponse({ status: 200, type: SalesReceiptRequestPageDto }) @contract('sales_orders_list_receipt_requests')
  list(@Param() params: SalesReceiptOrderIdDto, @Query() query: SalesReceiptListQueryDto) { return this.queries.list(query, params.salesOrderId) }
  @Get(':salesOrderId/receipt-requests/:requestId/voucher') @RequirePermissions('sales-orders:read') @voucherContract('sales_orders_get_receipt_voucher')
  async voucher(@Param() params: SalesReceiptOrderVoucherIdDto, @Headers('if-none-match') tag: unknown, @Res({ passthrough: true }) response: ContentResponse) { return contentResult(await this.vouchers.resolveContent(params.requestId, params.salesOrderId, tag, 'GET'), response) }
  @Head(':salesOrderId/receipt-requests/:requestId/voucher') @RequirePermissions('sales-orders:read') @voucherContract('sales_orders_head_receipt_voucher', true)
  async headVoucher(@Param() params: SalesReceiptOrderVoucherIdDto, @Headers('if-none-match') tag: unknown, @Res({ passthrough: true }) response: ContentResponse) { contentResult(await this.vouchers.resolveContent(params.requestId, params.salesOrderId, tag, 'HEAD'), response) }
}
