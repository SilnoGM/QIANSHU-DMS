import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  CreateProductHeadRequestDto,
  CreateProductTaxonomyCategoryRequestDto,
  ProductTaxonomyCategoryIdParamDto,
  ProductTaxonomyCategoryListItemDto,
  ProductTaxonomyCategoryListDto,
  ProductTaxonomyCategoryListQueryDto,
  ProductTaxonomyHeadIdParamDto,
  ProductTaxonomyHeadListItemDto,
  RenameProductHeadRequestDto,
  RenameProductTaxonomyCategoryRequestDto,
} from './dto/product-taxonomy.dto'
import { ProductTaxonomyService } from './product-taxonomy.service'

const COMMON_FORBIDDEN_CODES = [
  'CSRF_REJECTED',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
] as const

function commandContext(request: object) {
  return {
    actorUserId: getRequestAuthContext(request).userId,
    requestId: getRequestId(request),
  }
}

@ApiTags('product-taxonomies')
@Controller()
export class ProductTaxonomyController {
  constructor(private readonly taxonomies: ProductTaxonomyService) {}

  @Get('product-categories')
  @RequirePermissions('product-categories:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: ProductTaxonomyCategoryListDto,
  })
  @ApiApplicationContract({
    operationId: 'product_categories_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  listCategories(
    @Query() query: ProductTaxonomyCategoryListQueryDto,
  ): Promise<ProductTaxonomyCategoryListDto> {
    return this.taxonomies.list(query.supplierValue)
  }

  @Post('product-categories')
  @RequirePermissions('product-categories:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: ProductTaxonomyCategoryListItemDto,
  })
  @ApiApplicationContract({
    operationId: 'product_categories_create',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_CODES] },
      {
        status: 409,
        codes: ['PRODUCT_CATEGORY_NAME_CONFLICT'],
      },
      {
        status: 422,
        codes: ['PRODUCT_SUPPLIER_UNAVAILABLE', 'VALIDATION_FAILED'],
      },
    ],
  })
  createCategory(
    @Body() dto: CreateProductTaxonomyCategoryRequestDto,
    @Req() request: object,
  ) {
    return this.taxonomies.createCategory(commandContext(request), dto)
  }

  @Patch('product-categories/:categoryId')
  @RequirePermissions('product-categories:update')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: ProductTaxonomyCategoryListItemDto,
  })
  @ApiApplicationContract({
    operationId: 'product_categories_rename',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_CODES] },
      { status: 404, codes: ['PRODUCT_CATEGORY_NOT_FOUND'] },
      { status: 409, codes: ['PRODUCT_CATEGORY_NAME_CONFLICT'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  renameCategory(
    @Param() params: ProductTaxonomyCategoryIdParamDto,
    @Body() dto: RenameProductTaxonomyCategoryRequestDto,
    @Req() request: object,
  ) {
    return this.taxonomies.renameCategory(
      commandContext(request),
      params.categoryId,
      dto,
    )
  }

  @Delete('product-categories/:categoryId')
  @RequirePermissions('product-categories:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiContractResponse({ status: HttpStatus.NO_CONTENT })
  @ApiApplicationContract({
    operationId: 'product_categories_delete',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_CODES] },
      { status: 404, codes: ['PRODUCT_CATEGORY_NOT_FOUND'] },
      { status: 409, codes: ['PRODUCT_CATEGORY_IN_USE'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  deleteCategory(
    @Param() params: ProductTaxonomyCategoryIdParamDto,
    @Req() request: object,
  ): Promise<void> {
    return this.taxonomies.deleteCategory(commandContext(request), params.categoryId)
  }

  @Post('product-heads')
  @RequirePermissions('product-categories:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: ProductTaxonomyHeadListItemDto,
  })
  @ApiApplicationContract({
    operationId: 'product_heads_create',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_CODES] },
      { status: 404, codes: ['PRODUCT_CATEGORY_NOT_FOUND'] },
      { status: 409, codes: ['PRODUCT_HEAD_NAME_CONFLICT'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  createHead(
    @Body() dto: CreateProductHeadRequestDto,
    @Req() request: object,
  ) {
    return this.taxonomies.createHead(commandContext(request), dto)
  }

  @Patch('product-heads/:productHeadId')
  @RequirePermissions('product-categories:update')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: ProductTaxonomyHeadListItemDto,
  })
  @ApiApplicationContract({
    operationId: 'product_heads_rename',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_CODES] },
      { status: 404, codes: ['PRODUCT_HEAD_NOT_FOUND'] },
      { status: 409, codes: ['PRODUCT_HEAD_NAME_CONFLICT'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  renameHead(
    @Param() params: ProductTaxonomyHeadIdParamDto,
    @Body() dto: RenameProductHeadRequestDto,
    @Req() request: object,
  ) {
    return this.taxonomies.renameHead(
      commandContext(request),
      params.productHeadId,
      dto,
    )
  }

  @Delete('product-heads/:productHeadId')
  @RequirePermissions('product-categories:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiContractResponse({ status: HttpStatus.NO_CONTENT })
  @ApiApplicationContract({
    operationId: 'product_heads_delete',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_CODES] },
      { status: 404, codes: ['PRODUCT_HEAD_NOT_FOUND'] },
      { status: 409, codes: ['PRODUCT_HEAD_IN_USE'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  deleteHead(
    @Param() params: ProductTaxonomyHeadIdParamDto,
    @Req() request: object,
  ): Promise<void> {
    return this.taxonomies.deleteHead(commandContext(request), params.productHeadId)
  }
}
