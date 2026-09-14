import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import { PurchaseShipmentDetailDto, PurchaseShipmentFilterDto, PurchaseShipmentIdParamDto, PurchaseShipmentListQueryDto, PurchaseShipmentPageDto, PurchaseShipmentStatusCountsDto } from './purchase-shipment.dto'
import { PurchaseShipmentQueryService } from './purchase-shipment-query.service'

@ApiTags('purchase-order-parts')
@Controller('purchase-order-parts')
export class PurchaseShipmentController {
  constructor(private readonly queries: PurchaseShipmentQueryService) {}

  @Get()
  @RequirePermissions('purchase-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseShipmentPageDto })
  @ApiApplicationContract({
    operationId: 'purchase_shipments_list', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] }, { status: 422, codes: ['VALIDATION_FAILED'] }],
  })
  list(@Query() query: PurchaseShipmentListQueryDto): Promise<PurchaseShipmentPageDto> {
    return this.queries.list(query)
  }

  @Get('status-counts')
  @RequirePermissions('purchase-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseShipmentStatusCountsDto })
  @ApiApplicationContract({
    operationId: 'purchase_shipments_status_counts', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] }, { status: 422, codes: ['VALIDATION_FAILED'] }],
  })
  statusCounts(@Query() query: PurchaseShipmentFilterDto): Promise<PurchaseShipmentStatusCountsDto> {
    return this.queries.statusCounts(query)
  }

  @Get(':partId')
  @RequirePermissions('purchase-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseShipmentDetailDto })
  @ApiApplicationContract({
    operationId: 'purchase_shipments_detail', session: 'required', authorization: true, badRequest: true, validation: true, resourceLocator: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] }, { status: 404, codes: ['PURCHASE_ORDER_PART_NOT_FOUND'] }, { status: 422, codes: ['VALIDATION_FAILED'] }],
  })
  detail(@Param() params: PurchaseShipmentIdParamDto): Promise<PurchaseShipmentDetailDto> {
    return this.queries.getById(params.partId)
  }
}
