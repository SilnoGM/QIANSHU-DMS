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
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common'
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger'

import { ImmutableMediaContentCache } from '../../infrastructure/http/private-no-store.interceptor'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { CreateProductRequestDto } from './dto/product-create.dto'
import { ProductListQueryDto } from './dto/product-list-query.dto'
import {
  ProductMediaDetachRequestDto,
  ProductMediaIdParamDto,
  ProductMediaLayoutRequestDto,
  ProductMediaUploadRequestDto,
  ProductMediaUploadResponseDto,
} from './dto/product-media.dto'
import {
  ProductIdParamDto,
  UpdateProductRequestDto,
} from './dto/product-update.dto'
import {
  ProductListItemDto,
  ProductPageDto,
} from './dto/product-response.dto'
import {
  ProductTaxonomyOptionsDto,
  ProductTaxonomyOptionsQueryDto,
} from './dto/product-taxonomy.dto'
import { ProductCommandService } from './product-command.service'
import { parseProductIdempotencyKey } from './product-command.normalizer'
import { ApiProductMediaContentContract } from './media/product-media-content.contract'
import {
  applyProductMediaContentResponse,
  type ProductMediaContentHttpResponse,
} from './media/product-media-content.http'
import { ProductMediaContentService } from './media/product-media-content.service'
import {
  ProductMediaHttpService,
  type ProductMediaUploadResponse,
} from './media/product-media-http.service'
import type { ProductMediaMultipartRequest } from './media/product-media-multipart.parser'
import type { ProductListItem } from './product-query.mapper'
import {
  ProductQueryService,
  type ProductPage,
} from './product-query.service'
import { ProductTaxonomyService } from './product-taxonomy.service'
import { ProductUpdateService } from './product-update.service'

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductQueryService,
    private readonly taxonomies: ProductTaxonomyService,
    private readonly commands: ProductCommandService,
    private readonly updates: ProductUpdateService,
    private readonly productMedia: ProductMediaHttpService,
    private readonly productMediaContent: ProductMediaContentService,
  ) {}

  @Get()
  @RequirePermissions('products:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ProductPageDto })
  @ApiApplicationContract({
    operationId: 'products_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
      },
      {
        status: 422,
        codes: ['VALIDATION_FAILED'],
      },
    ],
  })
  list(@Query() query: ProductListQueryDto): Promise<ProductPage> {
    return this.products.list(query)
  }

  @Post()
  @RequirePermissions('products:create', 'product-categories:create')
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
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: ProductListItemDto,
  })
  @ApiApplicationContract({
    operationId: 'products_create',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: [
          'CSRF_REJECTED',
          'FORBIDDEN',
          'PASSWORD_CHANGE_REQUIRED',
        ],
      },
      {
        status: 409,
        codes: [
          'PRODUCT_CREATE_IDEMPOTENCY_CONFLICT',
          'PRODUCT_NUMBER_CONFLICT',
          'PRODUCT_NUMBERING_UNAVAILABLE',
          'PRODUCT_STATE_CHANGED',
        ],
      },
      {
        status: 422,
        codes: [
          'PRODUCT_CURRENCY_UNAVAILABLE',
          'PRODUCT_SUPPLIER_REQUIRED',
          'PRODUCT_SUPPLIER_UNAVAILABLE',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  create(
    @Body() dto: CreateProductRequestDto,
    @Req() request: object,
    @Headers('idempotency-key') rawIdempotencyKey: unknown,
  ): Promise<ProductListItem> {
    // Header 与可信请求上下文都在 Controller 收口；Body 不携带 actor、Key 或编号。
    const idempotencyKey = parseProductIdempotencyKey(rawIdempotencyKey)
    return this.commands.create({
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
      idempotencyKey,
    }, dto)
  }

  @Get('taxonomy-options')
  @RequirePermissions('products:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: ProductTaxonomyOptionsDto,
  })
  @ApiApplicationContract({
    operationId: 'products_taxonomy_options',
    session: 'required',
    authorization: true,
    badRequest: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
      },
    ],
  })
  taxonomyOptions(
    @Query() query: ProductTaxonomyOptionsQueryDto,
  ): Promise<ProductTaxonomyOptionsDto> {
    return this.taxonomies.options(query.supplierValue)
  }

  @Get(':productId')
  @RequirePermissions('products:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ProductListItemDto })
  @ApiApplicationContract({
    operationId: 'products_get_by_id',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
      },
      { status: 404, codes: ['PRODUCT_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  getById(@Param() params: ProductIdParamDto): Promise<ProductListItem> {
    return this.products.getById(params.productId)
  }

  @Head(':productId/media/:productMediaId/content')
  @ImmutableMediaContentCache()
  @RequirePermissions('product-media:read')
  @ApiProductMediaContentContract('HEAD')
  async headMediaContent(
    @Param() params: ProductMediaIdParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Headers('range') range: unknown,
    @Query('variant') variant: unknown,
    @Res({ passthrough: true }) response: ProductMediaContentHttpResponse,
  ): Promise<void> {
    const result = await this.productMediaContent.resolve(
      params.productId,
      params.productMediaId,
      ifNoneMatch,
      range,
      'HEAD',
      variant,
    )
    applyProductMediaContentResponse(response, result)
  }

  @Get(':productId/media/:productMediaId/content')
  @ImmutableMediaContentCache()
  @RequirePermissions('product-media:read')
  @ApiProductMediaContentContract('GET')
  async getMediaContent(
    @Param() params: ProductMediaIdParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Headers('range') range: unknown,
    @Query('variant') variant: unknown,
    @Res({ passthrough: true }) response: ProductMediaContentHttpResponse,
  ): Promise<StreamableFile | undefined> {
    const result = await this.productMediaContent.resolve(
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

  @Patch(':productId')
  @RequirePermissions('products:update', 'product-categories:create')
  @ApiContractResponse({ status: HttpStatus.OK, type: ProductListItemDto })
  @ApiApplicationContract({
    operationId: 'products_update',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: [
          'CSRF_REJECTED',
          'FORBIDDEN',
          'PASSWORD_CHANGE_REQUIRED',
        ],
      },
      { status: 404, codes: ['PRODUCT_NOT_FOUND'] },
      { status: 409, codes: ['PRODUCT_STATE_CHANGED'] },
      {
        status: 422,
        codes: [
          'PRODUCT_CURRENCY_UNAVAILABLE',
          'PRODUCT_SUPPLIER_REQUIRED',
          'PRODUCT_SUPPLIER_UNAVAILABLE',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  update(
    @Param() params: ProductIdParamDto,
    @Body() dto: UpdateProductRequestDto,
    @Req() request: object,
  ): Promise<ProductListItem> {
    return this.updates.update({
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }, params.productId, dto)
  }

  @Post(':productId/media')
  @RequirePermissions('products:update')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ProductMediaUploadRequestDto })
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: ProductMediaUploadResponseDto,
  })
  @ApiApplicationContract({
    operationId: 'products_upload_media',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    retry: false,
    privateNoStore: true,
    errors: [
      { status: 400, codes: ['MEDIA_MULTIPART_INVALID'] },
      {
        status: 403,
        codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
      },
      { status: 404, codes: ['PRODUCT_MEDIA_NOT_FOUND'] },
      { status: 409, codes: ['PRODUCT_STATE_CHANGED'] },
      { status: 413, codes: ['MEDIA_FILE_TOO_LARGE'] },
      { status: 415, codes: ['MEDIA_TYPE_UNSUPPORTED'] },
      {
        status: 422,
        codes: [
          'MEDIA_CONTENT_INVALID',
          'PRODUCT_MEDIA_LIMIT_EXCEEDED',
          'VALIDATION_FAILED',
        ],
      },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  uploadMedia(
    @Param() params: ProductIdParamDto,
    @Req() request: ProductMediaMultipartRequest,
  ): Promise<ProductMediaUploadResponse> {
    return this.productMedia.upload({
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }, params.productId, request)
  }

  @Put(':productId/media/layout')
  @RequirePermissions('products:update')
  @ApiBody({ type: ProductMediaLayoutRequestDto })
  @ApiContractResponse({ status: HttpStatus.OK, type: ProductListItemDto })
  @ApiApplicationContract({
    operationId: 'products_update_media_layout',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    retry: false,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
      },
      { status: 404, codes: ['PRODUCT_MEDIA_NOT_FOUND'] },
      {
        status: 409,
        codes: ['PRODUCT_MEDIA_LAYOUT_CHANGED', 'PRODUCT_STATE_CHANGED'],
      },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  updateMediaLayout(
    @Param() params: ProductIdParamDto,
    @Body() dto: ProductMediaLayoutRequestDto,
    @Req() request: object,
  ): Promise<ProductListItem> {
    return this.productMedia.updateLayout({
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }, params.productId, dto)
  }

  @Delete(':productId/media/:productMediaId')
  @RequirePermissions('products:update')
  @ApiBody({ type: ProductMediaDetachRequestDto })
  @ApiContractResponse({ status: HttpStatus.OK, type: ProductListItemDto })
  @ApiApplicationContract({
    operationId: 'products_detach_media',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    retry: false,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
      },
      { status: 404, codes: ['PRODUCT_MEDIA_NOT_FOUND'] },
      { status: 409, codes: ['PRODUCT_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  detachMedia(
    @Param() params: ProductMediaIdParamDto,
    @Body() dto: ProductMediaDetachRequestDto,
    @Req() request: object,
  ): Promise<ProductListItem> {
    return this.productMedia.detach({
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }, params.productId, params.productMediaId, dto)
  }
}
