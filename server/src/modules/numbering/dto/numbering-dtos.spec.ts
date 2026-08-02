import {
  Body,
  Controller,
  Get,
  Module,
  Post,
} from '@nestjs/common'
import {
  ApiBody,
  ApiOkResponse,
  type OpenAPIObject,
} from '@nestjs/swagger'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import { normalizeNumberingRuleCode } from '../numbering.normalizer'
import {
  ChangeNumberingRuleStatusRequestDto,
  CloneNumberingRuleRequestDto,
  CreateNumberingRuleRequestDto,
  PreviewNumberingRuleRequestDto,
  PublishNumberingRuleRequestDto,
  UpdateNumberingRuleRequestDto,
} from './numbering-command.dto'
import {
  NumberingGeneratedNumberMatch,
  NumberingIssuanceListQueryDto,
  NumberingRuleIdParamDto,
  NumberingRuleListQueryDto,
  NumberingRuleSortBy,
  NumberingRuleSortOrder,
  NumberingRuleStatus,
  NumberingRuleVersionListQueryDto,
} from './numbering-management.dto'
import {
  NumberingIssuanceDto,
  NumberingIssuancePageDto,
  NumberingRuleDetailDto,
  NumberingRuleConfigResponseDto,
  NumberingRuleListItemDto,
  NumberingRulePageDto,
  PreviewNumberingRuleResponseDto,
  NumberingRuleStatisticsDto,
  NumberingRuleVersionDto,
  NumberingRuleVersionPageDto,
} from './numbering-response.dto'
import {
  NumberingRuleConfigInputDto,
  NumberingSequenceSegmentInputDto,
  type NumberingRuleSegmentInput,
} from './numbering-segment.dto'

function readTypedSegmentField(segment: NumberingRuleSegmentInput): string {
  // 该 exhaustive switch 是编译期合同：五类 DTO 必须能按 type 收窄并暴露各自字段。
  switch (segment.type) {
    case 'FIXED':
      return segment.value
    case 'DATE':
      return segment.format
    case 'SEPARATOR':
      return segment.value
    case 'SEQUENCE':
      return `${segment.width}:${segment.startValue}:${segment.step}`
    case 'RANDOM':
      return `${segment.letterLength}:${segment.digitLength}:${segment.mode}`
  }
}

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

const VALID_CONFIG = {
  resetPolicy: 'NEVER',
  segments: [
    { type: 'FIXED', value: 'SO' },
    { type: 'SEPARATOR', value: '-' },
    { type: 'SEQUENCE', width: 18, startValue: '0', step: '1' },
    {
      type: 'RANDOM',
      letterLength: 2,
      digitLength: 2,
      mode: 'SHUFFLED',
    },
  ],
} as const

@Controller('numbering-dto-contract')
class NumberingDtoContractController {
  @Post('create')
  @ApiBody({ type: CreateNumberingRuleRequestDto })
  create(@Body() body: CreateNumberingRuleRequestDto): void {
    void body
  }

  @Post('preview')
  @ApiBody({ type: PreviewNumberingRuleRequestDto })
  @ApiOkResponse({ type: PreviewNumberingRuleResponseDto })
  preview(@Body() body: PreviewNumberingRuleRequestDto): void {
    void body
  }

  @Get('statistics')
  @ApiOkResponse({ type: NumberingRuleStatisticsDto })
  statistics(): void {}

  @Get('issuance')
  @ApiOkResponse({ type: NumberingIssuanceDto })
  issuance(): void {}

  @Get('version')
  @ApiOkResponse({ type: NumberingRuleVersionDto })
  version(): void {}

  @Get('list-item')
  @ApiOkResponse({ type: NumberingRuleListItemDto })
  listItem(): void {}

  @Get('detail')
  @ApiOkResponse({ type: NumberingRuleDetailDto })
  detail(): void {}

  @Get('rule-page')
  @ApiOkResponse({ type: NumberingRulePageDto })
  rulePage(): void {}

  @Get('version-page')
  @ApiOkResponse({ type: NumberingRuleVersionPageDto })
  versionPage(): void {}

  @Get('issuance-page')
  @ApiOkResponse({ type: NumberingIssuancePageDto })
  issuancePage(): void {}
}

@Module({ controllers: [NumberingDtoContractController] })
class NumberingDtoContractModule {}

describe('numbering request DTO validation', () => {
  it('defaults pagination and permits only the confirmed list sort contract', async () => {
    const defaults = await validatePlain(NumberingRuleListQueryDto, {})
    const complete = await validatePlain(NumberingRuleListQueryDto, {
      keyword: '  销售  ',
      status: NumberingRuleStatus.ENABLED,
      page: '2',
      pageSize: '100',
      sortBy: NumberingRuleSortBy.UPDATED_AT,
      sortOrder: NumberingRuleSortOrder.ASC,
    })
    const invalid = await validatePlain(NumberingRuleListQueryDto, {
      page: '0',
      pageSize: '101',
      status: 'RETIRED',
      sortBy: 'name',
      sortOrder: 'sideways',
      periodStatus: 'EXHAUSTED',
    })

    expect(defaults.errors).toEqual([])
    expect(defaults.instance).toMatchObject({
      page: 1,
      pageSize: 20,
      sortBy: NumberingRuleSortBy.UPDATED_AT,
      sortOrder: NumberingRuleSortOrder.DESC,
    })
    expect(complete.errors).toEqual([])
    expect(complete.instance).toMatchObject({ page: 2, pageSize: 100 })
    expect(errorProperties(invalid.errors)).toEqual([
      'page',
      'pageSize',
      'periodStatus',
      'sortBy',
      'sortOrder',
      'status',
    ])
  })

  it('validates rule UUID and optimistic versions as positive integers', async () => {
    const validParam = await validatePlain(NumberingRuleIdParamDto, {
      ruleId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
    })
    const invalidParam = await validatePlain(NumberingRuleIdParamDto, {
      ruleId: 'not-a-uuid',
    })
    const requests = await Promise.all([
      validatePlain(PublishNumberingRuleRequestDto, {
        draftRevision: 2,
        expectedVersion: 3,
      }),
      validatePlain(ChangeNumberingRuleStatusRequestDto, {
        expectedVersion: 3,
      }),
      validatePlain(CloneNumberingRuleRequestDto, {
        ruleCode: 'next_rule',
        name: '复制规则',
        expectedVersion: 3,
      }),
    ])
    const invalidVersion = await validatePlain(
      ChangeNumberingRuleStatusRequestDto,
      { expectedVersion: 0 },
    )

    expect(validParam.errors).toEqual([])
    expect(errorProperties(invalidParam.errors)).toEqual(['ruleId'])
    expect(requests.every(({ errors }) => errors.length === 0)).toBe(true)
    expect(errorProperties(invalidVersion.errors)).toEqual(['expectedVersion'])
  })

  it('validates the exact versions and issuances query dependencies', async () => {
    const versions = await validatePlain(NumberingRuleVersionListQueryDto, {
      page: '2',
      pageSize: '100',
    })
    const issuances = await validatePlain(NumberingIssuanceListQueryDto, {
      periodKey: '20260802',
      consumerCode: 'OMS.ORDER_V1',
      generatedNumber: 'SO-20260802-',
      generatedNumberMatch: NumberingGeneratedNumberMatch.PREFIX,
      page: '3',
      pageSize: '50',
    })
    const invalidDependency = await validatePlain(
      NumberingIssuanceListQueryDto,
      { generatedNumberMatch: NumberingGeneratedNumberMatch.EXACT },
    )
    const extraVersionFilter = await validatePlain(
      NumberingRuleVersionListQueryDto,
      { status: 'ACTIVE' },
    )

    expect(versions.errors).toEqual([])
    expect(versions.instance).toMatchObject({ page: 2, pageSize: 100 })
    expect(issuances.errors).toEqual([])
    expect(issuances.instance).toMatchObject({ page: 3, pageSize: 50 })
    expect(errorProperties(invalidDependency.errors)).toEqual([
      'generatedNumber',
    ])
    expect(errorProperties(extraVersionFilter.errors)).toEqual(['status'])
  })

  it('validates each discriminated segment and rejects cross-type fields', async () => {
    const valid = await validatePlain(CreateNumberingRuleRequestDto, {
      ruleCode: 'sales_order',
      name: '销售订单编号',
      description: null,
      ...VALID_CONFIG,
    })
    const invalid = await validatePlain(CreateNumberingRuleRequestDto, {
      ruleCode: 'sales_order',
      name: '销售订单编号',
      resetPolicy: 'NEVER',
      segments: [
        { type: 'FIXED', value: 'SO', width: 2 },
        { type: 'DATE', format: 'ISO_DATE' },
        { type: 'SEPARATOR', value: ':' },
        {
          type: 'SEQUENCE',
          width: 19,
          startValue: '01',
          step: '0',
          letterLength: 1,
        },
        {
          type: 'RANDOM',
          letterLength: 33,
          digitLength: -1,
          mode: 'LOWERCASE',
        },
      ],
    })
    const unknownType = await validatePlain(CreateNumberingRuleRequestDto, {
      ruleCode: 'sales_order',
      name: '销售订单编号',
      resetPolicy: 'NEVER',
      segments: [{ type: 'COUNTER', width: 4 }],
    })
    const dateConfig = await validatePlain(PreviewNumberingRuleRequestDto, {
      resetPolicy: 'DAILY',
      segments: [
        { type: 'DATE', format: 'YYYYMMDD' },
        { type: 'SEQUENCE', width: 6, startValue: '1', step: '1' },
      ],
    })

    expect(valid.errors).toEqual([])
    expect(dateConfig.errors).toEqual([])
    expect(valid.instance.segments.map(segment => segment.constructor.name))
      .toEqual([
        'NumberingFixedSegmentInputDto',
        'NumberingSeparatorSegmentInputDto',
        'NumberingSequenceSegmentInputDto',
        'NumberingRandomSegmentInputDto',
      ])
    expect(errorProperties(invalid.errors)).toContain('segments')
    expect(errorProperties(unknownType.errors)).toContain('segments')
  })

  it('lets Create and Clone pass normalizable padded rule codes', async () => {
    const create = await validatePlain(CreateNumberingRuleRequestDto, {
      ruleCode: '　 sales_order \t',
      name: '销售订单编号',
      ...VALID_CONFIG,
    })
    const clone = await validatePlain(CloneNumberingRuleRequestDto, {
      ruleCode: '\t cloned_order　',
      name: '复制规则',
      expectedVersion: 1,
    })
    const confusable = await validatePlain(CloneNumberingRuleRequestDto, {
      ruleCode: '　ß_RULE　',
      name: '伪装规则',
      expectedVersion: 1,
    })

    expect(create.errors).toEqual([])
    expect(clone.errors).toEqual([])
    expect(normalizeNumberingRuleCode(create.instance.ruleCode))
      .toBe('SALES_ORDER')
    expect(normalizeNumberingRuleCode(clone.instance.ruleCode))
      .toBe('CLONED_ORDER')
    expect(errorProperties(confusable.errors)).toEqual(['ruleCode'])
  })

  it('rejects empty PATCH and all HTTP-only forbidden internal fields', async () => {
    const validUpdate = await validatePlain(UpdateNumberingRuleRequestDto, {
      description: null,
      expectedVersion: 8,
    })
    const emptyUpdate = await validatePlain(UpdateNumberingRuleRequestDto, {
      expectedVersion: 8,
    })
    const forbidden = await validatePlain(CreateNumberingRuleRequestDto, {
      ruleCode: 'sales_order',
      name: '销售订单编号',
      ...VALID_CONFIG,
      timezone: 'UTC',
      idempotencyKey: 'secret-key',
      idempotencyKeyHash: 'not-public',
      requestFingerprintHash: 'not-public',
    })

    expect(validUpdate.errors).toEqual([])
    expect(errorProperties(emptyUpdate.errors)).toContain('name')
    expect(errorProperties(forbidden.errors)).toEqual([
      'idempotencyKey',
      'idempotencyKeyHash',
      'requestFingerprintHash',
      'timezone',
    ])
  })
})

describe('numbering OpenAPI DTO contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(NumberingDtoContractModule)
  })

  it('publishes an explicit segment oneOf discriminator', () => {
    const create = requireSchema(document, CreateNumberingRuleRequestDto.name)
    const properties = create.properties as Record<string, Record<string, unknown>>
    const segmentItems = properties.segments.items as Record<string, unknown>

    expect(segmentItems).toMatchObject({
      discriminator: {
        propertyName: 'type',
      },
    })
    expect(segmentItems.oneOf).toHaveLength(5)
  })

  it('exposes all five segment fields through a discriminated union', () => {
    const inputSegments: NumberingRuleConfigInputDto['segments'] = [
      { type: 'FIXED', value: 'SO' },
      { type: 'DATE', format: 'YYYYMMDD' },
      { type: 'SEPARATOR', value: '-' },
      { type: 'SEQUENCE', width: 6, startValue: '1', step: '1' },
      {
        type: 'RANDOM',
        letterLength: 2,
        digitLength: 2,
        mode: 'SHUFFLED',
      },
    ]
    const responseSegments: NumberingRuleConfigResponseDto['segments'] =
      inputSegments

    expect(responseSegments.map(readTypedSegmentField)).toEqual([
      'SO',
      'YYYYMMDD',
      '-',
      '6:1:1',
      '2:2:SHUFFLED',
    ])
  })

  it('keeps decimal counters as strings and fixes response timezone', () => {
    const create = requireSchema(document, CreateNumberingRuleRequestDto.name)
    const sequence = requireSchema(
      document,
      NumberingSequenceSegmentInputDto.name,
    )
    const statistics = requireSchema(document, NumberingRuleStatisticsDto.name)
    const config = requireSchema(document, NumberingRuleConfigResponseDto.name)
    const statisticsProperties = statistics.properties as Record<
      string,
      Record<string, unknown>
    >
    const configProperties = config.properties as Record<
      string,
      Record<string, unknown>
    >
    const sequenceProperties = sequence.properties as Record<
      string,
      Record<string, unknown>
    >

    for (const field of [
      'capacity',
      'usedCount',
      'remainingCount',
      'lifetimeUsedCount',
      'nextSequenceValue',
    ]) {
      expect(statisticsProperties[field]?.type).toBe('string')
    }
    expect(sequenceProperties.startValue?.type).toBe('string')
    expect(sequenceProperties.step?.type).toBe('string')
    expect(create.properties).not.toHaveProperty('timezone')
    expect(configProperties.timezone).toMatchObject({
      type: 'string',
      enum: ['Asia/Shanghai'],
      default: 'Asia/Shanghai',
    })
    expect(new NumberingRuleConfigResponseDto().timezone)
      .toBe('Asia/Shanghai')
  })

  it('publishes only the frozen response fields and page envelope', () => {
    const config = requireSchema(document, NumberingRuleConfigResponseDto.name)
    const statistics = requireSchema(document, NumberingRuleStatisticsDto.name)
    const version = requireSchema(document, NumberingRuleVersionDto.name)
    const listItem = requireSchema(document, NumberingRuleListItemDto.name)
    const detail = requireSchema(document, NumberingRuleDetailDto.name)
    const preview = requireSchema(document, PreviewNumberingRuleResponseDto.name)
    const issuance = requireSchema(document, NumberingIssuanceDto.name)
    const rulePage = requireSchema(document, NumberingRulePageDto.name)

    expect(Object.keys(config.properties as object)).toEqual([
      'resetPolicy',
      'timezone',
      'maxOutputLength',
      'segments',
    ])
    expect(Object.keys(statistics.properties as object)).toEqual([
      'statisticsSource',
      'periodKey',
      'capacity',
      'usedCount',
      'remainingCount',
      'lifetimeUsedCount',
      'nextSequenceValue',
      'nextNumberPreview',
      'nextNumberDeterministic',
      'periodStatus',
      'asOf',
    ])
    expect(Object.keys(version.properties as object)).toEqual([
      'id',
      'revision',
      'status',
      'config',
      'capacity',
      'createdAt',
      'publishedAt',
    ])
    expect(Object.keys(listItem.properties as object)).toEqual([
      'id',
      'ruleCode',
      'name',
      'description',
      'status',
      'version',
      'activeRevision',
      'draftRevision',
      'displayVersion',
      'statistics',
      'createdAt',
      'updatedAt',
    ])
    expect(Object.keys(detail.properties as object)).toEqual([
      'id',
      'ruleCode',
      'name',
      'description',
      'status',
      'version',
      'activeVersion',
      'draftVersion',
      'statistics',
      'createdAt',
      'updatedAt',
    ])
    expect(Object.keys(preview.properties as object)).toEqual([
      'normalizedConfig',
      'periodKey',
      'capacity',
      'usedCount',
      'remainingCount',
      'nextSequenceValue',
      'nextNumberPreview',
      'nextNumberDeterministic',
      'periodStatus',
      'samples',
      'asOf',
    ])
    expect(Object.keys(issuance.properties as object)).toEqual([
      'id',
      'ruleRevision',
      'periodKey',
      'generatedNumber',
      'sequenceValue',
      'consumerCode',
      'issuedAt',
    ])
    expect(Object.keys(rulePage.properties as object)).toEqual([
      'items',
      'page',
      'pageSize',
      'total',
    ])
  })

  it('does not expose opaque idempotency material in HTTP schemas', () => {
    const serializedSchemas = JSON.stringify(document.components?.schemas)

    expect(serializedSchemas).not.toContain('idempotencyKey')
    expect(serializedSchemas).not.toContain('idempotencyKeyHash')
    expect(serializedSchemas).not.toContain('requestFingerprintHash')
    expect(serializedSchemas).not.toContain('configFingerprint')
  })
})
