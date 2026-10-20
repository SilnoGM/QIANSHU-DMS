import { PurchasePayableVoucherService } from './purchase-payable-voucher.service'
import type { PurchaseOrderDocumentMultipartRequest } from '../documents/purchase-order-document-multipart.parser'
import { PurchasePayableVoucherIdDto, PurchasePayableVoucherUploadDto, PurchasePayableVoucherUploadRequestDto } from './purchase-payable.dto'
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res, StreamableFile } from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../../auth/auth-context'
import { CurrentUserId, resolveDataScopeActor } from '../../auth/decorators/current-user-id.decorator'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import { PurchaseOrderMutationService } from '../purchase-order-mutation.service'
import { PurchasePayableQueryService } from './purchase-payable-query.service'
import { PurchasePayableIdDto, PurchasePayableListQueryDto, PurchasePayableOrderDto, PurchasePayableOrderPageDto, PurchasePayablePayDto } from './purchase-payable.dto'
import { PurchasePayableBatchSuppliersDto, PurchasePayableBatchOrdersDto, PurchasePayableBatchOrdersQueryDto, PurchasePayableBatchPayDto, PurchasePayableBatchResultDto } from './purchase-payable.dto'

@ApiTags('purchase-order-payables')
@Controller('purchase-order-payables')
export class PurchasePayableController {
  constructor(private readonly queries: PurchasePayableQueryService, private readonly mutations: PurchaseOrderMutationService, private readonly vouchers: PurchasePayableVoucherService) {}
  @Get()
  @RequirePermissions('purchase-orders:payment')
  @ApiContractResponse({ status: 200, type: PurchasePayableOrderPageDto })
  @ApiApplicationContract({ operationId: 'purchase_payables_list', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] }, { status: 422, codes: ['VALIDATION_FAILED', 'PURCHASE_PAYABLE_NOT_AVAILABLE'] }] })
  list(@Query() query: PurchasePayableListQueryDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor()) { return this.queries.list(query, actorUserId) }
  @Get('batch/suppliers')
  @RequirePermissions('purchase-orders:payment')
  @ApiContractResponse({ status: 200, type: PurchasePayableBatchSuppliersDto })
  @ApiApplicationContract({ operationId: 'purchase_payables_batch_suppliers', session: 'required', authorization: true, badRequest: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] }] })
  batchSuppliers(@CurrentUserId() actorUserId: string = resolveDataScopeActor()) { return this.queries.batchSuppliers(actorUserId) }
  @Get('batch/orders')
  @RequirePermissions('purchase-orders:payment')
  @ApiContractResponse({ status: 200, type: PurchasePayableBatchOrdersDto })
  @ApiApplicationContract({ operationId: 'purchase_payables_batch_orders', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] }, { status: 422, codes: ['VALIDATION_FAILED', 'PURCHASE_PAYABLE_NOT_AVAILABLE'] }] })
  batchOrders(@Query() query: PurchasePayableBatchOrdersQueryDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor()) { return this.queries.batchOrders(query.supplierValue, actorUserId) }
  @Post('batch/pay') @HttpCode(200)
  @RequirePermissions('purchase-orders:payment')
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: 200, type: PurchasePayableBatchResultDto })
  @ApiApplicationContract({ operationId: 'purchase_payables_batch_pay', session: 'required', authorization: true, csrf: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', 'CSRF_REJECTED'] },
      { status: 404, codes: ['PURCHASE_PAYABLE_NOT_FOUND', 'PURCHASE_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['PURCHASE_PAYABLE_STATE_CHANGED', 'PURCHASE_PAYABLE_IDEMPOTENCY_CONFLICT', 'PAYMENT_RECIPIENT_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED', 'PURCHASE_PAYABLE_NOT_AVAILABLE', 'PURCHASE_PAYABLE_POSTING_UNAVAILABLE', 'PURCHASE_ORDER_PAYMENT_METHOD_UNAVAILABLE', 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID', 'PURCHASE_ORDER_CANCELLED', 'PURCHASE_ORDER_PAYMENT_AMOUNT_INVALID', 'PURCHASE_ORDER_AMOUNT_INVALID', 'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE', 'PAYMENT_RECIPIENT_UNAVAILABLE', 'PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE', 'PAYMENT_RECIPIENT_INVALID'] }] })
  batchPay(@Body() input: PurchasePayableBatchPayDto, @Headers('idempotency-key') key: unknown, @Req() request: object) {
    return this.mutations.payBatch({ actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }, input, key)
  }
  @Get('orders/:id')
  @RequirePermissions('purchase-orders:payment')
  @ApiContractResponse({ status: 200, type: PurchasePayableOrderDto })
  @ApiApplicationContract({ operationId: 'purchase_payables_order_detail', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['PURCHASE_PAYABLE_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED', 'PURCHASE_PAYABLE_NOT_AVAILABLE'] }] })
  orderDetail(@Param() params: PurchasePayableIdDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor()) { return this.queries.getOrder(params.id, actorUserId) }
  @Get(':id')
  @RequirePermissions('purchase-orders:payment')
  @ApiContractResponse({ status: 200, type: PurchasePayableOrderDto })
  @ApiApplicationContract({ operationId: 'purchase_payables_detail', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['PURCHASE_PAYABLE_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED', 'PURCHASE_PAYABLE_NOT_AVAILABLE'] }] })
  detail(@Param() params: PurchasePayableIdDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor()) { return this.queries.getByPayableId(params.id, actorUserId) }
  @Post(':id/pay') @HttpCode(200)
  @RequirePermissions('purchase-orders:payment')
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: 200, type: PurchasePayableOrderDto })
  @ApiApplicationContract({ operationId: 'purchase_payables_pay', session: 'required', authorization: true, csrf: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', 'CSRF_REJECTED'] },
      { status: 404, codes: ['PURCHASE_PAYABLE_NOT_FOUND', 'PURCHASE_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['PURCHASE_PAYABLE_STATE_CHANGED', 'PURCHASE_PAYABLE_IDEMPOTENCY_CONFLICT', 'PAYMENT_RECIPIENT_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED', 'PURCHASE_PAYABLE_NOT_AVAILABLE', 'PURCHASE_PAYABLE_POSTING_UNAVAILABLE', 'PURCHASE_ORDER_PAYMENT_METHOD_UNAVAILABLE', 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID', 'PURCHASE_ORDER_CANCELLED', 'PURCHASE_ORDER_PAYMENT_AMOUNT_INVALID', 'PURCHASE_ORDER_AMOUNT_INVALID', 'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE', 'PAYMENT_RECIPIENT_UNAVAILABLE', 'PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE', 'PAYMENT_RECIPIENT_INVALID'] }] })
  async pay(@Param() params: PurchasePayableIdDto, @Body() input: PurchasePayablePayDto, @Headers('idempotency-key') key: unknown, @Req() request: object) {
    const actorUserId = getRequestAuthContext(request).userId
    const orderId = await this.mutations.payPayable({ actorUserId, requestId: getRequestId(request) }, params.id, input, key)
    return this.queries.getOrder(orderId, actorUserId)
  }
  @Post(':id/voucher-uploads') @HttpCode(201)
  @RequirePermissions('purchase-orders:payment')
  @ApiConsumes('multipart/form-data') @ApiBody({ type: PurchasePayableVoucherUploadRequestDto })
  @ApiContractResponse({ status: 201, type: PurchasePayableVoucherUploadDto })
  @ApiApplicationContract({ operationId: 'purchase_payables_upload_voucher', session: 'required', authorization: true, csrf: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', 'CSRF_REJECTED'] }, { status: 404, codes: ['PURCHASE_PAYABLE_NOT_FOUND'] },
      { status: 409, codes: ['PURCHASE_PAYABLE_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED', 'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE', 'PURCHASE_ORDER_DOCUMENT_CONTENT_INVALID', 'PURCHASE_ORDER_DOCUMENT_CONTENT_TOO_LARGE', 'PURCHASE_ORDER_DOCUMENT_CONTENT_UNSUPPORTED', 'PURCHASE_ORDER_DOCUMENT_MULTIPART_INVALID'] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }] })
  uploadVoucher(@Param() params: PurchasePayableIdDto, @Req() request: PurchaseOrderDocumentMultipartRequest) {
    return this.vouchers.upload({ actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }, params.id, request)
  }
  @Get(':id/vouchers/:documentId/content')
  @RequirePermissions('purchase-orders:payment')
  @ApiContractResponse({ status: 200, content: {
    'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/webp': { schema: { type: 'string', format: 'binary' } },
  } })
  @ApiContractResponse({ status: 304, description: 'Voucher ETag matched.' })
  @ApiApplicationContract({ operationId: 'purchase_payables_voucher_content', session: 'required', authorization: true, badRequest: true, validation: true, resourceLocator: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] }, { status: 404, codes: ['PURCHASE_ORDER_DOCUMENT_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }] })
  async voucherContent(@Param() params: PurchasePayableVoucherIdDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor(), @Headers('if-none-match') etag: unknown,
    @Res({ passthrough: true }) response: { status(code: number): unknown, setHeader(name: string, value: string): unknown }) {
    const result = await this.vouchers.content(params.id, params.documentId, etag, 'GET', actorUserId)
    response.status(result.status)
    for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
    return result.stream ? new StreamableFile(result.stream) : undefined
  }

}
