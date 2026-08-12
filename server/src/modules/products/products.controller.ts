import { Controller, Get, HttpStatus, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { ProductListQueryDto } from './dto/product-list-query.dto'
import { ProductPageDto } from './dto/product-response.dto'
import {
  ProductQueryService,
  type ProductPage,
} from './product-query.service'

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductQueryService) {}

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
}
