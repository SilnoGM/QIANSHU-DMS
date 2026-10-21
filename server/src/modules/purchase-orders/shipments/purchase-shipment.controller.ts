import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../../auth/auth-context'
import { CurrentUserId, resolveDataScopeActor } from '../../auth/decorators/current-user-id.decorator'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import { PurchaseShipmentDeliverRequestDto, PurchaseShipmentDeliverResultDto, PurchaseShipmentDetailDto, PurchaseShipmentFilterDto, PurchaseShipmentIdParamDto, PurchaseShipmentListQueryDto, PurchaseShipmentPageDto, PurchaseShipmentStatusCountsDto } from './purchase-shipment.dto'
import { PurchaseShipmentDeliveryService } from './purchase-shipment-delivery.service'
import { PurchaseShipmentQueryService } from './purchase-shipment-query.service'

@ApiTags('purchase-order-parts')
@Controller('purchase-order-parts')
export class PurchaseShipmentController {
  constructor(
    private readonly queries: PurchaseShipmentQueryService,
    private readonly deliveries: PurchaseShipmentDeliveryService,
  ) {}

  @Get()
  @RequirePermissions('purchase-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseShipmentPageDto })
  @ApiApplicationContract({
    operationId: 'purchase_shipments_list', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] }, { status: 422, codes: ['VALIDATION_FAILED'] }],
  })
  list(
    @Query() query: PurchaseShipmentListQueryDto,
    @CurrentUserId() actorUserId: string = resolveDataScopeActor(),
  ): Promise<PurchaseShipmentPageDto> {
    return this.queries.list(query, actorUserId)
  }

  @Get('status-counts')
  @RequirePermissions('purchase-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseShipmentStatusCountsDto })
  @ApiApplicationContract({
    operationId: 'purchase_shipments_status_counts', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] }, { status: 422, codes: ['VALIDATION_FAILED'] }],
  })
  statusCounts(
    @Query() query: PurchaseShipmentFilterDto,
    @CurrentUserId() actorUserId: string = resolveDataScopeActor(),
  ): Promise<PurchaseShipmentStatusCountsDto> {
    return this.queries.statusCounts(query, actorUserId)
  }

  @Get(':partId')
  @RequirePermissions('purchase-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseShipmentDetailDto })
  @ApiApplicationContract({
    operationId: 'purchase_shipments_detail', session: 'required', authorization: true, badRequest: true, validation: true, resourceLocator: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] }, { status: 404, codes: ['PURCHASE_ORDER_PART_NOT_FOUND'] }, { status: 422, codes: ['VALIDATION_FAILED'] }],
  })
  detail(
    @Param() params: PurchaseShipmentIdParamDto,
    @CurrentUserId() actorUserId: string = resolveDataScopeActor(),
  ): Promise<PurchaseShipmentDetailDto> {
    return this.queries.getById(params.partId, actorUserId)
  }

  @Post(':partId/deliver')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseShipmentDeliverResultDto })
  @ApiApplicationContract({
    operationId: 'purchase_shipments_deliver', session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['PURCHASE_ORDER_PART_NOT_FOUND', 'SALES_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['PURCHASE_SHIPMENT_DELIVERY_STATE_CHANGED'] },
      { status: 422, codes: ['PURCHASE_SHIPMENT_DELIVERY_NOT_ALLOWED', 'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID', 'VALIDATION_FAILED'] },
    ],
  })
  deliver(
    @Param() params: PurchaseShipmentIdParamDto,
    @Body() dto: PurchaseShipmentDeliverRequestDto,
    @Req() request: object,
  ): Promise<PurchaseShipmentDeliverResultDto> {
    return this.deliveries.deliver(
      { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) },
      params.partId,
      dto,
    )
  }
}
