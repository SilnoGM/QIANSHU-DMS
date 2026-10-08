import { SalesReceiptService } from './receipts/sales-receipt.service'
import {
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger'

import { ImmutableMediaContentCache } from '../../infrastructure/http/private-no-store.interceptor'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { SalesOrderProductsUpdateRequestDto } from './dto/sales-order-product-edit.dto'
import {
  SalesOrderDeliveryReceiptRequestDto,
  SalesOrderDocumentIdParamDto,
  SalesOrderDocumentUploadRequestDto,
  SalesOrderTemporaryDocumentDto,
} from './dto/sales-order-document.dto'
import { CreateSalesOrderRequestDto } from './dto/sales-order-create.dto'
import {
  SalesOrderFulfillmentStatusRequestDto,
  SalesOrderPaymentRequestDto,
  SalesOrderPaymentTermsRequestDto,
  SalesOrderPaymentVoidRequestDto,
  SalesOrderStatusRequestDto,
} from './dto/sales-order-mutation.dto'
import {
  SalesOrderIdParamDto,
  SalesOrderLineProductImageParamDto,
  SalesOrderListQueryDto,
  SalesOrderPaymentIdParamDto,
  SalesOrderProductImageParamDto,
  SalesOrderProductImageQueryDto,
  SalesOrderProductEditImageParamDto,
  SalesOrderProductEditOptionsQueryDto,
  SalesOrderProductOptionsQueryDto,
  SalesOrderStatusCountsQueryDto,
} from './dto/sales-order-query.dto'
import {
  SalesOrderDetailDto,
  SalesOrderIssuerOptionsDto,
  SalesOrderPageDto,
  SalesOrderProductOptionsDto,
  SalesOrderProductEditContextDto,
  SalesOrderProductsUpdateResultDto,
  SalesOrderStatusCountsDto,
} from './dto/sales-order-response.dto'
import { SalesOrderProductEditQueryService } from './sales-order-product-edit-query.service'
import {
  SalesOrderProductEditService,
  type SalesOrderProductsUpdateResult,
} from './sales-order-product-edit.service'
import { SalesOrderCommandService } from './sales-order-command.service'
import { parseSalesOrderIdempotencyKey } from './sales-order-command.normalizer'
import { SalesOrderMutationService } from './sales-order-mutation.service'
import { ApiProductMediaContentContract } from '../products/media/product-media-content.contract'
import {
  applyProductMediaContentResponse,
  type ProductMediaContentHttpResponse,
} from '../products/media/product-media-content.http'
import { SalesOrderProductImageService } from './products/sales-order-product-image.service'
import {
  SalesOrderDocumentService,
  type SalesOrderDocumentContentResponse,
  type SalesOrderTemporaryDocument,
} from './documents/sales-order-document.service'
import type {
  SalesOrderDocumentMultipartRequest,
} from './documents/sales-order-document-multipart.parser'
import {
  SalesOrderQueryService,
  type SalesOrderDetail,
  type SalesOrderIssuerOptions,
  type SalesOrderPage,
  type SalesOrderStatusCounts,
} from './sales-order-query.service'

const COMMON_FORBIDDEN_ERRORS = [
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
] as const
const COMMON_MUTATION_FORBIDDEN_ERRORS = [
  'CSRF_REJECTED',
  ...COMMON_FORBIDDEN_ERRORS,
] as const

function mutationContext(request: object) {
  return {
    actorUserId: getRequestAuthContext(request).userId,
    requestId: getRequestId(request),
  }
}

interface SalesOrderDocumentHttpResponse {
  setHeader(name: string, value: string): unknown
  status(statusCode: number): unknown
}

function applyDocumentContentResponse(
  response: SalesOrderDocumentHttpResponse,
  result: SalesOrderDocumentContentResponse,
): void {
  response.status(result.status)
  for (const [name, value] of Object.entries(result.headers)) {
    response.setHeader(name, value)
  }
}

@ApiTags('sales-orders')
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(
    private readonly queries: SalesOrderQueryService,
    private readonly receipts: SalesReceiptService,
    private readonly commands: SalesOrderCommandService,
    private readonly mutations: SalesOrderMutationService,
    private readonly documents: SalesOrderDocumentService,
    private readonly productImages: SalesOrderProductImageService,
    private readonly productEditQueries?: SalesOrderProductEditQueryService,
    private readonly productEditService?: SalesOrderProductEditService,
  ) {}

  @Get()
  @RequirePermissions('sales-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderPageDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  list(@Query() query: SalesOrderListQueryDto): Promise<SalesOrderPage> {
    return this.queries.list(query)
  }

  @Get('status-counts')
  @RequirePermissions('sales-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderStatusCountsDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_status_counts',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  statusCounts(
    @Query() query: SalesOrderStatusCountsQueryDto,
  ): Promise<SalesOrderStatusCounts> {
    return this.queries.statusCounts(query)
  }

  @Get('issuer-options')
  @RequirePermissions('sales-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderIssuerOptionsDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_issuer_options',
    session: 'required',
    authorization: true,
    badRequest: true,
    privateNoStore: true,
    errors: [{ status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] }],
  })
  issuerOptions(): Promise<SalesOrderIssuerOptions> {
    return this.queries.issuerOptions()
  }

  @Get('product-options')
  @RequirePermissions('sales-orders:create')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: SalesOrderProductOptionsDto,
  })
  @ApiApplicationContract({
    operationId: 'sales_orders_product_options',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 409, codes: ['SALES_ORDER_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  productOptions(
    @Query() query: SalesOrderProductOptionsQueryDto,
  ): Promise<SalesOrderProductOptionsDto> {
    return this.queries.productOptions(query)
  }

  @Get(':salesOrderId/product-edit-context')
  @RequirePermissions('sales-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderProductEditContextDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_get_product_edit_context',
    session: 'required', authorization: true, badRequest: true,
    resourceLocator: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: [
        'SALES_ORDER_PRODUCT_EDIT_NOT_ALLOWED',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  productEditContext(
    @Param() params: SalesOrderIdParamDto,
  ): Promise<SalesOrderProductEditContextDto> {
    if (this.productEditQueries === undefined) {
      throw new Error('SalesOrderProductEditQueryService is not configured')
    }
    return this.productEditQueries.context(params.salesOrderId)
  }

  /**
   * 产品修改会同时改变销售明细、金额、付款与采购覆盖状态；Controller 只传递
   * 可信操作者和请求 ID，且显式禁止客户端或中间层自动重放。
   */
  @Patch(':salesOrderId/products')
  @RequirePermissions('sales-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderProductsUpdateResultDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_update_products',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    retry: false,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 409, codes: [
        'SALES_ORDER_PRODUCT_EDIT_STATE_CHANGED',
        'SALES_ORDER_PRODUCT_EDIT_VERSION_CONFLICT',
      ] },
      { status: 422, codes: [
        'SALES_ORDER_DEPOSIT_REDUCTION_CONFIRMATION_REQUIRED',
        'SALES_ORDER_LINE_LIMIT_EXCEEDED',
        'SALES_ORDER_PRODUCT_DECREASE_PURCHASE_LOCKED',
        'SALES_ORDER_PRODUCT_EDIT_NOT_ALLOWED',
        'SALES_ORDER_TOTAL_BELOW_RECEIVED',
        'SALES_RECEIPT_AMOUNT_EXCEEDS_AVAILABLE',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  updateProducts(
    @Param() params: SalesOrderIdParamDto,
    @Body() dto: SalesOrderProductsUpdateRequestDto,
    @Req() request: object,
  ): Promise<SalesOrderProductsUpdateResult> {
    if (this.productEditService === undefined) {
      throw new Error('SalesOrderProductEditService is not configured')
    }
    return this.productEditService.updateProducts(
      mutationContext(request),
      params.salesOrderId,
      dto,
    )
  }

  @Get(':salesOrderId/product-edit-options')
  @RequirePermissions('sales-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderProductOptionsDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_get_product_edit_options',
    session: 'required', authorization: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['SALES_ORDER_STATE_CHANGED'] },
      {
        status: 422,
        codes: [
          'SALES_ORDER_PRODUCT_EDIT_NOT_ALLOWED',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  productEditOptions(
    @Param() params: SalesOrderIdParamDto,
    @Query() query: SalesOrderProductEditOptionsQueryDto,
  ): Promise<SalesOrderProductOptionsDto> {
    if (this.productEditQueries === undefined) {
      throw new Error('SalesOrderProductEditQueryService is not configured')
    }
    return this.productEditQueries.productOptions(params.salesOrderId, query)
  }

  @Head(':salesOrderId/product-edit-options/:productId/main-image/:productMediaId/content')
  @ImmutableMediaContentCache()
  @RequirePermissions('sales-orders:update')
  @ApiProductMediaContentContract('HEAD', {
    operationId: 'sales_orders_head_product_edit_option_main_image',
    notFoundCode: 'SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND',
    description: 'Authorized sales-order product-edit option main image.',
  })
  async headProductEditOptionMainImage(
    @Param() params: SalesOrderProductEditImageParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Headers('range') range: unknown,
    @Query('variant') variant: unknown,
    @Res({ passthrough: true }) response: ProductMediaContentHttpResponse,
  ): Promise<void> {
    const result = await this.productImages.resolveProductEditOption(
      params.salesOrderId,
      params.productId,
      params.productMediaId,
      ifNoneMatch,
      range,
      'HEAD',
      variant,
    )
    applyProductMediaContentResponse(response, result)
  }

  @Get(':salesOrderId/product-edit-options/:productId/main-image/:productMediaId/content')
  @ImmutableMediaContentCache()
  @RequirePermissions('sales-orders:update')
  @ApiProductMediaContentContract('GET', {
    operationId: 'sales_orders_get_product_edit_option_main_image',
    notFoundCode: 'SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND',
    description: 'Authorized sales-order product-edit option main image.',
  })
  async getProductEditOptionMainImage(
    @Param() params: SalesOrderProductEditImageParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Headers('range') range: unknown,
    @Query('variant') variant: unknown,
    @Res({ passthrough: true }) response: ProductMediaContentHttpResponse,
  ): Promise<StreamableFile | undefined> {
    const result = await this.productImages.resolveProductEditOption(
      params.salesOrderId,
      params.productId,
      params.productMediaId,
      ifNoneMatch,
      range,
      'GET',
      variant,
    )
    applyProductMediaContentResponse(response, result)
    return result.stream === undefined
      ? undefined
      : new StreamableFile(result.stream)
  }

  @Head('product-options/:productId/main-image/:productMediaId/content')
  @ImmutableMediaContentCache()
  @RequirePermissions('sales-orders:create')
  @ApiProductMediaContentContract('HEAD', {
    operationId: 'sales_orders_head_product_option_main_image',
    notFoundCode: 'SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND',
    description: 'Authorized sales-order product option main image.',
  })
  async headProductOptionMainImage(
    @Param() params: SalesOrderProductImageParamDto,
    @Query() query: SalesOrderProductImageQueryDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Headers('range') range: unknown,
    @Res({ passthrough: true }) response: ProductMediaContentHttpResponse,
  ): Promise<void> {
    const result = await this.productImages.resolve(
      params.productId,
      params.productMediaId,
      query.currencyCode,
      ifNoneMatch,
      range,
      'HEAD',
      query.variant,
    )
    applyProductMediaContentResponse(response, result)
  }

  @Get('product-options/:productId/main-image/:productMediaId/content')
  @ImmutableMediaContentCache()
  @RequirePermissions('sales-orders:create')
  @ApiProductMediaContentContract('GET', {
    operationId: 'sales_orders_get_product_option_main_image',
    notFoundCode: 'SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND',
    description: 'Authorized sales-order product option main image.',
  })
  async getProductOptionMainImage(
    @Param() params: SalesOrderProductImageParamDto,
    @Query() query: SalesOrderProductImageQueryDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Headers('range') range: unknown,
    @Res({ passthrough: true }) response: ProductMediaContentHttpResponse,
  ): Promise<StreamableFile | undefined> {
    const result = await this.productImages.resolve(
      params.productId,
      params.productMediaId,
      query.currencyCode,
      ifNoneMatch,
      range,
      'GET',
      query.variant,
    )
    applyProductMediaContentResponse(response, result)
    return result.stream === undefined
      ? undefined
      : new StreamableFile(result.stream)
  }

  @Head(':salesOrderId/lines/:lineId/main-image/:productMediaId/content')
  @ImmutableMediaContentCache()
  @RequirePermissions('sales-orders:read')
  @ApiProductMediaContentContract('HEAD', {
    operationId: 'sales_orders_head_product_preview_main_image',
    notFoundCode: 'SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND',
    description: 'Authorized sales-order list product preview image.',
  })
  async headProductPreviewMainImage(
    @Param() params: SalesOrderLineProductImageParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Headers('range') range: unknown,
    @Query('variant') variant: unknown,
    @Res({ passthrough: true }) response: ProductMediaContentHttpResponse,
  ): Promise<void> {
    const result = await this.productImages.resolveListPreview(
      params.salesOrderId,
      params.lineId,
      params.productMediaId,
      ifNoneMatch,
      range,
      'HEAD',
      variant,
    )
    applyProductMediaContentResponse(response, result)
  }

  @Get(':salesOrderId/lines/:lineId/main-image/:productMediaId/content')
  @ImmutableMediaContentCache()
  @RequirePermissions('sales-orders:read')
  @ApiProductMediaContentContract('GET', {
    operationId: 'sales_orders_get_product_preview_main_image',
    notFoundCode: 'SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND',
    description: 'Authorized sales-order list product preview image.',
  })
  async getProductPreviewMainImage(
    @Param() params: SalesOrderLineProductImageParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Headers('range') range: unknown,
    @Query('variant') variant: unknown,
    @Res({ passthrough: true }) response: ProductMediaContentHttpResponse,
  ): Promise<StreamableFile | undefined> {
    const result = await this.productImages.resolveListPreview(
      params.salesOrderId,
      params.lineId,
      params.productMediaId,
      ifNoneMatch,
      range,
      'GET',
      variant,
    )
    applyProductMediaContentResponse(response, result)
    return result.stream === undefined
      ? undefined
      : new StreamableFile(result.stream)
  }

  @Post('document-uploads')
  @RequirePermissions('sales-orders:document')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: SalesOrderDocumentUploadRequestDto })
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: SalesOrderTemporaryDocumentDto,
  })
  @ApiApplicationContract({
    operationId: 'sales_orders_upload_temporary_document',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 422, codes: [
        'SALES_ORDER_DOCUMENT_CONTENT_INVALID',
        'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE',
        'SALES_ORDER_DOCUMENT_CONTENT_UNSUPPORTED',
        'SALES_ORDER_DOCUMENT_MULTIPART_INVALID',
      ] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  uploadTemporaryDocument(
    @Req() request: SalesOrderDocumentMultipartRequest,
  ): Promise<SalesOrderTemporaryDocument> {
    return this.documents.uploadTemporary(mutationContext(request), request)
  }

  @Post()
  @RequirePermissions('sales-orders:create', 'sales-orders:document')
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: {
      type: 'string',
      format: 'uuid',
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    },
  })
  @ApiContractResponse({ status: HttpStatus.CREATED, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_create',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      {
        status: 409,
        codes: [
          'SALES_ORDER_CREATE_IDEMPOTENCY_CONFLICT',
          'SALES_ORDER_NUMBERING_UNAVAILABLE',
          'SALES_ORDER_STATE_CHANGED',
        ],
      },
      {
        status: 422,
        codes: [
          'ADDRESS_DETAIL_CONTAINS_SELECTED_REGION',
          'SALES_ORDER_CURRENCY_UNAVAILABLE',
          'SALES_ORDER_DOCUMENT_UNAVAILABLE',
          'SALES_ORDER_PAYMENT_TERMS_MISMATCH',
          'SALES_ORDER_PRODUCT_UNAVAILABLE',
          'SALES_ORDER_REGION_UNAVAILABLE',
          'SALES_ORDER_TOTAL_MISMATCH',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  create(
    @Body() dto: CreateSalesOrderRequestDto,
    @Req() request: object,
    @Headers('idempotency-key') rawIdempotencyKey: unknown,
  ): Promise<SalesOrderDetail> {
    return this.commands.create({
      ...mutationContext(request),
      idempotencyKey: parseSalesOrderIdempotencyKey(rawIdempotencyKey),
    }, dto)
  }

  @Get(':salesOrderId')
  @RequirePermissions('sales-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_get_by_id',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  getById(@Param() params: SalesOrderIdParamDto): Promise<SalesOrderDetail> {
    return this.queries.getById(params.salesOrderId)
  }

  @Patch(':salesOrderId/order-status')
  @RequirePermissions('sales-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_update_order_status',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 409, codes: ['SALES_RECEIPT_STATE_CHANGED'] },
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: [
        'SALES_ORDER_CANCEL_HAS_PAYMENTS',
        'SALES_ORDER_COMPLETION_CONDITIONS_NOT_MET',
        'SALES_ORDER_RECONCILIATION_CONDITIONS_NOT_MET',
        'SALES_ORDER_STATUS_TRANSITION_INVALID',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  updateOrderStatus(
    @Param() params: SalesOrderIdParamDto,
    @Body() dto: SalesOrderStatusRequestDto,
    @Req() request: object,
  ): Promise<SalesOrderDetail> {
    return this.mutations.updateOrderStatus(
      mutationContext(request),
      params.salesOrderId,
      dto,
    )
  }

  @Patch(':salesOrderId/fulfillment-status')
  @RequirePermissions('sales-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_update_fulfillment_status',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: [
        'SALES_ORDER_CANCELLED',
        'SALES_ORDER_COMPLETED',
        'SALES_ORDER_DELIVERY_RECEIPT_REQUIRED',
        'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  updateFulfillmentStatus(
    @Param() params: SalesOrderIdParamDto,
    @Body() dto: SalesOrderFulfillmentStatusRequestDto,
    @Req() request: object,
  ): Promise<SalesOrderDetail> {
    return this.mutations.updateFulfillmentStatus(
      mutationContext(request),
      params.salesOrderId,
      dto,
    )
  }

  @Patch(':salesOrderId/payment-terms')
  @RequirePermissions('sales-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_update_payment_terms',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: [
        'SALES_ORDER_PAYMENT_EXCEEDS_TOTAL',
        'SALES_RECEIPT_AMOUNT_EXCEEDS_AVAILABLE',
        'SALES_ORDER_PAYMENT_TERMS_MISMATCH',
        'SALES_ORDER_PAYMENT_TERMS_NOT_EDITABLE',
        'SALES_ORDER_TOTAL_MISMATCH',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  updatePaymentTerms(
    @Param() params: SalesOrderIdParamDto,
    @Body() dto: SalesOrderPaymentTermsRequestDto,
    @Req() request: object,
  ): Promise<SalesOrderDetail> {
    return this.mutations.updatePaymentTerms(
      mutationContext(request),
      params.salesOrderId,
      dto,
    )
  }

  @Post(':salesOrderId/payments')
  @RequirePermissions('sales-orders:payment', 'sales-orders:document')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({ status: HttpStatus.CREATED, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_record_payment',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['SALES_ORDER_RECEIPT_REVIEW_REQUIRED'] },
      { status: 422, codes: [
        'SALES_ORDER_CANCELLED',
        'SALES_ORDER_COMPLETED',
        'SALES_ORDER_PAYMENT_AMOUNT_INVALID',
        'SALES_ORDER_PAYMENT_EXCEEDS_TOTAL',
        'SALES_RECEIPT_AMOUNT_EXCEEDS_AVAILABLE',
        'SALES_ORDER_PAYMENT_METHOD_UNAVAILABLE',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  recordPayment(
    @Param() params: SalesOrderIdParamDto,
    @Body() dto: SalesOrderPaymentRequestDto,
    @Req() request: object,
  ): Promise<SalesOrderDetail> {
    return this.mutations.recordPayment(
      mutationContext(request),
      params.salesOrderId,
      dto,
    )
  }

  @Post(':salesOrderId/payments/:paymentId/void')
  @RequirePermissions('sales-receipts:void')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_void_payment',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 409, codes: ['SALES_RECEIPT_STATE_CHANGED', 'SALES_RECEIPT_REVERSAL_CONFLICT'] },
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: [
        'SALES_ORDER_NOT_FOUND',
        'SALES_ORDER_PAYMENT_NOT_FOUND',
      ] },
      { status: 422, codes: [
        'SALES_ORDER_COMPLETED',
        'SALES_RECEIPT_POSTING_UNAVAILABLE',
        'SALES_ORDER_PAYMENT_ALREADY_VOIDED',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  async voidPayment(
    @Param() params: SalesOrderPaymentIdParamDto,
    @Body() dto: SalesOrderPaymentVoidRequestDto,
    @Req() request: object,
  ): Promise<SalesOrderDetail> {
    await this.receipts.voidPayment(
      mutationContext(request),
      params.salesOrderId,
      params.paymentId,
      dto,
    )
    return this.queries.getById(params.salesOrderId)
  }

  @Post(':salesOrderId/delivery-receipts')
  @RequirePermissions('sales-orders:document')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({ status: HttpStatus.CREATED, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_submit_delivery_receipt',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: [
        'SALES_ORDER_CANCELLED',
        'SALES_ORDER_COMPLETED',
        'SALES_ORDER_DOCUMENT_UNAVAILABLE',
        'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID',
        'VALIDATION_FAILED',
      ] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  submitDeliveryReceipt(
    @Param() params: SalesOrderIdParamDto,
    @Body() dto: SalesOrderDeliveryReceiptRequestDto,
    @Req() request: object,
  ): Promise<SalesOrderDetail> {
    return this.documents.submitDeliveryReceipt(
      mutationContext(request),
      params.salesOrderId,
      dto,
    )
  }

  @Delete(':salesOrderId/documents/:documentId')
  @RequirePermissions('sales-orders:document')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_detach_document',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: [
        'SALES_ORDER_DOCUMENT_NOT_FOUND',
        'SALES_ORDER_NOT_FOUND',
      ] },
      { status: 422, codes: [
        'SALES_ORDER_DELIVERY_RECEIPT_REQUIRED',
        'SALES_ORDER_DOCUMENT_REQUIRED',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  detachDocument(
    @Param() params: SalesOrderDocumentIdParamDto,
    @Req() request: object,
  ): Promise<SalesOrderDetail> {
    return this.documents.detach(
      mutationContext(request),
      params.salesOrderId,
      params.documentId,
    )
  }

  @Head(':salesOrderId/documents/:documentId/content')
  @RequirePermissions('sales-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, description: 'Private sales order document.' })
  @ApiContractResponse({ status: HttpStatus.NOT_MODIFIED, description: 'Document ETag matched.' })
  @ApiApplicationContract({
    operationId: 'sales_orders_head_document_content',
    session: 'required', authorization: true, badRequest: true,
    resourceLocator: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_DOCUMENT_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  async headDocumentContent(
    @Param() params: SalesOrderDocumentIdParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Res({ passthrough: true }) response: SalesOrderDocumentHttpResponse,
  ): Promise<void> {
    const result = await this.documents.resolveContent(
      params.salesOrderId,
      params.documentId,
      ifNoneMatch,
      'HEAD',
    )
    applyDocumentContentResponse(response, result)
  }

  @Get(':salesOrderId/documents/:documentId/content')
  @RequirePermissions('sales-orders:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    description: 'Private sales order document.',
    content: {
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
      'image/png': { schema: { type: 'string', format: 'binary' } },
      'image/webp': { schema: { type: 'string', format: 'binary' } },
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        schema: { type: 'string', format: 'binary' },
      },
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiContractResponse({ status: HttpStatus.NOT_MODIFIED, description: 'Document ETag matched.' })
  @ApiApplicationContract({
    operationId: 'sales_orders_get_document_content',
    session: 'required', authorization: true, badRequest: true,
    resourceLocator: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_DOCUMENT_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  async getDocumentContent(
    @Param() params: SalesOrderDocumentIdParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Res({ passthrough: true }) response: SalesOrderDocumentHttpResponse,
  ): Promise<StreamableFile | undefined> {
    const result = await this.documents.resolveContent(
      params.salesOrderId,
      params.documentId,
      ifNoneMatch,
      'GET',
    )
    applyDocumentContentResponse(response, result)
    return result.stream === undefined ? undefined : new StreamableFile(result.stream)
  }
}
