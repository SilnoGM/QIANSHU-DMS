import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import {
  CurrentUserId,
  resolveDataScopeActor,
} from '../../auth/decorators/current-user-id.decorator'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import {
  PurchasePaymentListQueryDto,
  PurchasePaymentRecordPageDto,
} from './purchase-payment.dto'
import { PurchasePaymentQueryService } from './purchase-payment-query.service'

@ApiTags('purchase-order-payments')
@Controller('purchase-order-payments')
export class PurchasePaymentController {
  constructor(private readonly queries: PurchasePaymentQueryService) {}

  @Get()
  @RequirePermissions('purchase-orders:payment')
  @ApiContractResponse({ status: 200, type: PurchasePaymentRecordPageDto })
  @ApiApplicationContract({
    operationId: 'purchase_payments_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  list(
    @Query() query: PurchasePaymentListQueryDto,
    @CurrentUserId() actorUserId: string = resolveDataScopeActor(),
  ): Promise<PurchasePaymentRecordPageDto> {
    return this.queries.list(query, actorUserId)
  }
}
