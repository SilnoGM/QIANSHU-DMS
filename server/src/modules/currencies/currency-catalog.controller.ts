import { Controller, Get, HttpStatus } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { RequireAuthenticatedSession } from '../auth/decorators/auth.decorators'
import { CurrencyQueryService } from './currency-query.service'
import { CurrencyCatalogItemDto } from './dto/currency.dto'

/**
 * 业务货币目录只要求正常登录 Session，不继承货币管理权限。
 *
 * 返回全量（含停用）货币，使历史金额展示与新建业务筛选可以消费同一个真相源。
 */
@ApiTags('currency-catalog')
@Controller('currency-catalog')
@RequireAuthenticatedSession()
export class CurrencyCatalogController {
  constructor(private readonly currencies: CurrencyQueryService) {}

  @Get()
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: [CurrencyCatalogItemDto],
  })
  @ApiApplicationContract({
    operationId: 'currency_catalog_list',
    session: 'required',
    authorization: false,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['PASSWORD_CHANGE_REQUIRED'],
      },
    ],
  })
  list(): Promise<CurrencyCatalogItemDto[]> {
    return this.currencies.catalog()
  }
}
