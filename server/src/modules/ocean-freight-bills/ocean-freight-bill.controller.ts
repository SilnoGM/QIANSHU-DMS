import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { OceanFreightBillCreateDto, OceanFreightBillDto, OceanFreightBillIdDto, OceanFreightBillLineCreateDto, OceanFreightBillLineDto, OceanFreightBillLinePageDto, OceanFreightBillListQueryDto, OceanFreightBillPageDto } from './ocean-freight-bill.dto'
import { OceanFreightBillService } from './ocean-freight-bill.service'

const notFound: ApiContractErrorOptions = { status: 404, codes: ['OCEAN_FREIGHT_BILL_NOT_FOUND'] }
function contract(operationId: string, mutation = false, errors: ApiContractErrorOptions[] = []) {
  return ApiApplicationContract({ operationId, session: 'required', authorization: true, csrf: mutation, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] }, { status: 422, codes: ['VALIDATION_FAILED'] }, ...errors] })
}
const commandErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['OCEAN_FREIGHT_BILL_IDEMPOTENCY_CONFLICT', 'OCEAN_FREIGHT_BILL_STATE_CHANGED'] },
  { status: 422, codes: ['VALIDATION_FAILED', 'OCEAN_FREIGHT_BILL_NUMBERING_UNAVAILABLE', 'OCEAN_FREIGHT_SOURCE_FILE_UNAVAILABLE'] },
  { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
]
function context(request: object) { return { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) } }
@ApiTags('ocean-freight-bills')
@Controller('ocean-freight-bills')
export class OceanFreightBillController {
  constructor(private readonly service: OceanFreightBillService) {}
  @Get() @RequirePermissions('ocean-freight-bills:read') @contract('ocean_freight_bills_list') @ApiContractResponse({ status: 200, type: OceanFreightBillPageDto })
  list(@Query() query: OceanFreightBillListQueryDto) { return this.service.list(query) }
  @Post() @HttpCode(201) @RequirePermissions('ocean-freight-bills:create') @contract('ocean_freight_bills_create', true, commandErrors)
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } }) @ApiContractResponse({ status: 201, type: OceanFreightBillDto })
  create(@Body() input: OceanFreightBillCreateDto, @Headers('idempotency-key') key: unknown, @Req() request: object) { return this.service.create(context(request), input, key) }
  @Get(':id') @RequirePermissions('ocean-freight-bills:read') @contract('ocean_freight_bills_get', false, [notFound]) @ApiContractResponse({ status: 200, type: OceanFreightBillDto })
  detail(@Param() params: OceanFreightBillIdDto) { return this.service.detail(params.id) }
  @Get(':id/lines') @RequirePermissions('ocean-freight-bills:read') @contract('ocean_freight_bill_lines_list', false, [notFound]) @ApiContractResponse({ status: 200, type: OceanFreightBillLinePageDto })
  lines(@Param() params: OceanFreightBillIdDto, @Query() query: OceanFreightBillListQueryDto) { return this.service.lines(params.id, query) }
  @Post(':id/lines') @HttpCode(201) @RequirePermissions('ocean-freight-bills:read', 'ocean-freight-bills:update')
  @contract('ocean_freight_bill_lines_create', true, [notFound, { status: 409, codes: ['OCEAN_FREIGHT_BILL_IDEMPOTENCY_CONFLICT', 'OCEAN_FREIGHT_BILL_STATE_CHANGED', 'OCEAN_FREIGHT_NORMAL_LINE_EXISTS'] }, { status: 422, codes: ['VALIDATION_FAILED', 'OCEAN_FREIGHT_LINE_REFERENCE_INVALID'] }])
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } }) @ApiContractResponse({ status: 201, type: OceanFreightBillLineDto })
  createLine(@Param() params: OceanFreightBillIdDto, @Body() input: OceanFreightBillLineCreateDto, @Headers('idempotency-key') key: unknown, @Req() request: object) { return this.service.createLine(context(request), params.id, input, key) }
}
