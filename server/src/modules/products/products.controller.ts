import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { CreateProductRequestDto } from './dto/product-create.dto'
import { ProductListQueryDto } from './dto/product-list-query.dto'
import {
  ProductListItemDto,
  ProductPageDto,
} from './dto/product-response.dto'
import { ProductCommandService } from './product-command.service'
import { parseProductIdempotencyKey } from './product-command.normalizer'
import type { ProductListItem } from './product-query.mapper'
import {
  ProductQueryService,
  type ProductPage,
} from './product-query.service'

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductQueryService,
    private readonly commands: ProductCommandService,
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
  @RequirePermissions('products:create')
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
}
