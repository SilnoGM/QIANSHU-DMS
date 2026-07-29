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
  CreateExchangeRateRequestDto,
  UpdateExchangeRateRequestDto,
} from './dto/exchange-rate-command.dto'
import {
  ExchangeRateIdParamDto,
  ExchangeRateListQueryDto,
} from './dto/exchange-rate-management.dto'
import {
  ExchangeRateDto,
  ExchangeRatePageDto,
} from './dto/exchange-rate.dto'
import {
  ExchangeRateCommandService,
  type ExchangeRateCommandContext,
} from './exchange-rate-command.service'
import { ExchangeRateQueryService } from './exchange-rate-query.service'

/**
 * 当前汇率管理只读边界。
 *
 * 每个 handler 独立声明读取权限，避免后续写接口错误继承 class-level 权限；
 * 写操作会在对应 CommandService 就绪后按各自权限独立接入。
 */
@ApiTags('exchange-rates')
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(
    private readonly exchangeRates: ExchangeRateQueryService,
    private readonly commands: ExchangeRateCommandService,
  ) {}

  @Get()
  @RequirePermissions('exchange-rates:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: ExchangeRatePageDto,
  })
  @ApiApplicationContract({
    operationId: 'exchange_rates_list',
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
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  list(
    @Query() query: ExchangeRateListQueryDto,
  ): Promise<ExchangeRatePageDto> {
    return this.exchangeRates.list(query)
  }

  @Post()
  @RequirePermissions('exchange-rates:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: ExchangeRateDto,
  })
  @ApiApplicationContract({
    operationId: 'exchange_rates_create',
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
      { status: 404, codes: ['CURRENCY_NOT_FOUND'] },
      {
        status: 409,
        codes: [
          'EXCHANGE_RATE_ALREADY_EXISTS',
          'EXCHANGE_RATE_STATE_CHANGED',
        ],
      },
      {
        status: 422,
        codes: [
          'BASE_CURRENCY_EXCHANGE_RATE_FORBIDDEN',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  create(
    @Body() dto: CreateExchangeRateRequestDto,
    @Req() request: object,
  ): Promise<ExchangeRateDto> {
    return this.commands.create(this.commandContext(request), dto)
  }

  @Get(':exchangeRateId')
  @RequirePermissions('exchange-rates:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: ExchangeRateDto,
  })
  @ApiApplicationContract({
    operationId: 'exchange_rates_get_by_id',
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
      { status: 404, codes: ['EXCHANGE_RATE_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  getById(
    @Param() params: ExchangeRateIdParamDto,
  ): Promise<ExchangeRateDto> {
    return this.exchangeRates.getById(params.exchangeRateId)
  }

  @Patch(':exchangeRateId')
  @RequirePermissions('exchange-rates:update')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: ExchangeRateDto,
  })
  @ApiApplicationContract({
    operationId: 'exchange_rates_update',
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
      { status: 404, codes: ['EXCHANGE_RATE_NOT_FOUND'] },
      { status: 409, codes: ['EXCHANGE_RATE_STATE_CHANGED'] },
      {
        status: 422,
        codes: [
          'BASE_CURRENCY_EXCHANGE_RATE_FORBIDDEN',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  update(
    @Param() params: ExchangeRateIdParamDto,
    @Body() dto: UpdateExchangeRateRequestDto,
    @Req() request: object,
  ): Promise<ExchangeRateDto> {
    return this.commands.update(
      this.commandContext(request),
      params.exchangeRateId,
      dto,
    )
  }

  private commandContext(
    request: object,
  ): ExchangeRateCommandContext {
    return {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }
  }
}
