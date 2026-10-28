import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  RelocateShipmentStorageRequestDto,
  ReleaseShipmentStorageRequestDto,
  ShipmentStorageDetailDto,
  ShipmentStorageIdParamDto,
  ShipmentStorageListQueryDto,
  ShipmentStoragePageDto,
} from './shipment-storage.dto'
import { ShipmentStorageService } from './shipment-storage.service'

@ApiTags('shipment-storage')
@Controller('shipment-storage')
export class ShipmentStorageController {
  constructor(private readonly storage: ShipmentStorageService) {}

  @Get()
  @RequirePermissions('shipment-storage:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStoragePageDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_list',
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
  list(@Query() query: ShipmentStorageListQueryDto): Promise<ShipmentStoragePageDto> {
    return this.storage.list(query)
  }

  @Get(':storageRecordId')
  @RequirePermissions('shipment-storage:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStorageDetailDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_detail',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['SHIPMENT_STORAGE_NOT_FOUND'] },
    ],
  })
  detail(@Param() params: ShipmentStorageIdParamDto): Promise<ShipmentStorageDetailDto> {
    return this.storage.getById(params.storageRecordId)
  }

  @Post('releases')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('shipment-storage:release')
  @ApiContractResponse({ status: HttpStatus.CREATED, type: [ShipmentStorageDetailDto] })
  @ApiApplicationContract({
    operationId: 'shipment_storage_release',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 409, codes: ['SHIPMENT_STORAGE_ALREADY_ACTIVE', 'SHIPMENT_STORAGE_IDEMPOTENCY_CONFLICT'] },
      { status: 422, codes: ['SHIPMENT_STORAGE_NOT_ALLOWED', 'SHIPMENT_STORAGE_DELIVERED', 'SHIPMENT_STORAGE_NOT_SHIPPED', 'SHIPMENT_STORAGE_NOT_RECEIVED', 'SHIPMENT_STORAGE_LOCATION_INVALID', 'SHIPMENT_STORAGE_DESTINATION_MISSING', 'SHIPMENT_STORAGE_PURCHASE_UNPAID', 'SHIPMENT_STORAGE_PACKAGING_UNPAID', 'SHIPMENT_STORAGE_SHARE_RATE_MISSING', 'VALIDATION_FAILED'] },
    ],
  })
  release(
    @Body() dto: ReleaseShipmentStorageRequestDto,
    @Req() request: object,
  ): Promise<readonly ShipmentStorageDetailDto[]> {
    return this.storage.release(
      { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) },
      dto,
    )
  }

  @Post(':storageRecordId/location')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('shipment-storage:relocate')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStorageDetailDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_relocate',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['SHIPMENT_STORAGE_NOT_FOUND'] },
      { status: 409, codes: ['SHIPMENT_STORAGE_STATE_CHANGED', 'SHIPMENT_STORAGE_IDEMPOTENCY_CONFLICT'] },
      { status: 422, codes: ['SHIPMENT_STORAGE_LOCATION_INVALID', 'VALIDATION_FAILED'] },
    ],
  })
  relocate(
    @Param() params: ShipmentStorageIdParamDto,
    @Body() dto: RelocateShipmentStorageRequestDto,
    @Req() request: object,
  ): Promise<ShipmentStorageDetailDto> {
    return this.storage.relocate(
      { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) },
      params.storageRecordId,
      dto,
    )
  }
}
