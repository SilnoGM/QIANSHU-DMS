import { Controller, Get, HttpStatus, Param } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { SalesOrderPendingPurchaseProductsDto } from './dto/sales-order-pending-purchase.dto'
import { SalesOrderIdParamDto } from './dto/sales-order-query.dto'
import { SalesOrderPendingPurchaseQueryService } from './sales-order-pending-purchase-query.service'

@ApiTags('sales-orders')
@Controller('sales-orders')
export class SalesOrderPendingPurchaseController {
  constructor(private readonly queries: SalesOrderPendingPurchaseQueryService) {}

  @Get(':salesOrderId/pending-purchase-products')
  @RequirePermissions('sales-orders:read', 'purchase-orders:create')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderPendingPurchaseProductsDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_pending_purchase_products',
    session: 'required', authorization: true, badRequest: true,
    validation: true, privateNoStore: true, resourceLocator: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  list(@Param() params: SalesOrderIdParamDto): Promise<SalesOrderPendingPurchaseProductsDto> {
    return this.queries.list(params.salesOrderId)
  }
}
