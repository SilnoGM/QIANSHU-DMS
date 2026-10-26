import { Controller, Get, Param, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { CurrentUserId, resolveDataScopeActor } from '../auth/decorators/current-user-id.decorator'
import { ContainerBatchIdDto, ContainerBatchListQueryDto, ContainerLoadingItemIdDto } from './container-batch.dto'
import { OperationsOceanContainerAllLineDto, OperationsOceanContainerAllLinePageDto, OperationsOceanContainerItemsQueryDto, OperationsOceanContainerLineDto, OperationsOceanContainerLinePageDto, OperationsOceanContainerPageDto } from './operations-ocean-container.dto'
import { OperationsOceanContainerService } from './operations-ocean-container.service'

function contract(operationId: string, resourceLocator = false) {
  return ApiApplicationContract({ operationId, session: 'required', authorization: true, resourceLocator, badRequest: true, validation: true, privateNoStore: true, errors: [
    { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
    ...(resourceLocator ? [{ status: 404 as const, codes: ['CONTAINER_BATCH_NOT_FOUND', 'CONTAINER_LOADING_ITEM_NOT_FOUND'] }] : []),
  ] })
}

@ApiTags('operations-ocean-containers')
@Controller('operations/ocean-containers')
export class OperationsOceanContainerController {
  constructor(private readonly service: OperationsOceanContainerService) {}

  @Get() @RequirePermissions('sales-orders:read') @contract('operations_ocean_containers_list') @ApiContractResponse({ status: 200, type: OperationsOceanContainerPageDto })
  list(@Query() query: ContainerBatchListQueryDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor()) {
    return this.service.list(actorUserId, query)
  }

  @Get('all') @RequirePermissions('sales-orders:read') @contract('operations_ocean_containers_all_list') @ApiContractResponse({ status: 200, type: OperationsOceanContainerPageDto })
  listAll(@Query() query: ContainerBatchListQueryDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor()) {
    return this.service.listAll(actorUserId, query)
  }

  @Get('all/:id/items') @RequirePermissions('sales-orders:read') @contract('operations_ocean_container_all_items_list', true) @ApiContractResponse({ status: 200, type: OperationsOceanContainerAllLinePageDto })
  itemsAll(@Param() params: ContainerBatchIdDto, @Query() query: OperationsOceanContainerItemsQueryDto, @Req() request: object) {
    return this.service.itemsAll(getRequestAuthContext(request).userId, params.id, query)
  }

  @Get('all/:id/items/:itemId') @RequirePermissions('sales-orders:read') @contract('operations_ocean_container_all_items_get', true) @ApiContractResponse({ status: 200, type: OperationsOceanContainerAllLineDto })
  itemAll(@Param() params: ContainerLoadingItemIdDto, @Req() request: object) {
    return this.service.itemAll(getRequestAuthContext(request).userId, params.id, params.itemId)
  }

  @Get(':id/items') @RequirePermissions('sales-orders:read') @contract('operations_ocean_container_items_list', true) @ApiContractResponse({ status: 200, type: OperationsOceanContainerLinePageDto })
  items(@Param() params: ContainerBatchIdDto, @Query() query: OperationsOceanContainerItemsQueryDto, @Req() request: object) {
    return this.service.items(getRequestAuthContext(request).userId, params.id, query)
  }

  @Get(':id/items/:itemId') @RequirePermissions('sales-orders:read') @contract('operations_ocean_container_items_get', true) @ApiContractResponse({ status: 200, type: OperationsOceanContainerLineDto })
  item(@Param() params: ContainerLoadingItemIdDto, @Req() request: object) {
    return this.service.item(getRequestAuthContext(request).userId, params.id, params.itemId)
  }
}
