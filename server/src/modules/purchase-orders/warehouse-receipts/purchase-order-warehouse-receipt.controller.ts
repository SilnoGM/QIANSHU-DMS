import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../../auth/auth-context'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import { PurchaseOrderIdParamDto } from '../dto/purchase-order-query.dto'
import { PurchaseOrderDetailDto } from '../dto/purchase-order-response.dto'
import { PurchaseOrderWarehouseReceiptRequestDto } from './purchase-order-warehouse-receipt.dto'
import { PurchaseOrderWarehouseReceiptService } from './purchase-order-warehouse-receipt.service'

@ApiTags('purchase-orders')
@Controller('purchase-orders')
export class PurchaseOrderWarehouseReceiptController {
  constructor(private readonly receipts: PurchaseOrderWarehouseReceiptService) {}

  @Post(':purchaseOrderId/warehouse-receipts')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_warehouse_receipt',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['PURCHASE_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED'] },
      { status: 422, codes: ['PURCHASE_WAREHOUSE_RECEIPT_NOT_ALLOWED', 'PURCHASE_WAREHOUSE_RECEIPT_TARGET_INVALID', 'PURCHASE_WAREHOUSE_RECEIPT_TIME_INVALID', 'VALIDATION_FAILED'] },
    ],
  })
  receive(@Param() params: PurchaseOrderIdParamDto, @Body() dto: PurchaseOrderWarehouseReceiptRequestDto, @Req() request: object) {
    return this.receipts.receive({ actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }, params.purchaseOrderId, dto)
  }
}
