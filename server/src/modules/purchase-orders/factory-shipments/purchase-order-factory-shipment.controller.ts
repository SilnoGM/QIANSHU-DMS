import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../../auth/auth-context'
import { CurrentUserId, resolveDataScopeActor } from '../../auth/decorators/current-user-id.decorator'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import {
  PurchaseOrderIdParamDto,
  PurchaseOrderSourceSalesOrderIdParamDto,
} from '../dto/purchase-order-query.dto'
import {
  FactoryShipmentResultDto,
  PurchaseOrderFactoryShipmentRequestDto,
  SalesOrderFactoryShipmentContextDto,
  SalesOrderFactoryShipmentRequestDto,
} from './purchase-order-factory-shipment.dto'
import {
  PurchaseOrderFactoryShipmentQueryService,
  type SalesOrderFactoryShipmentContext,
} from './purchase-order-factory-shipment-query.service'
import {
  type FactoryShipmentResult,
  PurchaseOrderFactoryShipmentService,
} from './purchase-order-factory-shipment.service'

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

@ApiTags('purchase-orders')
@Controller('purchase-orders')
export class PurchaseOrderFactoryShipmentController {
  constructor(private readonly shipments: PurchaseOrderFactoryShipmentService) {}

  @Post(':purchaseOrderId/factory-shipments')
  @RequirePermissions('purchase-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: FactoryShipmentResultDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_factory_shipment',
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
      { status: 404, codes: ['PURCHASE_ORDER_NOT_FOUND', 'SALES_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['FACTORY_SHIPMENT_STATE_CHANGED'] },
      { status: 422, codes: [
        'FACTORY_SHIPMENT_NOT_ALLOWED',
        'FACTORY_SHIPMENT_TARGET_INVALID',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  ship(
    @Param() params: PurchaseOrderIdParamDto,
    @Body() dto: PurchaseOrderFactoryShipmentRequestDto,
    @Req() request: object,
  ): Promise<FactoryShipmentResult> {
    return this.shipments.shipPurchaseOrder(
      mutationContext(request),
      params.purchaseOrderId,
      dto,
    )
  }
}

@ApiTags('sales-orders')
@Controller('sales-orders')
export class SalesOrderFactoryShipmentController {
  constructor(
    private readonly queries: PurchaseOrderFactoryShipmentQueryService,
    private readonly shipments: PurchaseOrderFactoryShipmentService,
  ) {}

  @Get(':salesOrderId/factory-shipment-context')
  @RequirePermissions('sales-orders:read', 'purchase-orders:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: SalesOrderFactoryShipmentContextDto,
  })
  @ApiApplicationContract({
    operationId: 'sales_orders_factory_shipment_context',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: ['FACTORY_SHIPMENT_NOT_ALLOWED', 'VALIDATION_FAILED'] },
    ],
  })
  context(
    @Param() params: PurchaseOrderSourceSalesOrderIdParamDto,
    @CurrentUserId() actorUserId: string = resolveDataScopeActor(),
  ): Promise<SalesOrderFactoryShipmentContext> {
    return this.queries.getSalesOrderContext(params.salesOrderId, actorUserId)
  }

  @Post(':salesOrderId/factory-shipments')
  @RequirePermissions('sales-orders:update', 'purchase-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: FactoryShipmentResultDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_factory_shipment',
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
      { status: 409, codes: ['FACTORY_SHIPMENT_STATE_CHANGED'] },
      { status: 422, codes: [
        'FACTORY_SHIPMENT_NOT_ALLOWED',
        'FACTORY_SHIPMENT_TARGET_INVALID',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  ship(
    @Param() params: PurchaseOrderSourceSalesOrderIdParamDto,
    @Body() dto: SalesOrderFactoryShipmentRequestDto,
    @Req() request: object,
  ): Promise<FactoryShipmentResult> {
    return this.shipments.shipSalesOrder(
      mutationContext(request),
      params.salesOrderId,
      dto,
    )
  }
}
