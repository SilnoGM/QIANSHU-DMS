import { Body, Controller, Get, Head, Headers, HttpCode, Param, Post, Query, Req, Res, StreamableFile } from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { SLH_BILL_SOURCE_MIME, SlhBillSourceFileService, type SlhBillSourceContent } from './slh-bill-source-file.service'
import { SlhBillService } from './slh-bill.service'
import { SlhBillQueryService } from './slh-bill-query.service'
import {
  SlhBillDto, SlhBillIdDto, SlhBillImportCreateDto, SlhBillImportPreviewDto, SlhBillLineListQueryDto,
  SlhBillLinePageDto, SlhBillListQueryDto, SlhBillMediaAssetDto, SlhBillPageDto, SlhBillStagedFileDto,
} from './slh-bill.dto'

function contract(operationId: string, mutation = false, errors: ApiContractErrorOptions[] = []) {
  return ApiApplicationContract({ operationId, session: 'required', authorization: true, csrf: mutation, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] }, { status: 422, codes: ['VALIDATION_FAILED'] }, ...errors] })
}
const notFound: ApiContractErrorOptions = { status: 404, codes: ['SLH_BILL_NOT_FOUND', 'SLH_BILL_SOURCE_FILE_UNAVAILABLE'] }
const importErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['SLH_BILL_CONFLICT', 'SLH_BILL_STATE_CHANGED', 'SLH_BILL_IDEMPOTENCY_CONFLICT', 'SLH_BILL_DUPLICATE_PERIOD', 'SLH_BILL_NUMBERING_UNAVAILABLE', 'SLH_BILL_RATE_UNAVAILABLE'] },
  { status: 422, codes: ['VALIDATION_FAILED', 'SLH_BILL_CONTENT_INVALID', 'SLH_BILL_SOURCE_FILE_INVALID', 'SLH_BILL_SOURCE_FILE_UNAVAILABLE'] },
  { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
]
function context(request: object) { return { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) } }
interface ContentResponse { status(value: number): unknown, setHeader(name: string, value: string): unknown }
function deliver(result: SlhBillSourceContent, response: ContentResponse) {
  response.status(200)
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
  return result.stream ? new StreamableFile(result.stream) : undefined
}

@ApiTags('slh-bills')
@Controller('slh-bills')
export class SlhBillController {
  constructor(
    private readonly commands: SlhBillService,
    private readonly queries: SlhBillQueryService,
    private readonly sourceFiles: SlhBillSourceFileService,
  ) {}

  @Get() @RequirePermissions('slh-bills:read') @ApiContractResponse({ status: 200, type: SlhBillPageDto }) @contract('slh_bills_list')
  list(@Query() query: SlhBillListQueryDto) { return this.queries.list(query) }

  @Get(':id') @RequirePermissions('slh-bills:read') @ApiContractResponse({ status: 200, type: SlhBillDto }) @contract('slh_bills_get', false, [notFound])
  detail(@Param() params: SlhBillIdDto) { return this.queries.get(params.id) }

  @Get(':id/lines') @RequirePermissions('slh-bills:read') @ApiContractResponse({ status: 200, type: SlhBillLinePageDto }) @contract('slh_bills_lines', false, [notFound])
  lines(@Param() params: SlhBillIdDto, @Query() query: SlhBillLineListQueryDto) { return this.queries.lines({ ...query, id: params.id }) }

  @Post('source-file-uploads') @HttpCode(201) @RequirePermissions('slh-bills:create') @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['mediaType', 'file'], additionalProperties: false, properties: { mediaType: { type: 'string', enum: ['DOCUMENT'] }, file: { type: 'string', format: 'binary' } } } })
  @ApiContractResponse({ status: 201, type: SlhBillStagedFileDto }) @contract('slh_bills_upload_source_file', true, importErrors)
  uploadSourceFile(@Req() request: SalesOrderDocumentMultipartRequest) { return this.sourceFiles.upload(context(request).actorUserId, request) }

  @Post('import-preview') @HttpCode(200) @RequirePermissions('slh-bills:create') @ApiContractResponse({ status: 200, type: SlhBillImportPreviewDto }) @contract('slh_bills_import_preview', true, importErrors)
  preview(@Body() input: SlhBillMediaAssetDto, @Req() request: object) { return this.commands.preview(context(request), input) }

  @Post() @HttpCode(201) @RequirePermissions('slh-bills:create') @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: 201, type: SlhBillDto }) @contract('slh_bills_create', true, importErrors)
  create(@Body() input: SlhBillImportCreateDto, @Headers('idempotency-key') key: unknown, @Req() request: object) { return this.commands.create(context(request), input, key) }

  @Get(':id/source-file') @RequirePermissions('slh-bills:read') @contract('slh_bills_get_source_file', false, [notFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private xlsx statement bytes.', content: { [SLH_BILL_SOURCE_MIME]: { schema: { type: 'string', format: 'binary' } } } })
  async sourceFile(@Param() params: SlhBillIdDto, @Res({ passthrough: true }) response: ContentResponse) {
    return deliver(await this.sourceFiles.content(await this.commands.sourceFile(params.id), 'GET'), response)
  }

  @Head(':id/source-file') @RequirePermissions('slh-bills:read') @contract('slh_bills_head_source_file', false, [notFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private xlsx statement headers.' })
  async headSourceFile(@Param() params: SlhBillIdDto, @Res({ passthrough: true }) response: ContentResponse) {
    deliver(await this.sourceFiles.content(await this.commands.sourceFile(params.id), 'HEAD'), response)
  }
}
