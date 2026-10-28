import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
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
  list(@Query() query: ShipmentStorageListQueryDto): Promise<ShipmentStoragePageDto> {
    return this.storage.list(query)
  }

  @Get(':storageRecordId')
  @RequirePermissions('shipment-storage:read')
  detail(@Param() params: ShipmentStorageIdParamDto): Promise<ShipmentStorageDetailDto> {
    return this.storage.getById(params.storageRecordId)
  }

  @Post('releases')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('shipment-storage:release')
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
