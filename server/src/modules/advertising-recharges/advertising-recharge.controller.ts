import { Body, Controller, Get, Head, Headers, HttpCode, Param, Post, Query, Req, Res, StreamableFile } from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import {
  ADVERTISING_RECHARGE_PERMISSION_CREATE,
  ADVERTISING_RECHARGE_PERMISSION_PAY,
  ADVERTISING_RECHARGE_PERMISSION_READ,
  ADVERTISING_RECHARGE_PERMISSION_READ_SELF,
} from './advertising-recharge.contract'
import {
  AdvertisingRechargeDto,
  AdvertisingRechargeIdDto,
  AdvertisingRechargeListQueryDto,
  AdvertisingRechargeMediaUploadDto,
  AdvertisingRechargePageDto,
  AdvertisingRechargeVersionDto,
  CreateAdvertisingRechargeDto,
  PayAdvertisingRechargeDto,
  RejectAdvertisingRechargeDto,
  VoidAdvertisingRechargeDto,
} from './advertising-recharge.dto'
import {
  AdvertisingRechargeDocumentService,
  type AdvertisingRechargeMediaContent,
} from './advertising-recharge-document.service'
import { AdvertisingRechargeQueryService } from './advertising-recharge-query.service'
import { AdvertisingRechargeService, type AdvertisingRechargeCommandContext } from './advertising-recharge.service'

function contract(operationId: string, mutation = false, errors: ApiContractErrorOptions[] = []) {
  return ApiApplicationContract({
    operationId,
    session: 'required',
    authorization: true,
    csrf: mutation,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      ...errors,
    ],
  })
}

const notFound: ApiContractErrorOptions = { status: 404, codes: ['ADVERTISING_RECHARGE_NOT_FOUND'] }
const mediaNotFound: ApiContractErrorOptions = {
  status: 404,
  codes: ['ADVERTISING_RECHARGE_QR_UNAVAILABLE', 'ADVERTISING_RECHARGE_PROOF_UNAVAILABLE'],
}
const transitionErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['ADVERTISING_RECHARGE_STATE_CHANGED', 'ADVERTISING_RECHARGE_STATUS_NOT_ALLOWED'] },
]
const proofErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['ADVERTISING_RECHARGE_STATE_CHANGED', 'ADVERTISING_RECHARGE_STATUS_NOT_ALLOWED', 'ADVERTISING_RECHARGE_PROOF_UNAVAILABLE'] },
  { status: 422, codes: ['VALIDATION_FAILED', 'ADVERTISING_RECHARGE_PROOF_INVALID', 'ADVERTISING_RECHARGE_PROOF_TOO_LARGE'] },
  { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
]

function context(request: object): AdvertisingRechargeCommandContext {
  return { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }
}

function actorUserId(request: object): string {
  return getRequestAuthContext(request).userId
}

interface ContentResponse { status(value: number): unknown, setHeader(name: string, value: string): unknown }

function deliver(result: AdvertisingRechargeMediaContent, response: ContentResponse) {
  response.status(200)
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
  return result.stream ? new StreamableFile(result.stream) : undefined
}

const IMAGE_CONTENT = Object.fromEntries(
  ['image/jpeg', 'image/png', 'image/webp'].map(mime => [mime, { schema: { type: 'string', format: 'binary' } }]),
)

@ApiTags('advertising-recharges')
@Controller('advertising-recharges')
export class AdvertisingRechargeController {
  constructor(
    private readonly commands: AdvertisingRechargeService,
    private readonly queries: AdvertisingRechargeQueryService,
    private readonly documents: AdvertisingRechargeDocumentService,
  ) {}

  // 运营侧：固定只看本人。子路由必须声明在 `:id` 之前，否则 `me` 会被当成申请 id。
  @Get('me')
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ_SELF)
  @ApiContractResponse({ status: 200, type: AdvertisingRechargePageDto })
  @contract('advertising_recharges_list_self')
  listOwn(@Query() query: AdvertisingRechargeListQueryDto, @Req() request: object) {
    return this.queries.listOwn(actorUserId(request), query)
  }

  @Get('me/:id')
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ_SELF)
  @ApiContractResponse({ status: 200, type: AdvertisingRechargeDto })
  @contract('advertising_recharges_get_self', false, [notFound])
  getOwn(@Param() params: AdvertisingRechargeIdDto, @Req() request: object) {
    return this.queries.getOwn(actorUserId(request), params.id)
  }

  @Get('me/:id/qr-content')
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ_SELF)
  @contract('advertising_recharges_get_qr_self', false, [notFound, mediaNotFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment QR bytes.', content: IMAGE_CONTENT })
  async getOwnQr(@Param() params: AdvertisingRechargeIdDto, @Req() request: object, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.qrAssetOwn(actorUserId(request), params.id)
    return deliver(await this.documents.content(asset, 'GET', 'ADVERTISING_RECHARGE_QR_UNAVAILABLE'), response)
  }

  @Head('me/:id/qr-content')
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ_SELF)
  @contract('advertising_recharges_head_qr_self', false, [notFound, mediaNotFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment QR headers.' })
  async headOwnQr(@Param() params: AdvertisingRechargeIdDto, @Req() request: object, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.qrAssetOwn(actorUserId(request), params.id)
    return deliver(await this.documents.content(asset, 'HEAD', 'ADVERTISING_RECHARGE_QR_UNAVAILABLE'), response)
  }

  @Get('me/:id/payment-proof-content')
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ_SELF)
  @contract('advertising_recharges_get_payment_proof_self', false, [notFound, mediaNotFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment proof bytes.', content: IMAGE_CONTENT })
  async getOwnProof(@Param() params: AdvertisingRechargeIdDto, @Req() request: object, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.proofAssetOwn(actorUserId(request), params.id)
    return deliver(await this.documents.content(asset, 'GET', 'ADVERTISING_RECHARGE_PROOF_UNAVAILABLE'), response)
  }

  @Head('me/:id/payment-proof-content')
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ_SELF)
  @contract('advertising_recharges_head_payment_proof_self', false, [notFound, mediaNotFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment proof headers.' })
  async headOwnProof(@Param() params: AdvertisingRechargeIdDto, @Req() request: object, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.proofAssetOwn(actorUserId(request), params.id)
    return deliver(await this.documents.content(asset, 'HEAD', 'ADVERTISING_RECHARGE_PROOF_UNAVAILABLE'), response)
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_CREATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: 201, type: AdvertisingRechargeDto })
  @contract('advertising_recharges_create', true, [
    { status: 409, codes: ['ADVERTISING_RECHARGE_ACCOUNT_UNAVAILABLE', 'ADVERTISING_RECHARGE_NUMBER_UNAVAILABLE', 'ADVERTISING_RECHARGE_IDEMPOTENCY_CONFLICT', 'ADVERTISING_RECHARGE_QR_UNAVAILABLE'] },
    { status: 422, codes: ['VALIDATION_FAILED', 'ADVERTISING_RECHARGE_VALIDATION_FAILED', 'ADVERTISING_RECHARGE_QR_REQUIRED'] },
  ])
  create(@Body() body: CreateAdvertisingRechargeDto, @Headers('idempotency-key') key: unknown, @Req() request: object) {
    return this.commands.submit(context(request), body, key)
  }

  @Post('qr-uploads')
  @HttpCode(201)
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_CREATE)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['mediaType', 'file'], additionalProperties: false, properties: { mediaType: { type: 'string', enum: ['IMAGE'] }, file: { type: 'string', format: 'binary' } } } })
  @ApiContractResponse({ status: 201, type: AdvertisingRechargeMediaUploadDto })
  @contract('advertising_recharges_upload_qr', true, [
    { status: 422, codes: ['VALIDATION_FAILED', 'ADVERTISING_RECHARGE_QR_INVALID', 'ADVERTISING_RECHARGE_QR_TOO_LARGE'] },
    { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
  ])
  uploadQr(@Req() request: SalesOrderDocumentMultipartRequest) {
    return this.documents.stageQr(actorUserId(request), request)
  }

  @Post(':id/withdrawals')
  @HttpCode(200)
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_CREATE)
  @ApiContractResponse({ status: 200, type: AdvertisingRechargeDto })
  @contract('advertising_recharges_withdraw', true, [notFound, ...transitionErrors])
  withdraw(@Param() params: AdvertisingRechargeIdDto, @Body() body: AdvertisingRechargeVersionDto, @Req() request: object) {
    return this.commands.withdraw(context(request), params.id, body.expectedVersion)
  }

  // 财务侧：全量列表与详情；本人权限码不能读取这里，反之亦然。
  @Get()
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ)
  @ApiContractResponse({ status: 200, type: AdvertisingRechargePageDto })
  @contract('advertising_recharges_list')
  list(@Query() query: AdvertisingRechargeListQueryDto) {
    return this.queries.list(query)
  }

  @Get(':id')
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ)
  @ApiContractResponse({ status: 200, type: AdvertisingRechargeDto })
  @contract('advertising_recharges_get', false, [notFound])
  get(@Param() params: AdvertisingRechargeIdDto) {
    return this.queries.getAll(params.id)
  }

  @Get(':id/qr-content')
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ)
  @contract('advertising_recharges_get_qr', false, [notFound, mediaNotFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment QR bytes.', content: IMAGE_CONTENT })
  async getQr(@Param() params: AdvertisingRechargeIdDto, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.qrAsset(params.id)
    return deliver(await this.documents.content(asset, 'GET', 'ADVERTISING_RECHARGE_QR_UNAVAILABLE'), response)
  }

  @Head(':id/qr-content')
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ)
  @contract('advertising_recharges_head_qr', false, [notFound, mediaNotFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment QR headers.' })
  async headQr(@Param() params: AdvertisingRechargeIdDto, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.qrAsset(params.id)
    return deliver(await this.documents.content(asset, 'HEAD', 'ADVERTISING_RECHARGE_QR_UNAVAILABLE'), response)
  }

  @Get(':id/payment-proof-content')
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ)
  @contract('advertising_recharges_get_payment_proof', false, [notFound, mediaNotFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment proof bytes.', content: IMAGE_CONTENT })
  async getProof(@Param() params: AdvertisingRechargeIdDto, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.proofAsset(params.id)
    return deliver(await this.documents.content(asset, 'GET', 'ADVERTISING_RECHARGE_PROOF_UNAVAILABLE'), response)
  }

  @Head(':id/payment-proof-content')
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_READ)
  @contract('advertising_recharges_head_payment_proof', false, [notFound, mediaNotFound, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment proof headers.' })
  async headProof(@Param() params: AdvertisingRechargeIdDto, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.proofAsset(params.id)
    return deliver(await this.documents.content(asset, 'HEAD', 'ADVERTISING_RECHARGE_PROOF_UNAVAILABLE'), response)
  }

  @Post(':id/payment-proofs')
  @HttpCode(201)
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_PAY)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['mediaType', 'file'], additionalProperties: false, properties: { mediaType: { type: 'string', enum: ['IMAGE'] }, file: { type: 'string', format: 'binary' } } } })
  @ApiContractResponse({ status: 201, type: AdvertisingRechargeMediaUploadDto })
  @contract('advertising_recharges_upload_payment_proof', true, [notFound, ...proofErrors])
  uploadProof(@Param() params: AdvertisingRechargeIdDto, @Req() request: SalesOrderDocumentMultipartRequest) {
    return this.documents.stageProof(actorUserId(request), params.id, request)
  }

  @Post(':id/payments')
  @HttpCode(200)
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_PAY)
  @ApiContractResponse({ status: 200, type: AdvertisingRechargeDto })
  @contract('advertising_recharges_pay', true, [
    notFound,
    ...transitionErrors,
    { status: 409, codes: ['ADVERTISING_RECHARGE_ACCOUNT_UNAVAILABLE', 'ADVERTISING_RECHARGE_POSTING_UNAVAILABLE', 'ADVERTISING_RECHARGE_PROOF_UNAVAILABLE'] },
    { status: 422, codes: ['VALIDATION_FAILED', 'ADVERTISING_RECHARGE_PROOF_REQUIRED'] },
    { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
  ])
  pay(@Param() params: AdvertisingRechargeIdDto, @Body() body: PayAdvertisingRechargeDto, @Req() request: object) {
    return this.commands.pay(context(request), params.id, body)
  }

  @Post(':id/rejections')
  @HttpCode(200)
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_PAY)
  @ApiContractResponse({ status: 200, type: AdvertisingRechargeDto })
  @contract('advertising_recharges_reject', true, [notFound, ...transitionErrors, { status: 422, codes: ['VALIDATION_FAILED', 'ADVERTISING_RECHARGE_VALIDATION_FAILED'] }])
  reject(@Param() params: AdvertisingRechargeIdDto, @Body() body: RejectAdvertisingRechargeDto, @Req() request: object) {
    return this.commands.reject(context(request), params.id, body)
  }

  @Post(':id/voids')
  @HttpCode(200)
  @RequirePermissions(ADVERTISING_RECHARGE_PERMISSION_PAY)
  @ApiContractResponse({ status: 200, type: AdvertisingRechargeDto })
  @contract('advertising_recharges_void', true, [
    notFound,
    ...transitionErrors,
    { status: 409, codes: ['ADVERTISING_RECHARGE_POSTING_UNAVAILABLE'] },
    { status: 422, codes: ['VALIDATION_FAILED', 'ADVERTISING_RECHARGE_VALIDATION_FAILED'] },
  ])
  void(@Param() params: AdvertisingRechargeIdDto, @Body() body: VoidAdvertisingRechargeDto, @Req() request: object) {
    return this.commands.void(context(request), params.id, body)
  }
}
