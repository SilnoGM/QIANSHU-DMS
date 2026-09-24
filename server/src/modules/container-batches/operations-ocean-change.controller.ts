import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { ContainerLoadingItemIdDto } from './container-batch.dto'
import { OperationsOceanContainerChangeDto, OperationsOceanContainerChangeIdDto, OperationsOceanContainerChangeResultDto, OperationsOceanContainerUndoChangeDto } from './operations-ocean-change.dto'
import { OperationsOceanChangeService } from './operations-ocean-change.service'

function contract(operationId: string, undo = false) {
  return ApiApplicationContract({ operationId, session: 'required', authorization: true, csrf: true, resourceLocator: true, badRequest: true, validation: true, privateNoStore: true, errors: [
    { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', 'CSRF_REJECTED'] },
    { status: 404, codes: ['CONTAINER_LOADING_ITEM_NOT_FOUND', ...(undo ? ['CONTAINER_CHANGE_NOT_FOUND'] : [])] },
    { status: 409, codes: ['CONTAINER_STATE_CHANGED', 'CONTAINER_CHANGE_IDEMPOTENCY_CONFLICT', ...(undo ? ['CONTAINER_CHANGE_ALREADY_UNDONE'] : [])] },
    { status: 422, codes: ['VALIDATION_FAILED', ...(!undo ? ['CONTAINER_CHANGE_NOTIFICATION_REQUIRED', 'CONTAINER_CHANGE_NO_DIFFERENCE'] : [])] },
  ] })
}
const context = (request: object) => ({ actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) })

@ApiTags('operations-ocean-containers')
@Controller('operations/ocean-containers')
export class OperationsOceanChangeController {
  constructor(private readonly changes: OperationsOceanChangeService) {}

  @Post(':id/items/:itemId/changes') @HttpCode(200) @RequirePermissions('sales-orders:read', 'sales-orders:update')
  @contract('operations_ocean_container_items_change') @ApiContractResponse({ status: 200, type: OperationsOceanContainerChangeResultDto })
  change(@Param() params: ContainerLoadingItemIdDto, @Body() input: OperationsOceanContainerChangeDto, @Req() request: object) {
    return this.changes.change(context(request), params.id, params.itemId, input)
  }

  @Post(':id/items/:itemId/changes/:changeId/undo') @HttpCode(200) @RequirePermissions('sales-orders:read', 'sales-orders:update')
  @contract('operations_ocean_container_items_undo_change', true) @ApiContractResponse({ status: 200, type: OperationsOceanContainerChangeResultDto })
  undo(@Param() params: OperationsOceanContainerChangeIdDto, @Body() input: OperationsOceanContainerUndoChangeDto, @Req() request: object) {
    return this.changes.undo(context(request), params.id, params.itemId, params.changeId, input)
  }
}
