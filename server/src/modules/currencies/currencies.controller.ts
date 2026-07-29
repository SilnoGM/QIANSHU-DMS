import {
  Body,
  Controller,
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
  CurrencyCommandService,
  type CurrencyCommandContext,
} from './currency-command.service'
import { CurrencyQueryService } from './currency-query.service'
import {
  ChangeCurrencyStatusRequestDto,
  CreateCurrencyRequestDto,
  UpdateCurrencyRequestDto,
} from './dto/currency-command.dto'
import {
  CurrencyIdParamDto,
  CurrencyListQueryDto,
} from './dto/currency-management.dto'
import { CurrencyDto, CurrencyPageDto } from './dto/currency.dto'

/**
 * 货币管理读取逐 handler 声明 `currencies:read`，为后续写接口保留独立权限边界。
 */
@ApiTags('currencies')
@Controller('currencies')
export class CurrenciesController {
  constructor(
    private readonly currencies: CurrencyQueryService,
    private readonly commands: CurrencyCommandService,
  ) {}

  @Get()
  @RequirePermissions('currencies:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: CurrencyPageDto,
  })
  @ApiApplicationContract({
    operationId: 'currencies_list',
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
  list(@Query() query: CurrencyListQueryDto): Promise<CurrencyPageDto> {
    return this.currencies.list(query)
  }

  @Post()
  @RequirePermissions('currencies:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: CurrencyDto,
  })
  @ApiApplicationContract({
    operationId: 'currencies_create',
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
          'CURRENCY_CODE_ALREADY_EXISTS',
          'CURRENCY_STATE_CHANGED',
        ],
      },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  create(
    @Body() dto: CreateCurrencyRequestDto,
    @Req() request: object,
  ): Promise<CurrencyDto> {
    return this.commands.create(this.commandContext(request), dto)
  }

  @Post(':currencyId/enable')
  @RequirePermissions('currencies:enable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: CurrencyDto,
  })
  @ApiApplicationContract({
    operationId: 'currencies_enable',
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
      { status: 404, codes: ['CURRENCY_NOT_FOUND'] },
      { status: 409, codes: ['CURRENCY_STATE_CHANGED'] },
      {
        status: 422,
        codes: [
          'CURRENCY_EXCHANGE_RATE_REQUIRED',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  enable(
    @Param() params: CurrencyIdParamDto,
    @Body() dto: ChangeCurrencyStatusRequestDto,
    @Req() request: object,
  ): Promise<CurrencyDto> {
    return this.commands.enable(
      this.commandContext(request),
      params.currencyId,
      dto,
    )
  }

  @Post(':currencyId/disable')
  @RequirePermissions('currencies:disable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: CurrencyDto,
  })
  @ApiApplicationContract({
    operationId: 'currencies_disable',
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
      { status: 404, codes: ['CURRENCY_NOT_FOUND'] },
      { status: 409, codes: ['CURRENCY_STATE_CHANGED'] },
      {
        status: 422,
        codes: [
          'BASE_CURRENCY_CANNOT_BE_DISABLED',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  disable(
    @Param() params: CurrencyIdParamDto,
    @Body() dto: ChangeCurrencyStatusRequestDto,
    @Req() request: object,
  ): Promise<CurrencyDto> {
    return this.commands.disable(
      this.commandContext(request),
      params.currencyId,
      dto,
    )
  }

  @Get(':currencyId')
  @RequirePermissions('currencies:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: CurrencyDto,
  })
  @ApiApplicationContract({
    operationId: 'currencies_get_by_id',
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
      {
        status: 404,
        codes: ['CURRENCY_NOT_FOUND'],
      },
      {
        status: 422,
        codes: ['VALIDATION_FAILED'],
      },
    ],
  })
  getById(@Param() params: CurrencyIdParamDto): Promise<CurrencyDto> {
    return this.currencies.getById(params.currencyId)
  }

  @Patch(':currencyId')
  @RequirePermissions('currencies:update')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: CurrencyDto,
  })
  @ApiApplicationContract({
    operationId: 'currencies_update',
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
      { status: 404, codes: ['CURRENCY_NOT_FOUND'] },
      { status: 409, codes: ['CURRENCY_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  update(
    @Param() params: CurrencyIdParamDto,
    @Body() dto: UpdateCurrencyRequestDto,
    @Req() request: object,
  ): Promise<CurrencyDto> {
    return this.commands.update(
      this.commandContext(request),
      params.currencyId,
      dto,
    )
  }

  private commandContext(request: object): CurrencyCommandContext {
    return {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }
  }
}
