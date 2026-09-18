import { Body, Controller, Get, Head, Headers, HttpCode, Param, Post, Put, Query, Req, Res, StreamableFile, applyDecorators } from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequireAuthenticatedSession, RequirePermissions } from '../auth/decorators/auth.decorators'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { PackagingPaymentProfileDto, PaymentRecipientImageParamDto, PaymentRecipientImageUploadDto, SupplierPaymentProfileDto, SupplierPaymentProfilePageDto, SupplierPaymentProfileParamDto, SupplierPaymentProfileQueryDto, SupplierPaymentProfileSaveDto } from './payment-recipient.dto'
import { PackagingPaymentProfileService } from './packaging-payment-profile.service'
import { PaymentRecipientService } from './payment-recipient.service'
import { PaymentRecipientImageService, type PaymentRecipientImageContent } from './payment-recipient-image.service'

function contract(operationId: string, mutation = false, errors: ApiContractErrorOptions[] = []) {
  return ApiApplicationContract({ operationId, session: 'required', authorization: true, csrf: mutation, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] }, { status: 422, codes: ['VALIDATION_FAILED'] }, ...errors] })
}
@ApiTags('supplier-payment-profiles')
@Controller('supplier-payment-profiles')
export class SupplierPaymentProfileController {
  constructor(private readonly profiles: PaymentRecipientService) {}
  @Get() @RequirePermissions('supplier-payment-profiles:read') @ApiContractResponse({ status: 200, type: SupplierPaymentProfilePageDto }) @contract('supplier_payment_profiles_list')
  list(@Query() query: SupplierPaymentProfileQueryDto) { return this.profiles.list(query) }
  @Put(':supplierValue') @RequirePermissions('supplier-payment-profiles:read', 'supplier-payment-profiles:update')
  @ApiContractResponse({ status: 200, type: SupplierPaymentProfileDto })
  @contract('supplier_payment_profiles_save', true, [{ status: 409, codes: ['PAYMENT_RECIPIENT_STATE_CHANGED'] }, { status: 422, codes: ['VALIDATION_FAILED', 'PAYMENT_RECIPIENT_INVALID', 'PAYMENT_RECIPIENT_SUPPLIER_UNAVAILABLE', 'PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  save(@Param() params: SupplierPaymentProfileParamDto, @Body() input: SupplierPaymentProfileSaveDto, @Req() request: object) {
    return this.profiles.save({ actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }, params.supplierValue, input)
  }
}
interface ContentResponse { status(value: number): unknown, setHeader(name: string, value: string): unknown }
function deliver(result: PaymentRecipientImageContent, response: ContentResponse) {
  response.status(result.status)
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
  return result.stream ? new StreamableFile(result.stream) : undefined
}
function imageContract(operationId: string, head = false) {
  return applyDecorators(contract(operationId, false, [{ status: 404, codes: ['PAYMENT_RECIPIENT_IMAGE_NOT_FOUND'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }]),
    ApiContractResponse({ status: 200, ...(head ? { description: 'Private recipient image headers.' } : { content: Object.fromEntries(['image/jpeg', 'image/png', 'image/webp'].map(mime => [mime, { schema: { type: 'string', format: 'binary' } }])) }) }),
    ApiContractResponse({ status: 304, description: 'Image ETag matched.' }))
}
@ApiTags('payment-recipient-images')
@Controller('payment-recipient-images')
export class PaymentRecipientImageController {
  constructor(private readonly images: PaymentRecipientImageService) {}
  // 通用 Session Guard 后，领域服务显式检查配置更新或采购创建权限；不误用 AND 权限装饰器。
  @Post() @HttpCode(201) @RequireAuthenticatedSession() @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['mediaType', 'file'], additionalProperties: false, properties: { mediaType: { type: 'string', enum: ['IMAGE'] }, file: { type: 'string', format: 'binary' } } } })
  @ApiContractResponse({ status: 201, type: PaymentRecipientImageUploadDto })
  @contract('payment_recipient_images_upload', true, [{ status: 422, codes: ['VALIDATION_FAILED', 'PAYMENT_RECIPIENT_IMAGE_INVALID', 'PAYMENT_RECIPIENT_IMAGE_TOO_LARGE', 'PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  upload(@Req() request: SalesOrderDocumentMultipartRequest) { return this.images.upload(getRequestAuthContext(request).userId, request) }
  @Get(':id/content') @RequireAuthenticatedSession() @imageContract('payment_recipient_images_get_content')
  async image(@Param() params: PaymentRecipientImageParamDto, @Headers('if-none-match') tag: unknown, @Req() request: object, @Res({ passthrough: true }) response: ContentResponse) { return deliver(await this.images.content(getRequestAuthContext(request).userId, params.id, tag, 'GET'), response) }
  @Head(':id/content') @RequireAuthenticatedSession() @imageContract('payment_recipient_images_head_content', true)
  async headImage(@Param() params: PaymentRecipientImageParamDto, @Headers('if-none-match') tag: unknown, @Req() request: object, @Res({ passthrough: true }) response: ContentResponse) { deliver(await this.images.content(getRequestAuthContext(request).userId, params.id, tag, 'HEAD'), response) }
}

@ApiTags('packaging-payment-profiles')
@Controller('packaging-payment-profiles')
export class PackagingPaymentProfileController {
  constructor(private readonly profiles: PackagingPaymentProfileService) {}
  @Get('CHENGXIN') @RequireAuthenticatedSession() @ApiContractResponse({ status: 200, type: PackagingPaymentProfileDto }) @contract('packaging_payment_profiles_get')
  read(@Req() request: object) { return this.profiles.read(getRequestAuthContext(request).userId) }
  @Put('CHENGXIN') @RequirePermissions('supplier-payment-profiles:read', 'supplier-payment-profiles:update')
  @ApiContractResponse({ status: 200, type: PackagingPaymentProfileDto })
  @contract('packaging_payment_profiles_save', true, [{ status: 409, codes: ['PAYMENT_RECIPIENT_STATE_CHANGED'] }, { status: 422, codes: ['VALIDATION_FAILED', 'PAYMENT_RECIPIENT_INVALID', 'PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  save(@Body() input: SupplierPaymentProfileSaveDto, @Req() request: object) {
    return this.profiles.save({ actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }, input)
  }
}
