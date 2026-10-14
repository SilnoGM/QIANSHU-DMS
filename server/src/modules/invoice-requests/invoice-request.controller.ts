import { Body, Controller, Get, Head, Headers, HttpCode, Param, Post, Query, Req, Res, StreamableFile } from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { InvoiceRequestDocumentService, type InvoiceRequestDocumentContent } from './invoice-request-document.service'
import {
  InvoiceRequestCancelDto, InvoiceRequestDto, InvoiceRequestIdDto, InvoiceRequestListQueryDto, InvoiceRequestNotifyDto,
  InvoiceRequestPageDto, InvoiceRequestResubmitDto, InvoiceRequestReturnDto, InvoiceRequestSettleDto, InvoiceRequestStatusCountsDto,
  InvoiceRequestStatusCountsQueryDto, InvoiceRequestSubmitDto,
} from './invoice-request.dto'
import { InvoiceRequestQueryService } from './invoice-request-query.service'
import { InvoiceRequestService, type InvoiceRequestCommandContext } from './invoice-request.service'

function contract(operationId: string, mutation = false, errors: ApiContractErrorOptions[] = []) {
  return ApiApplicationContract({
    operationId, session: 'required', authorization: true, csrf: mutation, badRequest: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', 'INVOICE_REQUEST_OWNER_ONLY', ...(mutation ? ['CSRF_REJECTED'] : [])] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      ...errors,
    ],
  })
}

const notFound: ApiContractErrorOptions = { status: 404, codes: ['INVOICE_REQUEST_NOT_FOUND', 'INVOICE_REQUEST_DOCUMENT_REQUIRED'] }
const submitErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['INVOICE_REQUEST_DUPLICATE_SUSPECTED', 'INVOICE_REQUEST_CONFLICT', 'INVOICE_REQUEST_NUMBER_UNAVAILABLE', 'INVOICE_REQUEST_STATE_CHANGED'] },
]
const transitionErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['INVOICE_REQUEST_STATE_CHANGED', 'INVOICE_REQUEST_STATUS_NOT_ALLOWED'] },
]
const documentErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['INVOICE_REQUEST_STATE_CHANGED', 'INVOICE_REQUEST_STATUS_NOT_ALLOWED', 'INVOICE_REQUEST_DOCUMENT_EXISTS'] },
  { status: 422, codes: ['VALIDATION_FAILED', 'INVOICE_REQUEST_DOCUMENT_INVALID', 'INVOICE_REQUEST_DOCUMENT_TOO_LARGE', 'INVOICE_REQUEST_DOCUMENT_UNAVAILABLE'] },
  { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
]
const settleErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['INVOICE_REQUEST_STATE_CHANGED', 'INVOICE_REQUEST_STATUS_NOT_ALLOWED', 'INVOICE_REQUEST_RATE_CHANGED', 'INVOICE_REQUEST_RATE_UNAVAILABLE', 'INVOICE_REQUEST_POSTING_ACCOUNT_UNAVAILABLE', 'INVOICE_REQUEST_POSTING_UNAVAILABLE'] },
  { status: 422, codes: ['VALIDATION_FAILED', 'INVOICE_REQUEST_SETTLE_WAIT_PERIOD', 'INVOICE_REQUEST_DOCUMENT_REQUIRED'] },
]

function context(request: object): InvoiceRequestCommandContext {
  return { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }
}
function actorUserId(request: object): string {
  return getRequestAuthContext(request).userId
}
interface ContentResponse { status(value: number): unknown, setHeader(name: string, value: string): unknown }
function deliver(result: InvoiceRequestDocumentContent, response: ContentResponse) {
  response.status(200)
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
  return result.stream ? new StreamableFile(result.stream) : undefined
}

@ApiTags('invoice-requests')
@Controller('invoice-requests')
export class InvoiceRequestController {
  constructor(
    private readonly commands: InvoiceRequestService,
    private readonly queries: InvoiceRequestQueryService,
    private readonly documents: InvoiceRequestDocumentService,
  ) {}

  @Get() @RequirePermissions('invoice-requests:read') @ApiContractResponse({ status: 200, type: InvoiceRequestPageDto })
  @contract('invoice_requests_list')
  list(@Query() query: InvoiceRequestListQueryDto, @Req() request: object) { return this.queries.list(actorUserId(request), query) }

  // 必须排在 `:id` 之前，否则会被当成单据主键。
  @Get('status-counts') @RequirePermissions('invoice-requests:read') @ApiContractResponse({ status: 200, type: InvoiceRequestStatusCountsDto })
  @contract('invoice_requests_status_counts')
  statusCounts(@Query() query: InvoiceRequestStatusCountsQueryDto, @Req() request: object) { return this.queries.statusCounts(actorUserId(request), query) }

  @Get(':id') @RequirePermissions('invoice-requests:read') @ApiContractResponse({ status: 200, type: InvoiceRequestDto })
  @contract('invoice_requests_get', false, [notFound])
  detail(@Param() params: InvoiceRequestIdDto, @Req() request: object) { return this.queries.get(actorUserId(request), params.id) }

  @Post() @HttpCode(201) @RequirePermissions('invoice-requests:create')
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: 201, type: InvoiceRequestDto }) @contract('invoice_requests_create', true, submitErrors)
  create(@Body() input: InvoiceRequestSubmitDto, @Headers('idempotency-key') key: unknown, @Req() request: object) { return this.commands.submit(context(request), input, key) }

  @Post(':id/resubmissions') @HttpCode(200) @RequirePermissions('invoice-requests:create')
  @ApiContractResponse({ status: 200, type: InvoiceRequestDto }) @contract('invoice_requests_resubmit', true, [notFound, ...submitErrors, ...transitionErrors])
  resubmit(@Param() params: InvoiceRequestIdDto, @Body() input: InvoiceRequestResubmitDto, @Req() request: object) { return this.commands.resubmit(context(request), params.id, input) }

  @Post(':id/returns') @HttpCode(200) @RequirePermissions('invoice-requests:return')
  @ApiContractResponse({ status: 200, type: InvoiceRequestDto }) @contract('invoice_requests_return', true, [notFound, ...transitionErrors])
  returnForCorrection(@Param() params: InvoiceRequestIdDto, @Body() input: InvoiceRequestReturnDto, @Req() request: object) { return this.commands.returnForCorrection(context(request), params.id, input) }

  @Post(':id/notifications') @HttpCode(200) @RequirePermissions('invoice-requests:review')
  @ApiContractResponse({ status: 200, type: InvoiceRequestDto }) @contract('invoice_requests_notify', true, [notFound, ...transitionErrors])
  notify(@Param() params: InvoiceRequestIdDto, @Body() input: InvoiceRequestNotifyDto, @Req() request: object) { return this.commands.notify(context(request), params.id, input) }

  @Post(':id/cancellations') @HttpCode(200) @RequirePermissions('invoice-requests:cancel')
  @ApiContractResponse({ status: 200, type: InvoiceRequestDto }) @contract('invoice_requests_cancel', true, [notFound, ...transitionErrors])
  cancel(@Param() params: InvoiceRequestIdDto, @Body() input: InvoiceRequestCancelDto, @Req() request: object) { return this.commands.cancel(context(request), params.id, input) }

  @Post(':id/settlements') @HttpCode(200) @RequirePermissions('invoice-requests:settle')
  @ApiContractResponse({ status: 200, type: InvoiceRequestDto }) @contract('invoice_requests_settle', true, [notFound, ...settleErrors])
  settle(@Param() params: InvoiceRequestIdDto, @Body() input: InvoiceRequestSettleDto, @Req() request: object) { return this.commands.settle(context(request), params.id, input) }

  @Post(':id/document-uploads') @HttpCode(201) @RequirePermissions('invoice-requests:document') @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['mediaType', 'file'], additionalProperties: false, properties: { mediaType: { type: 'string', enum: ['IMAGE'] }, file: { type: 'string', format: 'binary' } } } })
  @ApiContractResponse({ status: 201, type: InvoiceRequestDto }) @contract('invoice_requests_upload_document', true, [notFound, ...documentErrors])
  uploadDocument(@Param() params: InvoiceRequestIdDto, @Req() request: SalesOrderDocumentMultipartRequest) {
    return this.upload(params.id, request)
  }

  @Get(':id/document') @RequirePermissions('invoice-requests:read') @contract('invoice_requests_get_document', false, [notFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private invoice photo bytes.', content: Object.fromEntries(['image/jpeg', 'image/png', 'image/webp'].map(mime => [mime, { schema: { type: 'string', format: 'binary' } }])) })
  async document(@Param() params: InvoiceRequestIdDto, @Req() request: object, @Res({ passthrough: true }) response: ContentResponse) {
    return deliver(await this.documents.content(await this.queries.documentAsset(actorUserId(request), params.id), 'GET'), response)
  }

  @Head(':id/document') @RequirePermissions('invoice-requests:read') @contract('invoice_requests_head_document', false, [notFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private invoice photo headers.' })
  async headDocument(@Param() params: InvoiceRequestIdDto, @Req() request: object, @Res({ passthrough: true }) response: ContentResponse) {
    return deliver(await this.documents.content(await this.queries.documentAsset(actorUserId(request), params.id), 'HEAD'), response)
  }

  /**
   * 上传以 multipart 承载，媒体文件必须最后由「解析器 → 暂存」这一条链路接管，
   * 所以单据 id 与请求体在同一个方法里串起来。
   */
  private async upload(id: string, request: SalesOrderDocumentMultipartRequest): Promise<InvoiceRequestDto> {
    const staged = await this.documents.stage(actorUserId(request), request)
    return await this.commands.uploadDocument(context(request), id, staged.mediaAssetId)
  }
}
