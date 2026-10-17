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
  FUND_WITHDRAWAL_PERMISSION_CREATE,
  FUND_WITHDRAWAL_PERMISSION_REVIEW,
} from './fund-withdrawal.contract'
import {
  ApproveFundWithdrawalDto,
  CreateFundWithdrawalDto,
  FundWithdrawalDto,
  FundWithdrawalIdDto,
  FundWithdrawalListQueryDto,
  FundWithdrawalPageDto,
  FundWithdrawalProofUploadDto,
  RejectFundWithdrawalDto,
} from './fund-withdrawal.dto'
import {
  FundWithdrawalDocumentService,
  type FundWithdrawalProofContent,
} from './fund-withdrawal-document.service'
import { FundWithdrawalQueryService } from './fund-withdrawal-query.service'
import {
  FundWithdrawalService,
  type FundWithdrawalCommandContext,
} from './fund-withdrawal.service'

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

const notFound: ApiContractErrorOptions = { status: 404, codes: ['FUND_WITHDRAWAL_NOT_FOUND'] }
const transitionErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['FUND_WITHDRAWAL_STATE_CHANGED', 'FUND_WITHDRAWAL_STATUS_NOT_ALLOWED'] },
]
const proofErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['FUND_WITHDRAWAL_STATE_CHANGED', 'FUND_WITHDRAWAL_STATUS_NOT_ALLOWED', 'FUND_WITHDRAWAL_PAYMENT_PROOF_UNAVAILABLE'] },
  { status: 422, codes: ['VALIDATION_FAILED', 'FUND_WITHDRAWAL_PAYMENT_PROOF_INVALID', 'FUND_WITHDRAWAL_PAYMENT_PROOF_TOO_LARGE'] },
  { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
]
const approveErrors: ApiContractErrorOptions[] = [
  { status: 409, codes: ['FUND_WITHDRAWAL_STATE_CHANGED', 'FUND_WITHDRAWAL_STATUS_NOT_ALLOWED', 'FUND_WITHDRAWAL_ACCOUNT_UNAVAILABLE', 'FUND_WITHDRAWAL_POSTING_UNAVAILABLE', 'FUND_WITHDRAWAL_PAYMENT_PROOF_UNAVAILABLE'] },
  { status: 422, codes: ['VALIDATION_FAILED', 'FUND_WITHDRAWAL_PAYMENT_PROOF_REQUIRED'] },
  { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
]

function context(request: object): FundWithdrawalCommandContext {
  return { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }
}

function actorUserId(request: object): string {
  return getRequestAuthContext(request).userId
}

interface ContentResponse { status(value: number): unknown, setHeader(name: string, value: string): unknown }

function deliver(result: FundWithdrawalProofContent, response: ContentResponse) {
  response.status(200)
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
  return result.stream ? new StreamableFile(result.stream) : undefined
}

@ApiTags('fund-withdrawals')
@Controller('fund-withdrawals')
export class FundWithdrawalController {
  constructor(
    private readonly commands: FundWithdrawalService,
    private readonly queries: FundWithdrawalQueryService,
    private readonly documents: FundWithdrawalDocumentService,
  ) {}

  @Get('me')
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_CREATE)
  @ApiContractResponse({ status: 200, type: FundWithdrawalPageDto })
  @contract('fund_withdrawals_list_self')
  listOwn(@Query() query: FundWithdrawalListQueryDto, @Req() request: object) {
    return this.queries.listOwn(actorUserId(request), query)
  }

  @Get('me/:id')
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_CREATE)
  @ApiContractResponse({ status: 200, type: FundWithdrawalDto })
  @contract('fund_withdrawals_get_self', false, [notFound])
  getOwn(@Param() params: FundWithdrawalIdDto, @Req() request: object) {
    return this.queries.getOwn(actorUserId(request), params.id)
  }

  @Get('me/:id/payment-proof')
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_CREATE)
  @contract('fund_withdrawals_get_payment_proof_self', false, [notFound, { status: 404, codes: ['FUND_WITHDRAWAL_PAYMENT_PROOF_UNAVAILABLE'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment proof bytes.', content: Object.fromEntries(['image/jpeg', 'image/png', 'image/webp'].map(mime => [mime, { schema: { type: 'string', format: 'binary' } }])) })
  async getOwnPaymentProof(@Param() params: FundWithdrawalIdDto, @Req() request: object, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.proofAssetOwn(actorUserId(request), params.id)
    return deliver(await this.documents.content(asset, 'GET'), response)
  }

  @Head('me/:id/payment-proof')
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_CREATE)
  @contract('fund_withdrawals_head_payment_proof_self', false, [notFound, { status: 404, codes: ['FUND_WITHDRAWAL_PAYMENT_PROOF_UNAVAILABLE'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment proof headers.' })
  async headOwnPaymentProof(@Param() params: FundWithdrawalIdDto, @Req() request: object, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.proofAssetOwn(actorUserId(request), params.id)
    return deliver(await this.documents.content(asset, 'HEAD'), response)
  }

  @Get()
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_REVIEW)
  @ApiContractResponse({ status: 200, type: FundWithdrawalPageDto })
  @contract('fund_withdrawals_list')
  list(@Query() query: FundWithdrawalListQueryDto) {
    return this.queries.listReview(query)
  }

  @Get(':id')
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_REVIEW)
  @ApiContractResponse({ status: 200, type: FundWithdrawalDto })
  @contract('fund_withdrawals_get', false, [notFound])
  get(@Param() params: FundWithdrawalIdDto) {
    return this.queries.getReview(params.id)
  }

  @Get(':id/payment-proof')
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_REVIEW)
  @contract('fund_withdrawals_get_payment_proof', false, [notFound, { status: 404, codes: ['FUND_WITHDRAWAL_PAYMENT_PROOF_UNAVAILABLE'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment proof bytes.', content: Object.fromEntries(['image/jpeg', 'image/png', 'image/webp'].map(mime => [mime, { schema: { type: 'string', format: 'binary' } }])) })
  async getPaymentProof(@Param() params: FundWithdrawalIdDto, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.proofAssetReview(params.id)
    return deliver(await this.documents.content(asset, 'GET'), response)
  }

  @Head(':id/payment-proof')
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_REVIEW)
  @contract('fund_withdrawals_head_payment_proof', false, [notFound, { status: 404, codes: ['FUND_WITHDRAWAL_PAYMENT_PROOF_UNAVAILABLE'] }, { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] }])
  @ApiContractResponse({ status: 200, description: 'Private payment proof headers.' })
  async headPaymentProof(@Param() params: FundWithdrawalIdDto, @Res({ passthrough: true }) response: ContentResponse) {
    const asset = await this.queries.proofAssetReview(params.id)
    return deliver(await this.documents.content(asset, 'HEAD'), response)
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_CREATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: 201, type: FundWithdrawalDto })
  @contract('fund_withdrawals_create', true, [
    { status: 409, codes: ['FUND_WITHDRAWAL_ACCOUNT_UNAVAILABLE', 'FUND_WITHDRAWAL_NUMBER_UNAVAILABLE', 'FUND_WITHDRAWAL_IDEMPOTENCY_CONFLICT'] },
    { status: 422, codes: ['VALIDATION_FAILED', 'FUND_WITHDRAWAL_AMOUNT_INVALID'] },
  ])
  create(@Body() body: CreateFundWithdrawalDto, @Headers('idempotency-key') key: unknown, @Req() request: object) {
    return this.commands.submit(context(request), body, key)
  }

  @Post(':id/payment-proofs')
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_REVIEW)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['mediaType', 'file'], additionalProperties: false, properties: { mediaType: { type: 'string', enum: ['IMAGE'] }, file: { type: 'string', format: 'binary' } } } })
  @ApiContractResponse({ status: 201, type: FundWithdrawalProofUploadDto })
  @contract('fund_withdrawals_upload_payment_proof', true, [notFound, ...proofErrors])
  async uploadPaymentProof(@Param() params: FundWithdrawalIdDto, @Req() request: SalesOrderDocumentMultipartRequest) {
    return this.documents.stage(actorUserId(request), params.id, request)
  }

  @Post(':id/rejections')
  @HttpCode(200)
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_REVIEW)
  @ApiContractResponse({ status: 200, type: FundWithdrawalDto })
  @contract('fund_withdrawals_reject', true, [notFound, ...transitionErrors, { status: 422, codes: ['VALIDATION_FAILED', 'FUND_WITHDRAWAL_VALIDATION_FAILED'] }])
  reject(@Param() params: FundWithdrawalIdDto, @Body() body: RejectFundWithdrawalDto, @Req() request: object) {
    return this.commands.reject(context(request), params.id, body)
  }

  @Post(':id/approvals')
  @HttpCode(200)
  @RequirePermissions(FUND_WITHDRAWAL_PERMISSION_REVIEW)
  @ApiContractResponse({ status: 200, type: FundWithdrawalDto })
  @contract('fund_withdrawals_approve', true, [notFound, ...approveErrors])
  approve(@Param() params: FundWithdrawalIdDto, @Body() body: ApproveFundWithdrawalDto, @Req() request: object) {
    return this.commands.approve(context(request), params.id, body)
  }
}
