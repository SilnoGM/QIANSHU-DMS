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

import { createValidationException } from '../../../infrastructure/http/validation-exception.factory'
import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import {
  CreateRegionRequestDto,
  UpdateRegionRequestDto,
} from './region-command.dto'
import {
  RegionAvailability,
  RegionIdParamDto,
  RegionListQueryDto,
  RegionNavigationNodeDto,
  RegionOwnStatus,
  RegionSortBy,
  RegionSortOrder,
} from './region-management.dto'
import {
  RegionCityIdParamDto,
  RegionOptionsQueryDto,
  RegionOptionDto,
  RegionPathNodeDto,
  RegionPathDto,
  RegionSearchQueryDto,
  RegionSearchResponseDto,
} from './region-selection.dto'
import {
  RegionDto,
  RegionMutationResultDto,
  RegionPageDto,
} from './region.dto'

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

@Controller('region-dto-contract')
class RegionDtoContractController {
  @Get('option')
  @ApiOkResponse({ type: [RegionOptionDto] })
  option(): RegionOptionDto[] {
    throw new Error('OpenAPI scan only')
  }

  @Get('path')
  @ApiOkResponse({ type: RegionPathDto })
  path(): RegionPathDto {
    throw new Error('OpenAPI scan only')
  }

  @Get('search')
  @ApiOkResponse({ type: RegionSearchResponseDto })
  search(): RegionSearchResponseDto {
    throw new Error('OpenAPI scan only')
  }

  @Get('navigation')
  @ApiOkResponse({ type: [RegionNavigationNodeDto] })
  navigation(): RegionNavigationNodeDto[] {
    throw new Error('OpenAPI scan only')
  }

  @Get('page')
  @ApiOkResponse({ type: RegionPageDto })
  page(): RegionPageDto {
    throw new Error('OpenAPI scan only')
  }

  @Get('region')
  @ApiOkResponse({ type: RegionDto })
  region(): RegionDto {
    throw new Error('OpenAPI scan only')
  }

  @Get('mutation')
  @ApiOkResponse({ type: RegionMutationResultDto })
  mutation(): RegionMutationResultDto {
    throw new Error('OpenAPI scan only')
  }

  @Patch('create')
  @ApiBody({ type: CreateRegionRequestDto })
  @ApiOkResponse({ type: RegionDto })
  create(@Body() body: CreateRegionRequestDto): RegionDto {
    void body
    throw new Error('OpenAPI scan only')
  }

  @Patch('update')
  @ApiBody({ type: UpdateRegionRequestDto })
  @ApiOkResponse({ type: RegionDto })
  update(@Body() body: UpdateRegionRequestDto): RegionDto {
    void body
    throw new Error('OpenAPI scan only')
  }
}

@Module({ controllers: [RegionDtoContractController] })
class RegionDtoContractModule {}

describe('Region request DTO validation', () => {
  it('validates lazy selection queries, search bounds and UUID params', async () => {
    const rootOptions = await validatePlain(RegionOptionsQueryDto, {})
    const childOptions = await validatePlain(RegionOptionsQueryDto, {
      parentId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
    })
    const search = await validatePlain(RegionSearchQueryDto, {
      query: '  高雄  ',
      limit: '50',
    })
    const invalidSearch = await validatePlain(RegionSearchQueryDto, {
      query: '　\t ',
      limit: '51',
      level: 'CITY',
    })
    const cityParam = await validatePlain(RegionCityIdParamDto, {
      cityId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
    })
    const invalidParams = await Promise.all([
      validatePlain(RegionCityIdParamDto, { cityId: 'not-a-uuid' }),
      validatePlain(RegionIdParamDto, { regionId: 'not-a-uuid' }),
    ])

    expect(rootOptions.errors).toEqual([])
    expect(childOptions.errors).toEqual([])
    expect(search.errors).toEqual([])
    expect(search.instance).toMatchObject({ limit: 50, query: '  高雄  ' })
    expect(errorProperties(invalidSearch.errors)).toEqual([
      'level',
      'limit',
      'query',
    ])
    expect(cityParam.errors).toEqual([])
    expect(errorProperties(invalidParams[0].errors)).toEqual(['cityId'])
    expect(errorProperties(invalidParams[1].errors)).toEqual(['regionId'])
  })

  it('defaults management pagination and restricts sort and filter enums', async () => {
    const defaults = await validatePlain(RegionListQueryDto, {})
    const complete = await validatePlain(RegionListQueryDto, {
      parentId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      query: 'Kuala Lumpur',
      code: 'my-14',
      ownStatus: RegionOwnStatus.ENABLED,
      availability: RegionAvailability.EFFECTIVE,
      page: '2',
      pageSize: '100',
      sortBy: RegionSortBy.UPDATED_AT,
      sortOrder: RegionSortOrder.DESC,
    })
    const invalid = await validatePlain(RegionListQueryDto, {
      page: '0',
      pageSize: '101',
      ownStatus: 'PENDING',
      availability: 'UNKNOWN',
      sortBy: 'level',
      sortOrder: 'sideways',
      level: 'CITY',
    })

    expect(defaults.errors).toEqual([])
    expect(defaults.instance).toMatchObject({ page: 1, pageSize: 20 })
    expect(complete.errors).toEqual([])
    expect(complete.instance).toMatchObject({
      page: 2,
      pageSize: 100,
      sortBy: RegionSortBy.UPDATED_AT,
      sortOrder: RegionSortOrder.DESC,
    })
    expect(errorProperties(invalid.errors)).toEqual([
      'availability',
      'level',
      'ownStatus',
      'page',
      'pageSize',
      'sortBy',
      'sortOrder',
    ])
  })

  it('rejects mutually exclusive own-status and availability filters', async () => {
    const effective = await validatePlain(RegionListQueryDto, {
      ownStatus: RegionOwnStatus.DISABLED,
      availability: RegionAvailability.EFFECTIVE,
    })
    const ancestorDisabled = await validatePlain(RegionListQueryDto, {
      ownStatus: RegionOwnStatus.DISABLED,
      availability: RegionAvailability.ANCESTOR_DISABLED,
    })
    const enabled = await validatePlain(RegionListQueryDto, {
      ownStatus: RegionOwnStatus.ENABLED,
      availability: RegionAvailability.ANCESTOR_DISABLED,
    })

    expect(errorProperties(effective.errors)).toEqual(['availability'])
    expect(errorProperties(ancestorDisabled.errors)).toEqual(['availability'])
    expect(enabled.errors).toEqual([])
  })

  it('validates create fields and rejects identity fields or empty updates', async () => {
    const createRoot = await validatePlain(CreateRegionRequestDto, {
      parentId: null,
      code: 'tw-64000',
      name: '高雄市',
      englishName: '  ',
      sortOrder: 0,
      enabled: true,
    })
    const createChild = await validatePlain(CreateRegionRequestDto, {
      parentId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      code: 'MY-14-01',
      name: '😀'.repeat(128),
      sortOrder: 2_147_483_647,
      enabled: false,
    })
    const invalidCreate = await validatePlain(CreateRegionRequestDto, {
      code: 'X',
      name: ' \t　',
      sortOrder: -1,
      enabled: 'true',
      level: 'CITY',
    })
    const updates = await Promise.all([
      validatePlain(UpdateRegionRequestDto, { name: '新名称' }),
      validatePlain(UpdateRegionRequestDto, { englishName: null }),
      validatePlain(UpdateRegionRequestDto, { englishName: '  ' }),
      validatePlain(UpdateRegionRequestDto, { sortOrder: 1 }),
    ])
    const emptyUpdate = await validatePlain(UpdateRegionRequestDto, {})
    const identityUpdate = await validatePlain(UpdateRegionRequestDto, {
      name: '新名称',
      id: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      code: 'CN',
      parentId: null,
      level: 'COUNTRY_REGION',
      enabled: false,
    })

    expect(createRoot.errors).toEqual([])
    expect(createChild.errors).toEqual([])
    expect(errorProperties(invalidCreate.errors)).toEqual([
      'code',
      'enabled',
      'level',
      'name',
      'parentId',
      'sortOrder',
    ])
    expect(updates.every(({ errors }) => errors.length === 0)).toBe(true)
    expect(emptyUpdate.errors).not.toHaveLength(0)
    expect(errorProperties(identityUpdate.errors)).toEqual([
      'code',
      'enabled',
      'id',
      'level',
      'parentId',
    ])
  })

  it('turns DTO failures into the stable Chinese 422 field-error contract', async () => {
    const invalid = await validatePlain(CreateRegionRequestDto, {
      parentId: 'invalid',
      code: 'X',
      name: '',
      sortOrder: -1,
      enabled: 'true',
      secret: 'must-not-be-accepted',
    })
    const exception = createValidationException(invalid.errors)

    expect(exception.getStatus()).toBe(422)
    expect(exception.code).toBe('VALIDATION_FAILED')
    expect(exception.publicMessage).toBe('请求参数校验失败')
    expect(exception.fieldErrors).toBeDefined()
    for (const messages of Object.values(exception.fieldErrors ?? {})) {
      expect(messages).not.toHaveLength(0)
      for (const message of messages) {
        expect(message).toMatch(/[\u3400-\u9fff]/u)
        expect(message).not.toMatch(/\b(?:must|should|invalid)\b/iu)
      }
    }
  })
})

describe('Region response DTO OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(RegionDtoContractModule)
  })

  it('keeps selection nodes and exact three-node paths explicit', () => {
    const option = requireSchema(document, RegionOptionDto.name)
    const path = requireSchema(document, RegionPathDto.name)

    expect(Object.keys(option.properties as object)).toEqual([
      'id',
      'parentId',
      'code',
      'name',
      'englishName',
      'level',
      'enabled',
      'effectiveEnabled',
      'hasChildren',
    ])
    expect(path).toMatchObject({
      type: 'object',
      properties: {
        cityId: { type: 'string', format: 'uuid' },
        path: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: {
            $ref: `#/components/schemas/${RegionPathNodeDto.name}`,
          },
        },
      },
      required: ['cityId', 'path'],
    })
  })

  it('exposes only the confirmed management and mutation response fields', () => {
    const region = requireSchema(document, RegionDto.name)
    const page = requireSchema(document, RegionPageDto.name)
    const mutation = requireSchema(document, RegionMutationResultDto.name)
    const navigation = requireSchema(document, RegionNavigationNodeDto.name)

    expect(Object.keys(region.properties as object)).toEqual([
      'id',
      'parentId',
      'code',
      'name',
      'englishName',
      'sourceName',
      'sourceCode',
      'administrativeType',
      'level',
      'enabled',
      'effectiveEnabled',
      'sortOrder',
      'createdAt',
      'updatedAt',
    ])
    expect(Object.keys(page.properties as object)).toEqual([
      'items',
      'page',
      'pageSize',
      'total',
    ])
    expect(Object.keys(mutation.properties as object)).toEqual([
      'region',
      'affectedCount',
    ])
    expect(Object.keys(navigation.properties as object)).toEqual([
      'id',
      'parentId',
      'code',
      'name',
      'englishName',
      'level',
      'enabled',
      'effectiveEnabled',
      'children',
    ])
  })

  it('does not document immutable identity fields on PATCH', () => {
    const create = requireSchema(document, CreateRegionRequestDto.name)
    const update = requireSchema(document, UpdateRegionRequestDto.name)

    expect(Object.keys(create.properties as object)).toEqual([
      'parentId',
      'code',
      'name',
      'englishName',
      'sortOrder',
      'enabled',
    ])
    expect(Object.keys(update.properties as object)).toEqual([
      'name',
      'englishName',
      'sortOrder',
    ])
  })
})
