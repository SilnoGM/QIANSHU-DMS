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
import {
  SalesOrderDocumentAttachRequestDto,
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
  SalesOrderListQueryDto,
  SalesOrderPaymentIdParamDto,
  SalesOrderProductOptionsQueryDto,
} from './dto/sales-order-query.dto'
import {
  SalesOrderDetailDto,
  SalesOrderPageDto,
  SalesOrderProductOptionsDto,
} from './dto/sales-order-response.dto'
import { SalesOrderCommandService } from './sales-order-command.service'
import { parseSalesOrderIdempotencyKey } from './sales-order-command.normalizer'
import { SalesOrderMutationService } from './sales-order-mutation.service'
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
  type SalesOrderPage,
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
    private readonly commands: SalesOrderCommandService,
    private readonly mutations: SalesOrderMutationService,
    private readonly documents: SalesOrderDocumentService,
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
  async productOptions(
    @Query() query: SalesOrderProductOptionsQueryDto,
  ): Promise<SalesOrderProductOptionsDto> {
    return {
      items: await this.queries.productOptions(
        query.currencyCode,
        query.keyword,
      ),
    }
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
  @RequirePermissions('sales-orders:create')
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
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: [
        'SALES_ORDER_CANCEL_HAS_PAYMENTS',
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
  @RequirePermissions('sales-orders:payment')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({ status: HttpStatus.CREATED, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_record_payment',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: [
        'SALES_ORDER_CANCELLED',
        'SALES_ORDER_PAYMENT_AMOUNT_INVALID',
        'SALES_ORDER_PAYMENT_EXCEEDS_TOTAL',
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
  @RequirePermissions('sales-orders:payment')
  @ApiContractResponse({ status: HttpStatus.OK, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_void_payment',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: [
        'SALES_ORDER_NOT_FOUND',
        'SALES_ORDER_PAYMENT_NOT_FOUND',
      ] },
      { status: 422, codes: [
        'SALES_ORDER_PAYMENT_ALREADY_VOIDED',
        'VALIDATION_FAILED',
      ] },
    ],
  })
  voidPayment(
    @Param() params: SalesOrderPaymentIdParamDto,
    @Body() dto: SalesOrderPaymentVoidRequestDto,
    @Req() request: object,
  ): Promise<SalesOrderDetail> {
    return this.mutations.voidPayment(
      mutationContext(request),
      params.salesOrderId,
      params.paymentId,
      dto,
    )
  }

  @Post(':salesOrderId/documents')
  @RequirePermissions('sales-orders:document')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({ status: HttpStatus.CREATED, type: SalesOrderDetailDto })
  @ApiApplicationContract({
    operationId: 'sales_orders_attach_document',
    session: 'required', authorization: true, csrf: true, badRequest: true,
    resourceLocator: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 422, codes: [
        'SALES_ORDER_DOCUMENT_UNAVAILABLE',
        'SALES_ORDER_PAYMENT_NOT_FOUND',
        'VALIDATION_FAILED',
      ] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  attachDocument(
    @Param() params: SalesOrderIdParamDto,
    @Body() dto: SalesOrderDocumentAttachRequestDto,
    @Req() request: object,
  ): Promise<SalesOrderDetail> {
    return this.documents.attach(
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
