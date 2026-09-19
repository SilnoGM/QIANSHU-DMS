import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { ContainerBatchCreateDto, ContainerBatchDto, ContainerBatchIdDto, ContainerBatchListQueryDto, ContainerBatchPageDto, ContainerLoadingItemCreateDto, ContainerLoadingItemDto, ContainerLoadingItemPageDto } from './container-batch.dto'
import { ContainerBatchService } from './container-batch.service'

function contract(operationId: string, mutation = false) {
  return ApiApplicationContract({ operationId, session: 'required', authorization: true, csrf: mutation, badRequest: true, validation: true, privateNoStore: true, errors: [
    { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] },
    { status: 404, codes: ['CONTAINER_BATCH_NOT_FOUND'] },
    ...(mutation ? [
      { status: 409, codes: ['CONTAINER_STATE_CHANGED', 'CONTAINER_BATCH_CONFLICT', 'CONTAINER_IDEMPOTENCY_CONFLICT', 'CONTAINER_SHIPMENT_ALREADY_ASSIGNED', 'CONTAINER_NUMBERING_UNAVAILABLE'] },
      { status: 422, codes: ['VALIDATION_FAILED', 'CONTAINER_WAREHOUSE_UNAVAILABLE', 'CONTAINER_SHIPMENT_UNAVAILABLE', 'OCEAN_FREIGHT_SOURCE_FILE_UNAVAILABLE', 'OCEAN_CALCULATION_INVALID', 'OCEAN_CALCULATION_OVERFLOW'] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ] as ApiContractErrorOptions[] : []),
  ] })
}
const keyHeader = () => ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
const context = (request: object) => ({ actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) })

@ApiTags('container-batches')
@Controller('container-batches')
export class ContainerBatchController {
  constructor(private readonly service: ContainerBatchService) {}
  @Get() @RequirePermissions('container-batches:read') @contract('container_batches_list') @ApiContractResponse({ status: 200, type: ContainerBatchPageDto })
  list(@Query() query: ContainerBatchListQueryDto) { return this.service.list(query) }
  @Post() @HttpCode(201) @RequirePermissions('container-batches:create') @contract('container_batches_create', true) @keyHeader() @ApiContractResponse({ status: 201, type: ContainerBatchDto })
  create(@Body() input: ContainerBatchCreateDto, @Headers('idempotency-key') key: unknown, @Req() request: object) { return this.service.create(context(request), input, key) }
  @Get(':id') @RequirePermissions('container-batches:read') @contract('container_batches_get') @ApiContractResponse({ status: 200, type: ContainerBatchDto })
  get(@Param() params: ContainerBatchIdDto) { return this.service.get(params.id) }
  @Get(':id/items') @RequirePermissions('container-batches:read') @contract('container_loading_items_list') @ApiContractResponse({ status: 200, type: ContainerLoadingItemPageDto })
  items(@Param() params: ContainerBatchIdDto, @Query() query: ContainerBatchListQueryDto) { return this.service.items(params.id, query) }
  @Post(':id/items') @HttpCode(201) @RequirePermissions('container-batches:update') @contract('container_loading_items_create', true) @keyHeader() @ApiContractResponse({ status: 201, type: ContainerLoadingItemDto })
  createItem(@Param() params: ContainerBatchIdDto, @Body() input: ContainerLoadingItemCreateDto, @Headers('idempotency-key') key: unknown, @Req() request: object) { return this.service.createItem(context(request), params.id, input, key) }
}
