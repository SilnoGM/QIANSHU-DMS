import { Controller, Get, Head, HttpCode, Param, Post, Req, Res, StreamableFile, applyDecorators } from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { ContainerSourceFileDto, ContainerSourceFileIdDto } from './container-source-file.dto'
import { CONTAINER_SOURCE_MIME, ContainerSourceFileService } from './container-source-file.service'

function contract(operationId: string, mutation = false, requiresBatch = true) {
  return ApiApplicationContract({ operationId, session: 'required', authorization: true, csrf: mutation, badRequest: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] },
      ...(requiresBatch ? [{ status: 404 as const, codes: ['CONTAINER_BATCH_NOT_FOUND', 'CONTAINER_SOURCE_FILE_NOT_FOUND'] }] : []),
      { status: 422, codes: ['VALIDATION_FAILED', ...(mutation ? [...(requiresBatch ? ['CONTAINER_SOURCE_FILE_LOCKED'] : []), 'CONTAINER_SOURCE_FILE_INVALID', 'CONTAINER_SOURCE_FILE_TOO_LARGE', 'OCEAN_FREIGHT_SOURCE_FILE_UNAVAILABLE'] : [])] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }] })
}
function binaryContract(operationId: string, head = false) {
  return applyDecorators(contract(operationId), ApiContractResponse({ status: 200, ...(head ? { description: 'Private source file headers.' } : { content: { [CONTAINER_SOURCE_MIME]: { schema: { type: 'string', format: 'binary' } } } }) }))
}
interface FileResponse { setHeader(name: string, value: string): unknown }

@ApiTags('container-batches')
@Controller('container-batches')
export class ContainerSourceFileController {
  constructor(private readonly files: ContainerSourceFileService) {}
  @Post('source-file-uploads') @HttpCode(201) @RequirePermissions('container-batches:create') @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['mediaType', 'file'], additionalProperties: false, properties: { mediaType: { type: 'string', enum: ['DOCUMENT'] }, file: { type: 'string', format: 'binary' } } } })
  @ApiContractResponse({ status: 201, type: ContainerSourceFileDto }) @contract('container_source_files_upload_for_create', true, false)
  uploadForCreate(@Req() request: SalesOrderDocumentMultipartRequest) { return this.files.uploadForCreate(getRequestAuthContext(request).userId, request) }

  @Post(':id/source-file-uploads') @HttpCode(201) @RequirePermissions('container-batches:read', 'container-batches:update') @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['mediaType', 'file'], additionalProperties: false, properties: { mediaType: { type: 'string', enum: ['DOCUMENT'] }, file: { type: 'string', format: 'binary' } } } })
  @ApiContractResponse({ status: 201, type: ContainerSourceFileDto }) @contract('container_source_files_upload', true)
  upload(@Param() params: ContainerSourceFileIdDto, @Req() request: SalesOrderDocumentMultipartRequest) { return this.files.upload(getRequestAuthContext(request).userId, params.id, request) }

  @Get(':id/source-file') @RequirePermissions('container-batches:read') @ApiContractResponse({ status: 200, type: ContainerSourceFileDto }) @contract('container_source_files_get')
  metadata(@Param() params: ContainerSourceFileIdDto) { return this.files.metadata(params.id) }

  @Get(':id/source-file/content') @RequirePermissions('container-batches:read') @binaryContract('container_source_files_download')
  async download(@Param() params: ContainerSourceFileIdDto, @Res({ passthrough: true }) response: FileResponse) {
    const result = await this.files.content(params.id, 'GET')
    for (const [key, value] of Object.entries(result.headers)) response.setHeader(key, value)
    return result.stream ? new StreamableFile(result.stream) : undefined
  }
  @Head(':id/source-file/content') @RequirePermissions('container-batches:read') @binaryContract('container_source_files_head', true)
  async head(@Param() params: ContainerSourceFileIdDto, @Res({ passthrough: true }) response: FileResponse) {
    const result = await this.files.content(params.id, 'HEAD')
    for (const [key, value] of Object.entries(result.headers)) response.setHeader(key, value)
  }
}
