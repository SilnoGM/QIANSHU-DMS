import { Controller, Get, HttpStatus, Param } from '@nestjs/common'
import { ApiProperty, ApiTags } from '@nestjs/swagger'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { CurrentUserId, resolveDataScopeActor } from '../auth/decorators/current-user-id.decorator'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { PurchaseOrderIdParamDto } from './dto/purchase-order-query.dto'
import { PurchaseOrderReviewContextService } from './purchase-order-review-context.service'

export class PurchaseOrderReviewContextDto {
  @ApiProperty({ type: 'boolean' }) readonly available!: boolean
  @ApiProperty({ type: 'string', nullable: true }) readonly message!: string | null
}

@ApiTags('purchase-orders')
@Controller('purchase-orders')
export class PurchaseOrderReviewContextController {
  constructor(private readonly reviewContext: PurchaseOrderReviewContextService) {}

  @Get(':purchaseOrderId/review-context')
  @RequirePermissions('purchase-orders:review')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderReviewContextDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_review_context',
    session: 'required', authorization: true, badRequest: true, resourceLocator: true, validation: true, conflict: true, privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['PURCHASE_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['PURCHASE_ORDER_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  read(
    @Param() params: PurchaseOrderIdParamDto,
    @CurrentUserId() actorUserId: string = resolveDataScopeActor(),
  ): Promise<PurchaseOrderReviewContextDto> {
    return this.reviewContext.read(params.purchaseOrderId, actorUserId)
  }
}
