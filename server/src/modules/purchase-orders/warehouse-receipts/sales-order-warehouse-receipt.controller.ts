import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../../auth/auth-context'
import { CurrentUserId, resolveDataScopeActor } from '../../auth/decorators/current-user-id.decorator'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import { PurchaseOrderSourceSalesOrderIdParamDto } from '../dto/purchase-order-query.dto'
import {
  SalesOrderWarehouseReceiptContextDto,
  SalesOrderWarehouseReceiptRequestDto,
  SalesOrderWarehouseReceiptResultDto,
} from './sales-order-warehouse-receipt.dto'
import { SalesOrderWarehouseReceiptQueryService } from './sales-order-warehouse-receipt-query.service'
import { SalesOrderWarehouseReceiptService } from './sales-order-warehouse-receipt.service'

const COMMON_FORBIDDEN_ERRORS = [
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
] as const
const COMMON_MUTATION_FORBIDDEN_ERRORS = [
  'CSRF_REJECTED',
  ...COMMON_FORBIDDEN_ERRORS,
] as const

function mutationContext(request: object) {
  return {
    actorUserId: getRequestAuthContext(request).userId,
    requestId: getRequestId(request),
  }
}

@ApiTags('sales-orders')
@Controller('sales-orders')
export class SalesOrderWarehouseReceiptController {
  constructor(
    private readonly queries: SalesOrderWarehouseReceiptQueryService,
    private readonly receipts: SalesOrderWarehouseReceiptService,
  ) {}

  @Get(':salesOrderId/warehouse-receipt-context')
  @RequirePermissions('sales-orders:read', 'purchase-orders:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: SalesOrderWarehouseReceiptContextDto,
  })
  @ApiApplicationContract({
    operationId: 'sales_orders_warehouse_receipt_context',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: ['SALES_WAREHOUSE_RECEIPT_NOT_ALLOWED', 'VALIDATION_FAILED'] },
    ],
  })
  context(
    @Param() params: PurchaseOrderSourceSalesOrderIdParamDto,
    @CurrentUserId() actorUserId: string = resolveDataScopeActor(),
  ) {
    return this.queries.getContext(params.salesOrderId, actorUserId)
  }

  @Post(':salesOrderId/warehouse-receipts')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sales-orders:update', 'purchase-orders:update')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: SalesOrderWarehouseReceiptResultDto,
  })
  @ApiApplicationContract({
    operationId: 'sales_orders_warehouse_receipt',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['SALES_WAREHOUSE_RECEIPT_STATE_CHANGED'] },
      { status: 422, codes: [
        'SALES_WAREHOUSE_RECEIPT_NOT_ALLOWED',
        'SALES_WAREHOUSE_RECEIPT_TARGET_INVALID',
        'SALES_WAREHOUSE_RECEIPT_TIME_FUTURE',
        'SALES_WAREHOUSE_RECEIPT_TIME_BEFORE_SHIPMENT',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  receive(
    @Param() params: PurchaseOrderSourceSalesOrderIdParamDto,
    @Body() dto: SalesOrderWarehouseReceiptRequestDto,
    @Req() request: object,
  ) {
    return this.receipts.receive(mutationContext(request), params.salesOrderId, dto)
  }
}
