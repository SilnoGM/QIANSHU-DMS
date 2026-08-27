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

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import type {
  PurchaseOrderDocumentMultipartRequest,
} from './documents/purchase-order-document-multipart.parser'
import {
  PurchaseOrderDocumentService,
  type PurchaseOrderDocumentContentResponse,
  type PurchaseOrderTemporaryDocument,
} from './documents/purchase-order-document.service'
import { CreatePurchaseOrderRequestDto } from './dto/purchase-order-create.dto'
import {
  PurchaseOrderDocumentUploadRequestDto,
  PurchaseOrderTemporaryDocumentDto,
} from './dto/purchase-order-document.dto'
import {
  PurchaseOrderFulfillmentStatusRequestDto,
  PurchaseOrderPaymentRequestDto,
  PurchaseOrderPaymentVoidRequestDto,
  PurchaseOrderStatusRequestDto,
} from './dto/purchase-order-mutation.dto'
import {
  PurchaseOrderDocumentIdParamDto,
  PurchaseOrderIdParamDto,
  PurchaseOrderListQueryDto,
  PurchaseOrderPaymentIdParamDto,
  PurchaseOrderProductOptionsQueryDto,
  PurchaseOrderSourceSalesOrderIdParamDto,
  PurchaseOrderSourceSalesOrdersQueryDto,
} from './dto/purchase-order-query.dto'
import {
  PurchaseOrderDetailDto,
  PurchaseOrderPageDto,
  PurchaseOrderProductOptionsDto,
  PurchaseOrderSourceSalesOrderLinesDto,
  PurchaseOrderSourceSalesOrdersDto,
} from './dto/purchase-order-response.dto'
import { PurchaseOrderCommandService } from './purchase-order-command.service'
import { parsePurchaseOrderIdempotencyKey } from './purchase-order-command.normalizer'
import { PurchaseOrderMutationService } from './purchase-order-mutation.service'
import {
  PurchaseOrderQueryService,
  type PurchaseOrderDetail,
  type PurchaseOrderPage,
} from './purchase-order-query.service'
import { PurchaseOrderSourceQueryService } from './purchase-order-source-query.service'

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

interface PurchaseOrderDocumentHttpResponse {
  setHeader(name: string, value: string): unknown
  status(statusCode: number): unknown
}

function applyDocumentContentResponse(
  response: PurchaseOrderDocumentHttpResponse,
  result: PurchaseOrderDocumentContentResponse,
): void {
  response.status(result.status)
  for (const [name, value] of Object.entries(result.headers)) {
    response.setHeader(name, value)
  }
}

@ApiTags('purchase-orders')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly queries: PurchaseOrderQueryService,
    private readonly sourceQueries: PurchaseOrderSourceQueryService,
    private readonly commands: PurchaseOrderCommandService,
    private readonly mutations: PurchaseOrderMutationService,
    private readonly documents: PurchaseOrderDocumentService,
  ) {}

  @Get()
  @RequirePermissions('purchase-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderPageDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_list',
    session: 'required', authorization: true, badRequest: true,
    validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  list(@Query() query: PurchaseOrderListQueryDto): Promise<PurchaseOrderPage> {
    return this.queries.list(query)
  }

  @Get('product-options')
  @RequirePermissions('purchase-orders:create')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderProductOptionsDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_product_options',
    session: 'required', authorization: true, badRequest: true,
    validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 409, codes: ['PURCHASE_ORDER_STATE_CHANGED'] },
      { status: 422, codes: ['PURCHASE_ORDER_SUPPLIER_UNAVAILABLE', 'VALIDATION_FAILED'] },
    ],
  })
  productOptions(
    @Query() query: PurchaseOrderProductOptionsQueryDto,
  ): ReturnType<PurchaseOrderSourceQueryService['productOptions']> {
    return this.sourceQueries.productOptions(query)
  }

  @Get('source-sales-orders')
  @RequirePermissions('purchase-orders:create')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderSourceSalesOrdersDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_source_sales_orders',
    session: 'required', authorization: true, badRequest: true,
    validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  sourceSalesOrders(
    @Query() query: PurchaseOrderSourceSalesOrdersQueryDto,
  ): ReturnType<PurchaseOrderSourceQueryService['salesOrders']> {
    return this.sourceQueries.salesOrders(query)
  }

  @Get('source-sales-orders/:salesOrderId/lines')
  @RequirePermissions('purchase-orders:create')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderSourceSalesOrderLinesDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_source_sales_order_lines',
    session: 'required', authorization: true, badRequest: true,
    resourceLocator: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['PURCHASE_ORDER_SOURCE_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['PURCHASE_ORDER_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  sourceSalesOrderLines(
    @Param() params: PurchaseOrderSourceSalesOrderIdParamDto,
  ): ReturnType<PurchaseOrderSourceQueryService['salesOrderLines']> {
    return this.sourceQueries.salesOrderLines(params.salesOrderId)
  }

  @Post('document-uploads')
  @RequirePermissions('purchase-orders:document')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: PurchaseOrderDocumentUploadRequestDto })
  @ApiContractResponse({ status: HttpStatus.CREATED, type: PurchaseOrderTemporaryDocumentDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_upload_temporary_document',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 422, codes: [
        'PURCHASE_ORDER_DOCUMENT_CONTENT_INVALID',
        'PURCHASE_ORDER_DOCUMENT_CONTENT_TOO_LARGE',
        'PURCHASE_ORDER_DOCUMENT_CONTENT_UNSUPPORTED',
        'PURCHASE_ORDER_DOCUMENT_MULTIPART_INVALID',
      ] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  uploadTemporaryDocument(
    @Req() request: PurchaseOrderDocumentMultipartRequest,
  ): Promise<PurchaseOrderTemporaryDocument> {
    return this.documents.uploadTemporary(mutationContext(request), request)
  }

  @Post()
  @RequirePermissions('purchase-orders:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: {
      type: 'string', format: 'uuid',
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    },
  })
  @ApiContractResponse({ status: HttpStatus.CREATED, type: PurchaseOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_create',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 409, codes: [
        'PURCHASE_ORDER_CREATE_IDEMPOTENCY_CONFLICT',
        'PURCHASE_ORDER_NUMBER_CONFLICT',
        'PURCHASE_ORDER_NUMBERING_UNAVAILABLE',
        'PURCHASE_ORDER_STATE_CHANGED',
      ] },
      { status: 422, codes: [
        'PURCHASE_ORDER_CURRENCY_UNAVAILABLE',
        'PURCHASE_ORDER_CUSTOM_PRICES_INVALID',
        'PURCHASE_ORDER_PAYMENT_TERMS_MISMATCH',
        'PURCHASE_ORDER_PRODUCT_COST_UNAVAILABLE',
        'PURCHASE_ORDER_PRODUCT_SNAPSHOT_INVALID',
        'PURCHASE_ORDER_PRODUCT_SUPPLIER_MISMATCH',
        'PURCHASE_ORDER_PRODUCT_UNAVAILABLE',
        'PURCHASE_ORDER_SOURCE_LINE_INVALID',
        'PURCHASE_ORDER_SOURCE_ORDER_INVALID',
        'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED',
        'PURCHASE_ORDER_SUPPLIER_UNAVAILABLE',
        'PURCHASE_ORDER_TOTAL_MISMATCH',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  async create(
    @Body() dto: CreatePurchaseOrderRequestDto,
    @Req() request: object,
    @Headers('idempotency-key') rawIdempotencyKey: unknown,
  ): Promise<PurchaseOrderDetail> {
    const purchaseOrderId = await this.commands.create({
      ...mutationContext(request),
      idempotencyKey: parsePurchaseOrderIdempotencyKey(rawIdempotencyKey),
    }, dto)
    return this.queries.getById(purchaseOrderId)
  }

  @Get(':purchaseOrderId')
  @RequirePermissions('purchase-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_get_by_id',
    session: 'required', authorization: true, badRequest: true,
    resourceLocator: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['PURCHASE_ORDER_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  getById(@Param() params: PurchaseOrderIdParamDto): Promise<PurchaseOrderDetail> {
    return this.queries.getById(params.purchaseOrderId)
  }

  @Patch(':purchaseOrderId/order-status')
  @RequirePermissions('purchase-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_update_order_status',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['PURCHASE_ORDER_NOT_FOUND'] },
      { status: 422, codes: [
        'PURCHASE_ORDER_CANCEL_HAS_PAYMENTS',
        'PURCHASE_ORDER_STATUS_TRANSITION_INVALID',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  updateOrderStatus(
    @Param() params: PurchaseOrderIdParamDto,
    @Body() dto: PurchaseOrderStatusRequestDto,
    @Req() request: object,
  ): Promise<PurchaseOrderDetail> {
    return this.mutations.updateOrderStatus(
      mutationContext(request), params.purchaseOrderId, dto,
    )
  }

  @Patch(':purchaseOrderId/fulfillment-status')
  @RequirePermissions('purchase-orders:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_update_fulfillment_status',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['PURCHASE_ORDER_NOT_FOUND'] },
      { status: 422, codes: [
        'PURCHASE_ORDER_CANCELLED',
        'PURCHASE_ORDER_FULFILLMENT_TRANSITION_INVALID',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  updateFulfillmentStatus(
    @Param() params: PurchaseOrderIdParamDto,
    @Body() dto: PurchaseOrderFulfillmentStatusRequestDto,
    @Req() request: object,
  ): Promise<PurchaseOrderDetail> {
    return this.mutations.updateFulfillmentStatus(
      mutationContext(request), params.purchaseOrderId, dto,
    )
  }

  @Post(':purchaseOrderId/payments')
  @RequirePermissions('purchase-orders:payment')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({ status: HttpStatus.CREATED, type: PurchaseOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_record_payment',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['PURCHASE_ORDER_NOT_FOUND'] },
      { status: 422, codes: [
        'PURCHASE_ORDER_CANCELLED',
        'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE',
        'PURCHASE_ORDER_PAYMENT_AMOUNT_INVALID',
        'PURCHASE_ORDER_PAYMENT_EXCEEDS_TOTAL',
        'PURCHASE_ORDER_PAYMENT_METHOD_UNAVAILABLE',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  recordPayment(
    @Param() params: PurchaseOrderIdParamDto,
    @Body() dto: PurchaseOrderPaymentRequestDto,
    @Req() request: object,
  ): Promise<PurchaseOrderDetail> {
    return this.mutations.recordPayment(
      mutationContext(request), params.purchaseOrderId, dto,
    )
  }

  @Post(':purchaseOrderId/payments/:paymentId/void')
  @RequirePermissions('purchase-orders:payment')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_void_payment',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: [
        'PURCHASE_ORDER_NOT_FOUND', 'PURCHASE_ORDER_PAYMENT_NOT_FOUND',
      ] },
      { status: 422, codes: [
        'PURCHASE_ORDER_PAYMENT_ALREADY_VOIDED', 'VALIDATION_FAILED',
      ] },
    ],
  })
  voidPayment(
    @Param() params: PurchaseOrderPaymentIdParamDto,
    @Body() dto: PurchaseOrderPaymentVoidRequestDto,
    @Req() request: object,
  ): Promise<PurchaseOrderDetail> {
    return this.mutations.voidPayment(
      mutationContext(request), params.purchaseOrderId, params.paymentId, dto,
    )
  }

  @Delete(':purchaseOrderId/documents/:documentId')
  @RequirePermissions('purchase-orders:document')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'purchase_orders_detach_document',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: [
        'PURCHASE_ORDER_DOCUMENT_NOT_FOUND', 'PURCHASE_ORDER_NOT_FOUND',
      ] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  detachDocument(
    @Param() params: PurchaseOrderDocumentIdParamDto,
    @Req() request: object,
  ): Promise<PurchaseOrderDetail> {
    return this.documents.detach(
      mutationContext(request), params.purchaseOrderId, params.documentId,
    )
  }

  @Head(':purchaseOrderId/documents/:documentId/content')
  @RequirePermissions('purchase-orders:read')
  @ApiContractResponse({ status: HttpStatus.OK, description: 'Private purchase order document.' })
  @ApiContractResponse({ status: HttpStatus.NOT_MODIFIED, description: 'Document ETag matched.' })
  @ApiApplicationContract({
    operationId: 'purchase_orders_head_document_content',
    session: 'required', authorization: true, badRequest: true,
    resourceLocator: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['PURCHASE_ORDER_DOCUMENT_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  async headDocumentContent(
    @Param() params: PurchaseOrderDocumentIdParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Res({ passthrough: true }) response: PurchaseOrderDocumentHttpResponse,
  ): Promise<void> {
    const result = await this.documents.resolveContent(
      params.purchaseOrderId, params.documentId, ifNoneMatch, 'HEAD',
    )
    applyDocumentContentResponse(response, result)
  }

  @Get(':purchaseOrderId/documents/:documentId/content')
  @RequirePermissions('purchase-orders:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    description: 'Private purchase order document.',
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
    operationId: 'purchase_orders_get_document_content',
    session: 'required', authorization: true, badRequest: true,
    resourceLocator: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['PURCHASE_ORDER_DOCUMENT_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  async getDocumentContent(
    @Param() params: PurchaseOrderDocumentIdParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Res({ passthrough: true }) response: PurchaseOrderDocumentHttpResponse,
  ): Promise<StreamableFile | undefined> {
    const result = await this.documents.resolveContent(
      params.purchaseOrderId, params.documentId, ifNoneMatch, 'GET',
    )
    applyDocumentContentResponse(response, result)
    return result.stream === undefined ? undefined : new StreamableFile(result.stream)
  }
}
