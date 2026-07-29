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
  ChangeCurrencyStatusRequestDto,
  CreateCurrencyRequestDto,
  UpdateCurrencyRequestDto,
} from './currency-command.dto'
import {
  CurrencyIdParamDto,
  CurrencyListQueryDto,
  CurrencyStatusFilter,
} from './currency-management.dto'
import {
  CurrencyCatalogItemDto,
  CurrencyDto,
  CurrencyPageDto,
} from './currency.dto'

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

@Controller('currency-dto-contract')
class CurrencyDtoContractController {
  @Get('catalog')
  @ApiOkResponse({ type: [CurrencyCatalogItemDto] })
  catalog(): CurrencyCatalogItemDto[] {
    throw new Error('OpenAPI scan only')
  }

  @Get('page')
  @ApiOkResponse({ type: CurrencyPageDto })
  page(): CurrencyPageDto {
    throw new Error('OpenAPI scan only')
  }

  @Patch('create')
  @ApiBody({ type: CreateCurrencyRequestDto })
  @ApiOkResponse({ type: CurrencyDto })
  create(@Body() body: CreateCurrencyRequestDto): CurrencyDto {
    void body
    throw new Error('OpenAPI scan only')
  }

  @Patch('update')
  @ApiBody({ type: UpdateCurrencyRequestDto })
  @ApiOkResponse({ type: CurrencyDto })
  update(@Body() body: UpdateCurrencyRequestDto): CurrencyDto {
    void body
    throw new Error('OpenAPI scan only')
  }
}

@Module({ controllers: [CurrencyDtoContractController] })
class CurrencyDtoContractModule {}

describe('Currency request DTO validation', () => {
  it('accepts confirmed create fields and rejects state or identity injection', async () => {
    const valid = await validatePlain(CreateCurrencyRequestDto, {
      code: 'twd',
      name: '新台币',
      englishName: 'New Taiwan Dollar',
      symbol: 'NT$',
      minorUnit: 2,
      sortOrder: 20,
    })
    const invalid = await validatePlain(CreateCurrencyRequestDto, {
      code: 'USDT',
      name: ' ',
      minorUnit: 5,
      sortOrder: -1,
      enabled: true,
      version: 1,
    })

    expect(valid.errors).toEqual([])
    expect(errorProperties(invalid.errors)).toEqual([
      'code',
      'enabled',
      'minorUnit',
      'name',
      'sortOrder',
      'version',
    ])
  })

  it('requires a mutable field and expectedVersion on update', async () => {
    const valid = await Promise.all([
      validatePlain(UpdateCurrencyRequestDto, {
        name: '人民币',
        expectedVersion: 1,
      }),
      validatePlain(UpdateCurrencyRequestDto, {
        symbol: null,
        expectedVersion: 2,
      }),
      validatePlain(UpdateCurrencyRequestDto, {
        englishName: '',
        sortOrder: 10,
        expectedVersion: 3,
      }),
    ])
    const empty = await validatePlain(UpdateCurrencyRequestDto, {
      expectedVersion: 1,
    })
    const immutable = await validatePlain(UpdateCurrencyRequestDto, {
      code: 'USD',
      minorUnit: 4,
      enabled: false,
      expectedVersion: 1,
    })

    expect(valid.every(result => result.errors.length === 0)).toBe(true)
    expect(errorProperties(empty.errors)).toEqual(['name'])
    expect(errorProperties(immutable.errors)).toEqual([
      'code',
      'enabled',
      'minorUnit',
      'name',
    ])
  })

  it('validates optimistic status changes, params and list filters', async () => {
    const status = await validatePlain(ChangeCurrencyStatusRequestDto, {
      expectedVersion: 2,
    })
    const invalidStatus = await validatePlain(
      ChangeCurrencyStatusRequestDto,
      { expectedVersion: 0 },
    )
    const params = await validatePlain(CurrencyIdParamDto, {
      currencyId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
    })
    const list = await validatePlain(CurrencyListQueryDto, {
      page: '2',
      pageSize: '100',
      query: ' TW ',
      status: CurrencyStatusFilter.DISABLED,
    })
    const invalidList = await validatePlain(CurrencyListQueryDto, {
      page: '0',
      pageSize: '101',
      status: 'ARCHIVED',
    })

    expect(status.errors).toEqual([])
    expect(errorProperties(invalidStatus.errors)).toEqual(['expectedVersion'])
    expect(params.errors).toEqual([])
    expect(list.errors).toEqual([])
    expect(list.instance).toMatchObject({ page: 2, pageSize: 100 })
    expect(errorProperties(invalidList.errors)).toEqual([
      'page',
      'pageSize',
      'status',
    ])
  })
})
describe('Currency response DTO OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(CurrencyDtoContractModule)
  })

  it('publishes one stable catalog and management shape', () => {
    const catalog = requireSchema(document, CurrencyCatalogItemDto.name)
    const currency = requireSchema(document, CurrencyDto.name)
    const page = requireSchema(document, CurrencyPageDto.name)

    expect(Object.keys(catalog.properties as object)).toEqual([
      'id',
      'code',
      'name',
      'englishName',
      'symbol',
      'minorUnit',
      'enabled',
      'isBase',
      'sortOrder',
    ])
    expect(Object.keys(currency.properties as object)).toEqual([
      ...Object.keys(catalog.properties as object),
      'exchangeRateConfigured',
      'version',
      'createdAt',
      'updatedAt',
    ])
    expect(Object.keys(page.properties as object)).toEqual([
      'items',
      'page',
      'pageSize',
      'total',
    ])
  })

  it('does not expose immutable or state fields on PATCH', () => {
    const create = requireSchema(document, CreateCurrencyRequestDto.name)
    const update = requireSchema(document, UpdateCurrencyRequestDto.name)

    expect(Object.keys(create.properties as object)).toEqual([
      'code',
      'name',
      'englishName',
      'symbol',
      'minorUnit',
      'sortOrder',
    ])
    expect(Object.keys(update.properties as object)).toEqual([
      'name',
      'englishName',
      'symbol',
      'sortOrder',
      'expectedVersion',
    ])
  })
})
