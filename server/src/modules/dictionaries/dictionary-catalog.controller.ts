import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { RequireAuthenticatedSession } from '../auth/decorators/auth.decorators'
import { DictionaryQueryService } from './dictionary-query.service'
import {
  DictionaryCatalogBatchQueryDto,
  DictionaryCatalogCodeParamDto,
} from './dto/dictionary-management.dto'
import {
  DictionaryCatalogBatchDto,
  DictionaryCatalogDto,
} from './dto/dictionary-response.dto'

/**
 * 业务字典目录只要求正常登录 Session，不继承任何字典管理权限。
 *
 * Catalog 返回全部状态的 Type/Item，Controller 只负责 HTTP 契约和参数传递；
 * 规范化、稳定排序、字段白名单与有效状态派生统一留在 Query Service。
 */
@ApiTags('dictionary-catalog')
@Controller('dictionary-catalog')
@RequireAuthenticatedSession()
export class DictionaryCatalogController {
  constructor(private readonly dictionaries: DictionaryQueryService) {}

  @Get(':code')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: DictionaryCatalogDto,
  })
  @ApiApplicationContract({
    operationId: 'dictionary_catalog_get_by_code',
    session: 'required',
    authorization: false,
    badRequest: true,
    resourceLocator: false,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['DICTIONARY_TYPE_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  getByCode(
    @Param() params: DictionaryCatalogCodeParamDto,
  ): Promise<DictionaryCatalogDto> {
    return this.dictionaries.getCatalogByCode(params.code)
  }

  @Get()
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: DictionaryCatalogBatchDto,
  })
  @ApiApplicationContract({
    operationId: 'dictionary_catalog_batch_list',
    session: 'required',
    authorization: false,
    badRequest: true,
    resourceLocator: false,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  list(
    @Query() query: DictionaryCatalogBatchQueryDto,
  ): Promise<DictionaryCatalogBatchDto> {
    return this.dictionaries.listCatalogs(query.codes)
  }
}
