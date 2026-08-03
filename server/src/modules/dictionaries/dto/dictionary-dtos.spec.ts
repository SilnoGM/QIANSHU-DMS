import {
  Body,
  Controller,
  Get,
  Module,
  Post,
} from '@nestjs/common'
import {
  ApiBody,
  ApiExtraModels,
  ApiOkResponse,
  type OpenAPIObject,
} from '@nestjs/swagger'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { DictionaryTone } from '../../../generated/prisma/enums'
import { createValidationException } from '../../../infrastructure/http/validation-exception.factory'
import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import {
  ChangeDictionaryStatusRequestDto,
  CreateDictionaryItemRequestDto,
  CreateDictionaryTypeRequestDto,
  UPDATE_DICTIONARY_ITEM_REQUEST_BODY_SCHEMA,
  UPDATE_DICTIONARY_TYPE_REQUEST_BODY_SCHEMA,
  UpdateDictionaryItemRequestDto,
  UpdateDictionaryTypeRequestDto,
} from './dictionary-command.dto'
import {
  DictionaryCatalogBatchQueryDto,
  DictionaryCatalogCodeParamDto,
  DictionaryItemIdParamDto,
  DictionaryItemListQueryDto,
  DictionaryItemSortBy,
  DictionarySortOrder,
  DictionaryStatusFilter,
  DictionaryTypeIdParamDto,
  DictionaryTypeListQueryDto,
  DictionaryTypeSortBy,
} from './dictionary-management.dto'
import {
  DictionaryCatalogBatchDto,
  DictionaryCatalogDto,
  DictionaryCatalogItemDto,
  DictionaryItemDto,
  DictionaryItemPageDto,
  DictionaryTypeDto,
  DictionaryTypePageDto,
} from './dictionary-response.dto'

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

@ApiExtraModels(
  CreateDictionaryTypeRequestDto,
  UpdateDictionaryTypeRequestDto,
  CreateDictionaryItemRequestDto,
  UpdateDictionaryItemRequestDto,
  ChangeDictionaryStatusRequestDto,
  DictionaryTypeIdParamDto,
  DictionaryItemIdParamDto,
  DictionaryCatalogCodeParamDto,
  DictionaryTypeListQueryDto,
  DictionaryItemListQueryDto,
  DictionaryCatalogBatchQueryDto,
  DictionaryTypeDto,
  DictionaryItemDto,
  DictionaryTypePageDto,
  DictionaryItemPageDto,
  DictionaryCatalogItemDto,
  DictionaryCatalogDto,
  DictionaryCatalogBatchDto,
)
@Controller('dictionary-dto-contract')
class DictionaryDtoContractController {
  @Post('type')
  @ApiBody({ type: CreateDictionaryTypeRequestDto })
  @ApiOkResponse({ type: DictionaryTypeDto })
  type(@Body() body: CreateDictionaryTypeRequestDto): void {
    void body
  }

  @Post('item')
  @ApiBody({ type: CreateDictionaryItemRequestDto })
  @ApiOkResponse({ type: DictionaryItemDto })
  item(@Body() body: CreateDictionaryItemRequestDto): void {
    void body
  }

  @Post('type-update')
  @ApiBody({ schema: UPDATE_DICTIONARY_TYPE_REQUEST_BODY_SCHEMA })
  typeUpdate(@Body() body: UpdateDictionaryTypeRequestDto): void {
    void body
  }

  @Post('item-update')
  @ApiBody({ schema: UPDATE_DICTIONARY_ITEM_REQUEST_BODY_SCHEMA })
  itemUpdate(@Body() body: UpdateDictionaryItemRequestDto): void {
    void body
  }

  @Get('type-page')
  @ApiOkResponse({ type: DictionaryTypePageDto })
  typePage(): void {}

  @Get('item-page')
  @ApiOkResponse({ type: DictionaryItemPageDto })
  itemPage(): void {}

  @Get('catalog')
  @ApiOkResponse({ type: DictionaryCatalogDto })
  catalog(): void {}

  @Get('catalog-batch')
  @ApiOkResponse({ type: DictionaryCatalogBatchDto })
  catalogBatch(): void {}
}

@Module({ controllers: [DictionaryDtoContractController] })
class DictionaryDtoContractModule {}

describe('dictionary request DTO validation', () => {
  it('validates UUID and Catalog code path parameters', async () => {
    const typeId = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
    const itemId = 'ba6e6036-42c7-489b-b22b-238c3d36a879'
    const valid = await Promise.all([
      validatePlain(DictionaryTypeIdParamDto, { typeId }),
      validatePlain(DictionaryItemIdParamDto, { typeId, itemId }),
      validatePlain(DictionaryCatalogCodeParamDto, {
        code: '  Order.Status  ',
      }),
    ])
    const invalid = await Promise.all([
      validatePlain(DictionaryTypeIdParamDto, { typeId: 'invalid' }),
      validatePlain(DictionaryItemIdParamDto, {
        typeId,
        itemId: 'invalid',
      }),
      validatePlain(DictionaryCatalogCodeParamDto, { code: '订单.状态' }),
    ])

    expect(valid.every(({ errors }) => errors.length === 0)).toBe(true)
    expect(errorProperties(invalid[0].errors)).toEqual(['typeId'])
    expect(errorProperties(invalid[1].errors)).toEqual(['itemId'])
    expect(errorProperties(invalid[2].errors)).toEqual(['code'])
  })

  it('accepts only normalizable Create fields and rejects owned state', async () => {
    const decomposedName = 'e\u0301'.repeat(128)
    const type = await validatePlain(CreateDictionaryTypeRequestDto, {
      code: '  Order.Status  ',
      name: decomposedName,
      description: '  订单　状态  ',
      sortOrder: 0,
    })
    const item = await validatePlain(CreateDictionaryItemRequestDto, {
      value: '  pending-review  ',
      label: '  待　审核  ',
      description: null,
      tone: DictionaryTone.WARNING,
      sortOrder: 2_147_483_647,
    })
    const forbiddenType = await validatePlain(CreateDictionaryTypeRequestDto, {
      code: 'order.status',
      name: '订单状态',
      sortOrder: 0,
      id: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      enabled: true,
      version: 1,
    })
    const forbiddenItem = await validatePlain(CreateDictionaryItemRequestDto, {
      value: 'PENDING',
      label: '待处理',
      sortOrder: 0,
      dictionaryTypeId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      id: 'ba6e6036-42c7-489b-b22b-238c3d36a879',
      enabled: true,
      version: 1,
    })

    expect(type.errors).toEqual([])
    expect(item.errors).toEqual([])
    expect(errorProperties(forbiddenType.errors)).toEqual([
      'enabled',
      'id',
      'version',
    ])
    expect(errorProperties(forbiddenItem.errors)).toEqual([
      'dictionaryTypeId',
      'enabled',
      'id',
      'version',
    ])
  })

  it('rejects invalid identifier, text, Tone and integer boundaries', async () => {
    const invalidType = await validatePlain(CreateDictionaryTypeRequestDto, {
      code: 'ß.Status',
      name: '　\t ',
      description: 'D'.repeat(501),
      sortOrder: -1,
    })
    const invalidItem = await validatePlain(CreateDictionaryItemRequestDto, {
      value: 'PENDING/REVIEW',
      label: 'L'.repeat(129),
      tone: 'PURPLE',
      sortOrder: 2_147_483_648,
    })

    expect(errorProperties(invalidType.errors)).toEqual([
      'code',
      'description',
      'name',
      'sortOrder',
    ])
    expect(errorProperties(invalidItem.errors)).toEqual([
      'label',
      'sortOrder',
      'tone',
      'value',
    ])
  })

  it('requires a mutable Update field in addition to expectedVersion', async () => {
    const valid = await Promise.all([
      validatePlain(UpdateDictionaryTypeRequestDto, {
        name: '新名称',
        expectedVersion: 2,
      }),
      validatePlain(UpdateDictionaryTypeRequestDto, {
        description: null,
        expectedVersion: 2,
      }),
      validatePlain(UpdateDictionaryItemRequestDto, {
        description: null,
        expectedVersion: 3,
      }),
      validatePlain(UpdateDictionaryItemRequestDto, {
        tone: DictionaryTone.INFO,
        expectedVersion: 3,
      }),
      validatePlain(ChangeDictionaryStatusRequestDto, {
        expectedVersion: 1,
      }),
    ])
    const emptyType = await validatePlain(UpdateDictionaryTypeRequestDto, {
      expectedVersion: 2,
    })
    const emptyItem = await validatePlain(UpdateDictionaryItemRequestDto, {
      expectedVersion: 3,
    })
    const forbiddenType = await validatePlain(UpdateDictionaryTypeRequestDto, {
      name: '新名称',
      expectedVersion: 2,
      id: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      code: 'other.code',
      enabled: true,
      version: 9,
    })
    const forbiddenItem = await validatePlain(UpdateDictionaryItemRequestDto, {
      label: '新标签',
      expectedVersion: 3,
      id: 'ba6e6036-42c7-489b-b22b-238c3d36a879',
      dictionaryTypeId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      value: 'OTHER',
      enabled: true,
      version: 9,
    })

    expect(valid.every(({ errors }) => errors.length === 0)).toBe(true)
    expect(emptyType.errors).not.toHaveLength(0)
    expect(emptyItem.errors).not.toHaveLength(0)
    expect(errorProperties(forbiddenType.errors)).toEqual([
      'code',
      'enabled',
      'id',
      'version',
    ])
    expect(errorProperties(forbiddenItem.errors)).toEqual([
      'dictionaryTypeId',
      'enabled',
      'id',
      'value',
      'version',
    ])
  })

  it('bounds expectedVersion and forbids direct status assignment', async () => {
    const missing = await validatePlain(ChangeDictionaryStatusRequestDto, {})
    const invalidStatus = await validatePlain(
      ChangeDictionaryStatusRequestDto,
      { expectedVersion: 0, enabled: true },
    )
    const oversized = await validatePlain(UpdateDictionaryTypeRequestDto, {
      name: '有效名称',
      expectedVersion: 2_147_483_648,
    })
    const fractional = await validatePlain(UpdateDictionaryItemRequestDto, {
      label: '有效标签',
      expectedVersion: 1.5,
    })

    expect(errorProperties(missing.errors)).toEqual(['expectedVersion'])
    expect(errorProperties(invalidStatus.errors)).toEqual([
      'enabled',
      'expectedVersion',
    ])
    expect(errorProperties(oversized.errors)).toEqual(['expectedVersion'])
    expect(errorProperties(fractional.errors)).toEqual(['expectedVersion'])
  })

  it('defaults list queries and keeps filter and sort values on the whitelist', async () => {
    const typeDefaults = await validatePlain(DictionaryTypeListQueryDto, {})
    const itemDefaults = await validatePlain(DictionaryItemListQueryDto, {})
    const completeType = await validatePlain(DictionaryTypeListQueryDto, {
      query: '  Order　Status  ',
      status: DictionaryStatusFilter.ENABLED,
      page: '2',
      pageSize: '100',
      sortBy: DictionaryTypeSortBy.UPDATED_AT,
      sortOrder: DictionarySortOrder.DESC,
    })
    const completeItem = await validatePlain(DictionaryItemListQueryDto, {
      query: '待审核',
      status: DictionaryStatusFilter.DISABLED,
      page: '3',
      pageSize: '50',
      sortBy: DictionaryItemSortBy.LABEL,
      sortOrder: DictionarySortOrder.ASC,
    })
    const invalid = await validatePlain(DictionaryTypeListQueryDto, {
      query: 'Q'.repeat(129),
      status: 'PENDING',
      page: '0',
      pageSize: '101',
      sortBy: 'value',
      sortOrder: 'sideways',
    })

    expect(typeDefaults.errors).toEqual([])
    expect(typeDefaults.instance).toMatchObject({
      page: 1,
      pageSize: 20,
      sortBy: DictionaryTypeSortBy.SORT_ORDER,
      sortOrder: DictionarySortOrder.ASC,
    })
    expect(itemDefaults.errors).toEqual([])
    expect(itemDefaults.instance).toMatchObject({
      page: 1,
      pageSize: 20,
      sortBy: DictionaryItemSortBy.SORT_ORDER,
      sortOrder: DictionarySortOrder.ASC,
    })
    expect(completeType.errors).toEqual([])
    expect(completeType.instance).toMatchObject({ page: 2, pageSize: 100 })
    expect(completeItem.errors).toEqual([])
    expect(completeItem.instance).toMatchObject({ page: 3, pageSize: 50 })
    expect(errorProperties(invalid.errors)).toEqual([
      'page',
      'pageSize',
      'query',
      'sortBy',
      'sortOrder',
      'status',
    ])
  })

  it('keeps repeated batch codes as an array and rejects normalized duplicates', async () => {
    const single = await validatePlain(DictionaryCatalogBatchQueryDto, {
      codes: 'order.status',
    })
    const repeated = await validatePlain(DictionaryCatalogBatchQueryDto, {
      codes: ['order.status', 'payment.method'],
    })
    const duplicate = await validatePlain(DictionaryCatalogBatchQueryDto, {
      codes: [' Order.Status ', 'order.status'],
    })
    const commaJoined = await validatePlain(DictionaryCatalogBatchQueryDto, {
      codes: 'order.status,payment.method',
    })
    const tooMany = await validatePlain(DictionaryCatalogBatchQueryDto, {
      codes: Array.from({ length: 21 }, (_, index) => `test.code_${index}`),
    })

    expect(single.errors).toEqual([])
    expect(single.instance.codes).toEqual(['order.status'])
    expect(repeated.errors).toEqual([])
    expect(repeated.instance.codes).toEqual([
      'order.status',
      'payment.method',
    ])
    expect(errorProperties(duplicate.errors)).toEqual(['codes'])
    expect(errorProperties(commaJoined.errors)).toEqual(['codes'])
    expect(errorProperties(tooMany.errors)).toEqual(['codes'])
  })

  it('turns failures into the stable safe 422 field-error contract', async () => {
    const invalid = await validatePlain(CreateDictionaryTypeRequestDto, {
      code: '订单.状态',
      name: '',
      sortOrder: -1,
      connectionString: 'must-not-leak',
    })
    const exception = createValidationException(invalid.errors)

    expect(exception.getStatus()).toBe(422)
    expect(exception.code).toBe('VALIDATION_FAILED')
    expect(exception.publicMessage).toBe('请求参数校验失败')
    expect(exception.fieldErrors).toBeDefined()
    expect(JSON.stringify(exception.fieldErrors)).not.toContain('must-not-leak')
    for (const messages of Object.values(exception.fieldErrors ?? {})) {
      for (const message of messages) {
        expect(message).toMatch(/[\u3400-\u9fff]/u)
        expect(message).not.toMatch(/\b(?:must|should|invalid)\b/iu)
      }
    }
  })
})

describe('dictionary DTO OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(DictionaryDtoContractModule)
  })

  it('publishes only the frozen management request fields', () => {
    const createType = requireSchema(
      document,
      CreateDictionaryTypeRequestDto.name,
    )
    const updateType = requireSchema(
      document,
      UpdateDictionaryTypeRequestDto.name,
    )
    const createItem = requireSchema(
      document,
      CreateDictionaryItemRequestDto.name,
    )
    const updateItem = requireSchema(
      document,
      UpdateDictionaryItemRequestDto.name,
    )
    const status = requireSchema(
      document,
      ChangeDictionaryStatusRequestDto.name,
    )

    expect(Object.keys(createType.properties as object)).toEqual([
      'code',
      'name',
      'description',
      'sortOrder',
    ])
    expect(Object.keys(updateType.properties as object)).toEqual([
      'name',
      'description',
      'sortOrder',
      'expectedVersion',
    ])
    expect(Object.keys(createItem.properties as object)).toEqual([
      'value',
      'label',
      'description',
      'tone',
      'sortOrder',
    ])
    expect(Object.keys(updateItem.properties as object)).toEqual([
      'label',
      'description',
      'tone',
      'sortOrder',
      'expectedVersion',
    ])
    expect(Object.keys(status.properties as object)).toEqual([
      'expectedVersion',
    ])
    expect(createType.required).toEqual(['code', 'name', 'sortOrder'])
    expect(updateType.required).toEqual(['expectedVersion'])
    expect(createItem.required).toEqual(['value', 'label', 'sortOrder'])
    expect(updateItem.required).toEqual(['expectedVersion'])
    expect(status.required).toEqual(['expectedVersion'])
    expect((createItem.properties as Record<string, object>).tone).toMatchObject({
      type: 'string',
      enum: Object.values(DictionaryTone),
    })

    // 输入长度按规范化后的 code point 判断，组件 schema 不得用原始长度提前拒绝。
    for (const schema of [createType, updateType, createItem, updateItem]) {
      for (const property of Object.values(
        schema.properties as Record<string, object>,
      )) {
        expect(property).not.toHaveProperty('minLength')
        expect(property).not.toHaveProperty('maxLength')
      }
    }
  })

  it('publishes mutable-field anyOf guards for both Update bodies', () => {
    expect(UPDATE_DICTIONARY_TYPE_REQUEST_BODY_SCHEMA).toEqual({
      allOf: [
        { $ref: '#/components/schemas/UpdateDictionaryTypeRequestDto' },
        {
          anyOf: [
            { required: ['name'] },
            { required: ['description'] },
            { required: ['sortOrder'] },
          ],
        },
      ],
    })
    expect(UPDATE_DICTIONARY_ITEM_REQUEST_BODY_SCHEMA).toEqual({
      allOf: [
        { $ref: '#/components/schemas/UpdateDictionaryItemRequestDto' },
        {
          anyOf: [
            { required: ['label'] },
            { required: ['description'] },
            { required: ['tone'] },
            { required: ['sortOrder'] },
          ],
        },
      ],
    })

    for (const [path, expectedSchema] of [
      [
        '/api/dictionary-dto-contract/type-update',
        UPDATE_DICTIONARY_TYPE_REQUEST_BODY_SCHEMA,
      ],
      [
        '/api/dictionary-dto-contract/item-update',
        UPDATE_DICTIONARY_ITEM_REQUEST_BODY_SCHEMA,
      ],
    ] as const) {
      const operation = document.paths[path]?.post
      const requestBody = operation?.requestBody
      if (!requestBody || '$ref' in requestBody) {
        throw new Error(`Missing inline request body ${path}`)
      }
      expect(requestBody.content['application/json']?.schema).toEqual(
        expectedSchema,
      )
    }
  })

  it('publishes exact list and batch query schemas without comma semantics', () => {
    const typeList = requireSchema(document, DictionaryTypeListQueryDto.name)
    const itemList = requireSchema(document, DictionaryItemListQueryDto.name)
    const batch = requireSchema(document, DictionaryCatalogBatchQueryDto.name)

    expect(Object.keys(typeList.properties as object)).toEqual([
      'query',
      'status',
      'page',
      'pageSize',
      'sortBy',
      'sortOrder',
    ])
    expect(Object.keys(itemList.properties as object)).toEqual([
      'query',
      'status',
      'page',
      'pageSize',
      'sortBy',
      'sortOrder',
    ])
    expect(Object.keys(batch.properties as object)).toEqual(['codes'])
    expect(batch.required).toEqual(['codes'])
    expect((batch.properties as Record<string, object>).codes).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 20,
      uniqueItems: true,
    })
    const batchItems = (
      batch.properties as Record<string, { items?: object }>
    ).codes.items
    expect(batchItems).not.toHaveProperty('minLength')
    expect(batchItems).not.toHaveProperty('maxLength')

    for (const schema of [typeList, itemList]) {
      const query = (
        schema.properties as Record<string, object>
      ).query
      expect(query).not.toHaveProperty('minLength')
      expect(query).not.toHaveProperty('maxLength')
    }
  })

  it('publishes the exact management response and page fields', () => {
    const type = requireSchema(document, DictionaryTypeDto.name)
    const item = requireSchema(document, DictionaryItemDto.name)
    const typePage = requireSchema(document, DictionaryTypePageDto.name)
    const itemPage = requireSchema(document, DictionaryItemPageDto.name)

    expect(Object.keys(type.properties as object)).toEqual([
      'id',
      'code',
      'name',
      'description',
      'enabled',
      'sortOrder',
      'itemCount',
      'enabledItemCount',
      'version',
      'createdAt',
      'updatedAt',
    ])
    expect(Object.keys(item.properties as object)).toEqual([
      'id',
      'dictionaryTypeId',
      'value',
      'label',
      'description',
      'tone',
      'enabled',
      'effectiveEnabled',
      'sortOrder',
      'version',
      'createdAt',
      'updatedAt',
    ])
    expect(Object.keys(typePage.properties as object)).toEqual([
      'items',
      'page',
      'pageSize',
      'total',
    ])
    expect(Object.keys(itemPage.properties as object)).toEqual([
      'items',
      'page',
      'pageSize',
      'total',
    ])
  })

  it('keeps the Catalog response free of management-only fields', () => {
    const catalogItem = requireSchema(document, DictionaryCatalogItemDto.name)
    const catalog = requireSchema(document, DictionaryCatalogDto.name)
    const batch = requireSchema(document, DictionaryCatalogBatchDto.name)

    expect(Object.keys(catalogItem.properties as object)).toEqual([
      'value',
      'label',
      'tone',
      'enabled',
      'effectiveEnabled',
      'sortOrder',
    ])
    expect(Object.keys(catalog.properties as object)).toEqual([
      'code',
      'name',
      'enabled',
      'items',
    ])
    expect(Object.keys(batch.properties as object)).toEqual([
      'dictionaries',
      'missingCodes',
    ])

    const serializedCatalog = JSON.stringify({ catalogItem, catalog, batch })
    for (const forbidden of [
      'dictionaryTypeId',
      'description',
      'version',
      'createdAt',
      'updatedAt',
      'itemCount',
    ]) {
      expect(serializedCatalog).not.toContain(`"${forbidden}"`)
    }
  })
})
