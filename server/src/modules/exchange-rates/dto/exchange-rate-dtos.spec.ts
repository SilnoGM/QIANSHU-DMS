import {
  Body,
  Controller,
  Get,
  Module,
  Patch,
} from '@nestjs/common'
import {
  ApiBody,
  ApiOkResponse,
  type OpenAPIObject,
} from '@nestjs/swagger'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import {
  CreateExchangeRateRequestDto,
  UpdateExchangeRateRequestDto,
} from './exchange-rate-command.dto'
import {
  ExchangeRateIdParamDto,
  ExchangeRateListQueryDto,
  ExchangeRateStatusFilter,
} from './exchange-rate-management.dto'
import {
  ExchangeRateDto,
  ExchangeRateManagementItemDto,
  ExchangeRatePageDto,
} from './exchange-rate.dto'

async function validatePlain<T extends object>(
  dtoType: new () => T,
  input: object,
) {
  const instance = plainToInstance(dtoType, input)
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  })
  return { errors, instance }
}

function errorProperties(
  errors: Awaited<ReturnType<typeof validate>>,
): string[] {
  return errors.map(error => error.property).sort()
}

function requireSchema(
  document: OpenAPIObject,
  name: string,
): Record<string, unknown> {
  const schema = document.components?.schemas?.[name]
  if (!schema || '$ref' in schema) {
    throw new Error(`Missing inline schema ${name}`)
  }
  return schema as Record<string, unknown>
}

@Controller('exchange-rate-dto-contract')
class ExchangeRateDtoContractController {
  @Get('page')
  @ApiOkResponse({ type: ExchangeRatePageDto })
  page(): ExchangeRatePageDto {
    throw new Error('OpenAPI scan only')
  }

  @Patch('create')
  @ApiBody({ type: CreateExchangeRateRequestDto })
  @ApiOkResponse({ type: ExchangeRateDto })
  create(@Body() body: CreateExchangeRateRequestDto): ExchangeRateDto {
    void body
    throw new Error('OpenAPI scan only')
  }

  @Patch('update')
  @ApiBody({ type: UpdateExchangeRateRequestDto })
  @ApiOkResponse({ type: ExchangeRateDto })
  update(@Body() body: UpdateExchangeRateRequestDto): ExchangeRateDto {
    void body
    throw new Error('OpenAPI scan only')
  }
}

@Module({ controllers: [ExchangeRateDtoContractController] })
class ExchangeRateDtoContractModule {}

describe('ExchangeRate request DTO validation', () => {
  it('accepts only string decimal rates and explicit currency UUIDs', async () => {
    const valid = await validatePlain(CreateExchangeRateRequestDto, {
      currencyId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      foreignUnitsPerCny: '4.8',
    })
    const invalid = await Promise.all([
      validatePlain(CreateExchangeRateRequestDto, {
        currencyId: 'not-a-uuid',
        foreignUnitsPerCny: 4.8,
      }),
      validatePlain(CreateExchangeRateRequestDto, {
        currencyId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
        foreignUnitsPerCny: '4e-1',
      }),
      validatePlain(CreateExchangeRateRequestDto, {
        currencyId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
        foreignUnitsPerCny: '4.8',
        enabled: true,
      }),
    ])

    expect(valid.errors).toEqual([])
    expect(errorProperties(invalid[0].errors)).toEqual([
      'currencyId',
      'foreignUnitsPerCny',
    ])
    expect(errorProperties(invalid[1].errors)).toEqual([
      'foreignUnitsPerCny',
    ])
    expect(errorProperties(invalid[2].errors)).toEqual(['enabled'])
  })

  it('requires expectedVersion when replacing an existing rate', async () => {
    const valid = await validatePlain(UpdateExchangeRateRequestDto, {
      foreignUnitsPerCny: '4.8',
      expectedVersion: 2,
    })
    const invalid = await Promise.all([
      validatePlain(UpdateExchangeRateRequestDto, {
        foreignUnitsPerCny: '4.8',
      }),
      validatePlain(UpdateExchangeRateRequestDto, {
        foreignUnitsPerCny: '0',
        expectedVersion: 0,
      }),
    ])

    expect(valid.errors).toEqual([])
    expect(errorProperties(invalid[0].errors)).toEqual(['expectedVersion'])
    expect(errorProperties(invalid[1].errors)).toEqual([
      'expectedVersion',
      'foreignUnitsPerCny',
    ])
  })

  it('validates params, pagination and configuration filters', async () => {
    const params = await validatePlain(ExchangeRateIdParamDto, {
      exchangeRateId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
    })
    const query = await validatePlain(ExchangeRateListQueryDto, {
      page: '2',
      pageSize: '100',
      query: 'TWD',
      status: ExchangeRateStatusFilter.UNCONFIGURED,
    })
    const invalid = await validatePlain(ExchangeRateListQueryDto, {
      page: '0',
      pageSize: '101',
      status: 'EXPIRED',
    })

    expect(params.errors).toEqual([])
    expect(query.errors).toEqual([])
    expect(query.instance).toMatchObject({ page: 2, pageSize: 100 })
    expect(errorProperties(invalid.errors)).toEqual([
      'page',
      'pageSize',
      'status',
    ])
  })
})
describe('ExchangeRate response DTO OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(ExchangeRateDtoContractModule)
  })

  it('exposes decimal rates as strings and nullable current rows', () => {
    const rate = requireSchema(document, ExchangeRateDto.name)
    const item = requireSchema(document, ExchangeRateManagementItemDto.name)
    const page = requireSchema(document, ExchangeRatePageDto.name)

    expect(rate.properties).toMatchObject({
      foreignUnitsPerCny: {
        type: 'string',
        example: '4.8',
      },
    })
    expect(Object.keys(item.properties as object)).toEqual([
      'currency',
      'currentRate',
    ])
    expect(Object.keys(page.properties as object)).toEqual([
      'items',
      'page',
      'pageSize',
      'total',
    ])
  })
})
