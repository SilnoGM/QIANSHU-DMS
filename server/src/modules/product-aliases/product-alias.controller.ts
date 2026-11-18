import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  Req,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { PRODUCT_ALIAS_PERMISSION_CODES } from '../access-control/permission.constants'
import { getRequestAuthContext } from '../auth/auth-context'
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  ProductAliasDto,
  ProductAliasListDto,
  ProductAliasListQueryDto,
  ProductAliasProductParamDto,
  UpsertProductAliasDto,
} from './product-alias.dto'
import {
  ProductAliasService,
  type ProductAliasCommandContext,
} from './product-alias.service'

const PRODUCT_ALIAS_PERMISSION = PRODUCT_ALIAS_PERMISSION_CODES[0]

function contract(
  operationId: string,
  mutation = false,
  errors: ApiContractErrorOptions[] = [],
) {
  return ApiApplicationContract({
    operationId,
    session: 'required',
    authorization: true,
    csrf: mutation,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])],
      },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      ...errors,
    ],
  })
}

function context(request: object): ProductAliasCommandContext {
  return {
    actorUserId: getRequestAuthContext(request).userId,
    requestId: getRequestId(request),
  }
}

/**
 * 运营个人产品别名。路径固定为 `mine`，不接受其他用户 ID；
 * 唛头解析由服务端按销售单出单人读取，不通过该接口暴露他人别名。
 */
@ApiTags('product-aliases')
@Controller('product-aliases')
export class ProductAliasController {
  constructor(private readonly aliases: ProductAliasService) {}

  @Get('mine')
  @RequirePermissions(PRODUCT_ALIAS_PERMISSION)
  @ApiContractResponse({ status: HttpStatus.OK, type: ProductAliasListDto })
  @contract('product_aliases_list_mine')
  list(
    @Query() query: ProductAliasListQueryDto,
    @CurrentUserId() actorUserId: string,
  ): Promise<ProductAliasListDto> {
    return this.aliases.listMine(actorUserId, query)
  }

  @Put('mine/:productId')
  @RequirePermissions(PRODUCT_ALIAS_PERMISSION)
  @ApiContractResponse({ status: HttpStatus.OK, type: ProductAliasDto })
  @contract('product_aliases_upsert_mine', true, [
    { status: 404, codes: ['PRODUCT_NOT_FOUND'] },
  ])
  upsert(
    @Param() params: ProductAliasProductParamDto,
    @Body() input: UpsertProductAliasDto,
    @Req() request: object,
  ): Promise<ProductAliasDto> {
    return this.aliases.upsert(context(request), params.productId, input)
  }

  @Delete('mine/:productId')
  @RequirePermissions(PRODUCT_ALIAS_PERMISSION)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiContractResponse({ status: HttpStatus.NO_CONTENT })
  @contract('product_aliases_clear_mine', true, [
    { status: 404, codes: ['PRODUCT_NOT_FOUND'] },
  ])
  async clear(
    @Param() params: ProductAliasProductParamDto,
    @Req() request: object,
  ): Promise<void> {
    await this.aliases.clear(context(request), params.productId)
  }
}
