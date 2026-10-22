import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req } from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { ContainerBatchIdDto } from './container-batch.dto'
import { ContainerImportConfirmDto, ContainerImportPreviewDto, ContainerImportResultDto } from './container-import.dto'
import { ContainerImportService } from './container-import.service'

const permissions = ['container-batches:read', 'container-batches:update', 'purchase-orders:read']
function contract(operationId: string, mutation = false) {
  return ApiApplicationContract({ operationId, session: 'required', authorization: true, csrf: mutation, badRequest: true, validation: true, privateNoStore: true, errors: [
    { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] },
    { status: 404, codes: ['CONTAINER_BATCH_NOT_FOUND', 'CONTAINER_SOURCE_FILE_NOT_FOUND'] },
    { status: 409, codes: ['CONTAINER_STATE_CHANGED', 'CONTAINER_IMPORT_SOURCE_CHANGED', 'CONTAINER_IMPORT_ALREADY_IMPORTED', 'CONTAINER_IDEMPOTENCY_CONFLICT', 'CONTAINER_SHIPMENT_ALREADY_ASSIGNED', 'CONTAINER_SHIPMENT_ALREADY_LOADED'] },
    { status: 422, codes: ['VALIDATION_FAILED', 'CONTAINER_IMPORT_SOURCE_INVALID', 'CONTAINER_IMPORT_ROWS_INVALID', 'CONTAINER_IMPORT_UNMATCHED', 'CONTAINER_SHIPMENT_UNAVAILABLE', 'CONTAINER_SHIPMENT_DELIVERED', 'CONTAINER_SHIPMENT_NOT_RECEIVED', 'CONTAINER_SHIPMENT_WAREHOUSE_MISMATCH', 'OCEAN_CALCULATION_INVALID', 'OCEAN_CALCULATION_OVERFLOW'] },
    { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
  ] })
}
const context = (request: object) => ({ actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) })

@ApiTags('container-batches')
@Controller('container-batches')
export class ContainerImportController {
  constructor(private readonly service: ContainerImportService) {}
  @Get(':id/import-preview') @RequirePermissions(...permissions) @contract('container_import_preview') @ApiContractResponse({ status: 200, type: ContainerImportPreviewDto })
  preview(@Param() params: ContainerBatchIdDto, @Req() request: object) { return this.service.preview(context(request), params.id) }

  @Post(':id/import') @HttpCode(200) @RequirePermissions(...permissions) @contract('container_import_confirm', true)
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: 200, type: ContainerImportResultDto })
  confirm(@Param() params: ContainerBatchIdDto, @Body() body: ContainerImportConfirmDto, @Headers('idempotency-key') key: unknown, @Req() request: object) {
    return this.service.confirm(context(request), params.id, body, key)
  }
}
