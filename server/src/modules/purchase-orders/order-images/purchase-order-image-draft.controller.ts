import { Body, Controller, Get, Head, Headers, HttpCode, HttpStatus, Param, Post, Req, Res, StreamableFile } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../../auth/auth-context'
import { CurrentUserId, resolveDataScopeActor } from '../../auth/decorators/current-user-id.decorator'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import { PurchaseOrderIdParamDto } from '../dto/purchase-order-query.dto'
import { PurchaseOrderGenerateImageDraftRequestDto, PurchaseOrderImageDraftDto, PurchaseOrderImageDraftIdParamDto, PurchaseOrderImageDraftResponseDto } from './purchase-order-image-draft.dto'
import { PurchaseOrderImageDraftService } from './purchase-order-image-draft.service'

interface ImageContentHttpResponse {
  status(code: number): void
  setHeader(name: string, value: string): void
}
const FORBIDDEN_CODES = ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED']
const CONTENT_ERRORS = [
  { status: 403, codes: FORBIDDEN_CODES },
  { status: 404, codes: ['PURCHASE_ORDER_IMAGE_DRAFT_NOT_FOUND'] },
  { status: 422, codes: ['VALIDATION_FAILED'] },
  { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
] as const

@ApiTags('purchase-orders')
@Controller('purchase-orders')
export class PurchaseOrderImageDraftController {
  constructor(private readonly images: PurchaseOrderImageDraftService) {}

  @Get(':purchaseOrderId/order-image-draft')
  @RequirePermissions('purchase-orders:review')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderImageDraftResponseDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_get_image_draft', session: 'required', authorization: true,
    badRequest: true, resourceLocator: true, validation: true, privateNoStore: true,
    errors: [{ status: 403, codes: FORBIDDEN_CODES }, { status: 404, codes: ['PURCHASE_ORDER_NOT_FOUND'] }, { status: 422, codes: ['VALIDATION_FAILED'] }],
  })
  getDraft(
    @Param() params: PurchaseOrderIdParamDto,
    @CurrentUserId() actorUserId: string = resolveDataScopeActor(),
  ): Promise<PurchaseOrderImageDraftResponseDto> {
    return this.images.getDraft(params.purchaseOrderId, actorUserId)
  }

  @Post(':purchaseOrderId/order-image-drafts')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase-orders:review')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderImageDraftDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_generate_image_draft', session: 'required', authorization: true, csrf: true,
    badRequest: true, resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', ...FORBIDDEN_CODES] },
      { status: 404, codes: ['PURCHASE_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['PURCHASE_ORDER_STATE_CHANGED'] },
      { status: 422, codes: ['PURCHASE_ORDER_IMAGE_NOT_ALLOWED', 'PURCHASE_ORDER_IMAGE_MARKS_REQUIRED', 'PURCHASE_ORDER_IMAGE_STALE', 'PURCHASE_ORDER_IMAGE_UNAVAILABLE', 'PURCHASE_ORDER_IMAGE_TOO_LARGE', 'VALIDATION_FAILED'] },
      { status: 503, codes: ['PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE', 'MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  generate(@Param() params: PurchaseOrderIdParamDto, @Body() dto: PurchaseOrderGenerateImageDraftRequestDto, @Req() request: object): Promise<PurchaseOrderImageDraftDto> {
    return this.images.generate({ actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }, params.purchaseOrderId, dto)
  }

  @Head(':purchaseOrderId/order-image-drafts/:draftId/content')
  @RequirePermissions('purchase-orders:review')
  @ApiContractResponse({ status: HttpStatus.OK, description: 'Private generated purchase order PNG metadata.' })
  @ApiContractResponse({ status: HttpStatus.NOT_MODIFIED, description: 'Image ETag matched.' })
  @ApiApplicationContract({
    operationId: 'purchase_orders_head_image_draft_content', session: 'required', authorization: true,
    badRequest: true, resourceLocator: true, validation: true, privateNoStore: true, errors: CONTENT_ERRORS,
  })
  async headContent(@Param() params: PurchaseOrderImageDraftIdParamDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor(), @Headers('if-none-match') ifNoneMatch: unknown, @Res({ passthrough: true }) response: ImageContentHttpResponse): Promise<void> {
    const result = await this.images.resolveContent(params.purchaseOrderId, params.draftId, ifNoneMatch, 'HEAD', actorUserId)
    for (const [key, value] of Object.entries(result.headers)) response.setHeader(key, value)
    response.status(result.status)
  }

  @Get(':purchaseOrderId/order-image-drafts/:draftId/content')
  @RequirePermissions('purchase-orders:review')
  @ApiContractResponse({ status: HttpStatus.OK, description: 'Private generated purchase order PNG.', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } })
  @ApiContractResponse({ status: HttpStatus.NOT_MODIFIED, description: 'Image ETag matched.' })
  @ApiApplicationContract({
    operationId: 'purchase_orders_get_image_draft_content', session: 'required', authorization: true,
    badRequest: true, resourceLocator: true, validation: true, privateNoStore: true, errors: CONTENT_ERRORS,
  })
  async getContent(@Param() params: PurchaseOrderImageDraftIdParamDto, @CurrentUserId() actorUserId: string = resolveDataScopeActor(), @Headers('if-none-match') ifNoneMatch: unknown, @Res({ passthrough: true }) response: ImageContentHttpResponse): Promise<StreamableFile | undefined> {
    const result = await this.images.resolveContent(params.purchaseOrderId, params.draftId, ifNoneMatch, 'GET', actorUserId)
    for (const [key, value] of Object.entries(result.headers)) response.setHeader(key, value)
    response.status(result.status)
    return result.stream === undefined ? undefined : new StreamableFile(result.stream)
  }
}
