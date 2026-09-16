import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../../auth/auth-context'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import { PurchaseOrderMutationService } from '../purchase-order-mutation.service'
import { PurchasePayableQueryService } from './purchase-payable-query.service'
import { PurchasePayableIdDto, PurchasePayableListQueryDto, PurchasePayableOrderDto, PurchasePayableOrderPageDto, PurchasePayablePayDto } from './purchase-payable.dto'

@ApiTags('purchase-order-payables')
@Controller('purchase-order-payables')
export class PurchasePayableController {
  constructor(private readonly queries: PurchasePayableQueryService, private readonly mutations: PurchaseOrderMutationService) {}
  @Get()
  @RequirePermissions('purchase-orders:payment')
  @ApiContractResponse({ status: 200, type: PurchasePayableOrderPageDto })
  @ApiApplicationContract({ operationId: 'purchase_payables_list', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] }, { status: 422, codes: ['VALIDATION_FAILED', 'PURCHASE_PAYABLE_NOT_AVAILABLE'] }] })
  list(@Query() query: PurchasePayableListQueryDto) { return this.queries.list(query) }
  @Get(':id')
  @RequirePermissions('purchase-orders:payment')
  @ApiContractResponse({ status: 200, type: PurchasePayableOrderDto })
  @ApiApplicationContract({ operationId: 'purchase_payables_detail', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['PURCHASE_PAYABLE_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED', 'PURCHASE_PAYABLE_NOT_AVAILABLE'] }] })
  detail(@Param() params: PurchasePayableIdDto) { return this.queries.getByPayableId(params.id) }
  @Post(':id/pay') @HttpCode(200)
  @RequirePermissions('purchase-orders:payment')
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: 200, type: PurchasePayableOrderDto })
  @ApiApplicationContract({ operationId: 'purchase_payables_pay', session: 'required', authorization: true, csrf: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', 'CSRF_REJECTED'] },
      { status: 404, codes: ['PURCHASE_PAYABLE_NOT_FOUND', 'PURCHASE_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['PURCHASE_PAYABLE_STATE_CHANGED', 'PURCHASE_PAYABLE_IDEMPOTENCY_CONFLICT'] },
      { status: 422, codes: ['VALIDATION_FAILED', 'PURCHASE_PAYABLE_NOT_AVAILABLE', 'PURCHASE_PAYABLE_POSTING_UNAVAILABLE', 'PURCHASE_ORDER_PAYMENT_METHOD_UNAVAILABLE', 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID', 'PURCHASE_ORDER_CANCELLED', 'PURCHASE_ORDER_PAYMENT_AMOUNT_INVALID', 'PURCHASE_ORDER_AMOUNT_INVALID'] }] })
  async pay(@Param() params: PurchasePayableIdDto, @Body() input: PurchasePayablePayDto, @Headers('idempotency-key') key: unknown, @Req() request: object) {
    const orderId = await this.mutations.payPayable({ actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }, params.id, input, key)
    return this.queries.getOrder(orderId)
  }
}
