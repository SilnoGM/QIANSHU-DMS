import { Body, Controller, Get, Head, Headers, HttpCode, Param, Patch, Post, Query, Req, Res, StreamableFile, applyDecorators } from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { CurrentUserId, resolveDataScopeActor } from '../auth/decorators/current-user-id.decorator'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { PackagingCostShipmentIdDto, PackagingCostShipmentContextDto, PackagingCostIdDto, PackagingCostImageParamsDto, PackagingCostImageUploadDto, PackagingCostListQueryDto, PackagingCostRequestCreateDto, PackagingCostRequestDto, PackagingCostRequestPageDto, PackagingCostRequestPayDto, PackagingCostRequestUpdateAmountDto, PackagingCostRequestSummaryDto } from './packaging-cost.dto'
import { PackagingCostService } from './packaging-cost.service'
import { PackagingCostQueryService } from './packaging-cost-query.service'
import { PackagingCostImageService, type PackagingCostImageContent } from './packaging-cost-image.service'

function contract(operationId: string, mutation = false, errors: ApiContractErrorOptions[] = []) {
  return ApiApplicationContract({ operationId, session: 'required', authorization: true, csrf: mutation, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] }, { status: 422, codes: ['VALIDATION_FAILED'] }, ...errors] })
}
const notFound: ApiContractErrorOptions = { status: 404, codes: ['PACKAGING_COST_NOT_FOUND'] }
const shipmentNotFound: ApiContractErrorOptions = { status: 404, codes: ['PURCHASE_ORDER_PART_NOT_FOUND'] }
const commandErrors: ApiContractErrorOptions[] = [notFound, shipmentNotFound, { status: 409, codes: ['PACKAGING_COST_STATE_CHANGED', 'PACKAGING_COST_IDEMPOTENCY_CONFLICT', 'PAYMENT_RECIPIENT_STATE_CHANGED'] }, { status: 422, codes: ['VALIDATION_FAILED', 'PACKAGING_COST_NOT_ALLOWED', 'PACKAGING_COST_TYPE_UNAVAILABLE', 'PACKAGING_COST_IMAGE_UNAVAILABLE', 'PAYMENT_RECIPIENT_INVALID', 'PAYMENT_RECIPIENT_UNAVAILABLE', 'PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }]
function context(request: object) { return { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) } }
interface ContentResponse { status(value: number): unknown, setHeader(name: string, value: string): unknown }
function deliver(result: PackagingCostImageContent, response: ContentResponse) {
  response.status(result.status)
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
  return result.stream ? new StreamableFile(result.stream) : undefined
}
function imageContract(operationId: string, head = false) {
  return applyDecorators(contract(operationId, false, [{ status: 404, codes: ['PACKAGING_COST_IMAGE_NOT_FOUND'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }]),
    ApiContractResponse({ status: 200, ...(head ? { description: 'Private packaging image headers.' } : { content: Object.fromEntries(['image/jpeg', 'image/png', 'image/webp'].map(mime => [mime, { schema: { type: 'string', format: 'binary' } }])) }) }),
    ApiContractResponse({ status: 304, description: 'Image ETag matched.' }))
}
@ApiTags('packaging-cost-requests')
@Controller('packaging-cost-requests')
export class PackagingCostController {
  constructor(private readonly commands: PackagingCostService, private readonly queries: PackagingCostQueryService, private readonly images: PackagingCostImageService) {}
  @Get() @RequirePermissions('packaging-costs:read') @ApiContractResponse({ status: 200, type: PackagingCostRequestPageDto }) @contract('packaging_costs_list')
  list(@Query() query: PackagingCostListQueryDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor()) { return this.queries.list(query, actorUserId) }
  @Get('shipment-context/:shipmentId') @RequirePermissions('packaging-costs:create') @ApiContractResponse({ status: 200, type: PackagingCostShipmentContextDto }) @contract('packaging_costs_shipment_context', false, [shipmentNotFound])
  shipmentContext(@Param() params: PackagingCostShipmentIdDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor()) { return this.queries.shipmentContext(params.shipmentId, actorUserId) }
  @Get(':id') @RequirePermissions('packaging-costs:read') @ApiContractResponse({ status: 200, type: PackagingCostRequestDto }) @contract('packaging_costs_get', false, [notFound])
  detail(@Param() params: PackagingCostIdDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor()) { return this.queries.getById(params.id, actorUserId) }
  @Post() @HttpCode(201) @RequirePermissions('packaging-costs:create') @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } }) @ApiContractResponse({ status: 201, type: PackagingCostRequestDto }) @contract('packaging_costs_create', true, commandErrors)
  submit(@Body() input: PackagingCostRequestCreateDto, @Headers('idempotency-key') key: unknown, @Req() request: object) { return this.commands.submit(context(request), input, key) }
  @Patch(':id/amount') @RequirePermissions('packaging-costs:create') @ApiContractResponse({ status: 200, type: PackagingCostRequestSummaryDto }) @contract('packaging_costs_update_amount', true, [notFound, { status: 409, codes: ['PACKAGING_COST_STATE_CHANGED'] }])
  updateAmount(@Param() params: PackagingCostIdDto, @Body() input: PackagingCostRequestUpdateAmountDto, @Req() request: object) { return this.commands.updateAmount(context(request), params.id, input) }
  @Post(':id/pay') @HttpCode(200) @RequirePermissions('packaging-costs:read', 'packaging-costs:pay') @ApiContractResponse({ status: 200, type: PackagingCostRequestDto }) @contract('packaging_costs_pay', true, [notFound, { status: 409, codes: ['PACKAGING_COST_STATE_CHANGED', 'PAYMENT_RECIPIENT_STATE_CHANGED'] }, { status: 422, codes: ['VALIDATION_FAILED', 'PACKAGING_COST_POSTING_UNAVAILABLE', 'PACKAGING_COST_IMAGE_UNAVAILABLE', 'PAYMENT_RECIPIENT_INVALID', 'PAYMENT_RECIPIENT_UNAVAILABLE', 'PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  pay(@Param() params: PackagingCostIdDto, @Body() input: PackagingCostRequestPayDto, @Req() request: object) { return this.commands.pay(context(request), params.id, input) }
  @Post(':id/voucher-uploads') @HttpCode(201) @RequirePermissions('packaging-costs:read', 'packaging-costs:pay') @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['mediaType', 'file'], additionalProperties: false, properties: { mediaType: { type: 'string', enum: ['IMAGE'] }, file: { type: 'string', format: 'binary' } } } })
  @ApiContractResponse({ status: 201, type: PackagingCostImageUploadDto }) @contract('packaging_costs_upload_voucher', true, [notFound, { status: 409, codes: ['PACKAGING_COST_STATE_CHANGED'] }, { status: 422, codes: ['VALIDATION_FAILED', 'PACKAGING_COST_IMAGE_INVALID', 'PACKAGING_COST_IMAGE_TOO_LARGE', 'PACKAGING_COST_IMAGE_UNAVAILABLE'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  uploadVoucher(@Param() params: PackagingCostIdDto, @Req() request: SalesOrderDocumentMultipartRequest) { return this.images.upload(context(request), request, params.id) }
  @Post('images') @HttpCode(201) @RequirePermissions('packaging-costs:create') @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['mediaType', 'file'], additionalProperties: false, properties: { mediaType: { type: 'string', enum: ['IMAGE'] }, file: { type: 'string', format: 'binary' } } } })
  @ApiContractResponse({ status: 201, type: PackagingCostImageUploadDto }) @contract('packaging_costs_upload_image', true, [{ status: 422, codes: ['VALIDATION_FAILED', 'PACKAGING_COST_IMAGE_INVALID', 'PACKAGING_COST_IMAGE_TOO_LARGE'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  upload(@Req() request: SalesOrderDocumentMultipartRequest) { return this.images.upload(context(request), request) }
  @Get(':id/images/:kind') @RequirePermissions('packaging-costs:read') @imageContract('packaging_costs_get_image')
  async image(@Param() params: PackagingCostImageParamsDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor(), @Headers('if-none-match') tag: unknown, @Res({ passthrough: true }) response: ContentResponse) { return deliver(await this.images.content(params.id, params.kind, tag, 'GET', actorUserId), response) }
  @Head(':id/images/:kind') @RequirePermissions('packaging-costs:read') @imageContract('packaging_costs_head_image', true)
  async headImage(@Param() params: PackagingCostImageParamsDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor(), @Headers('if-none-match') tag: unknown, @Res({ passthrough: true }) response: ContentResponse) { deliver(await this.images.content(params.id, params.kind, tag, 'HEAD', actorUserId), response) }
}
