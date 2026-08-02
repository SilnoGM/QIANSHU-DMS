import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  NumberingRuleStatus,
  NumberingRuleVersionStatus,
} from '../../generated/prisma/enums'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import {
  AuditService,
  type RecordAuditEventInput,
} from '../audit/audit.service'
import type { NumberingRuleConfigInputDto } from './dto/numbering-segment.dto'
import type { NumberingRuleDetailDto } from './dto/numbering-response.dto'
import {
  createNumberingDraftVersion,
  createNumberingRuleRecord,
  hasNumberingIssuance,
  readNumberingRuleForClone,
  readNumberingRuleForUpdate,
  readNumberingRuleVersionSnapshots,
  readNumberingTransactionTimestamp,
  replaceNumberingDraftVersion,
  updateNumberingRuleRecord,
} from './numbering-command.persistence'
import { NumberingCommandService } from './numbering-command.service'
import { calculateNumberingConfigFingerprint } from './numbering-config-fingerprint'
import type { NumberingQueryService } from './numbering-query.service'

jest.mock('../../infrastructure/database/transaction-timeouts', () => ({
  applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('./numbering-command.persistence', () => ({
  createNumberingDraftVersion: jest.fn(),
  createNumberingRuleRecord: jest.fn(),
  hasNumberingIssuance: jest.fn(),
  readNumberingRuleForClone: jest.fn(),
  readNumberingRuleForUpdate: jest.fn(),
  readNumberingRuleVersionSnapshots: jest.fn(),
  readNumberingTransactionTimestamp: jest.fn(),
  replaceNumberingDraftVersion: jest.fn(),
  updateNumberingRuleRecord: jest.fn(),
}))

const mockedApplyTransactionTimeouts = jest.mocked(applyTransactionTimeouts)
const mockedCreateDraft = jest.mocked(createNumberingDraftVersion)
const mockedCreateRule = jest.mocked(createNumberingRuleRecord)
const mockedHasIssuance = jest.mocked(hasNumberingIssuance)
const mockedReadForClone = jest.mocked(readNumberingRuleForClone)
const mockedReadForUpdate = jest.mocked(readNumberingRuleForUpdate)
const mockedReadVersions = jest.mocked(readNumberingRuleVersionSnapshots)
const mockedReadTimestamp = jest.mocked(readNumberingTransactionTimestamp)
const mockedReplaceDraft = jest.mocked(replaceNumberingDraftVersion)
const mockedUpdateRule = jest.mocked(updateNumberingRuleRecord)

const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const RULE_ID = '20000000-0000-4000-8000-000000000001'
const SOURCE_ID = '20000000-0000-4000-8000-000000000002'
const VERSION_ID = '30000000-0000-4000-8000-000000000001'
const DRAFT_ID = '30000000-0000-4000-8000-000000000002'
const REQUEST_ID = 'numbering-command-spec'
const AS_OF = new Date('2026-08-02T04:00:00.000Z')

const context = {
  actorUserId: ACTOR_ID,
  requestId: REQUEST_ID,
} as const

const BASE_CONFIG: NumberingRuleConfigInputDto = {
  resetPolicy: 'NEVER',
  segments: [
    { type: 'FIXED', value: 'SO' },
    { type: 'SEQUENCE', width: 6, startValue: '1', step: '1' },
  ],
}

function detailDto(overrides: Partial<NumberingRuleDetailDto> = {}) {
  return {
    id: RULE_ID,
    ruleCode: 'SALES_ORDER',
    name: '销售订单',
    description: null,
    status: NumberingRuleStatus.DRAFT,
    version: 1,
    activeVersion: null,
    draftVersion: null,
    statistics: {
      statisticsSource: 'DRAFT',
      periodKey: 'ALL',
      capacity: '999999',
      usedCount: '0',
      remainingCount: '999999',
      lifetimeUsedCount: '0',
      nextSequenceValue: '1',
      nextNumberPreview: 'SO000001',
      nextNumberDeterministic: true,
      periodStatus: 'AVAILABLE',
      asOf: AS_OF.toISOString(),
    },
    createdAt: AS_OF.toISOString(),
    updatedAt: AS_OF.toISOString(),
    ...overrides,
  } satisfies NumberingRuleDetailDto
}

function ruleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    ruleCode: 'SALES_ORDER',
    name: '销售订单',
    description: null,
    status: NumberingRuleStatus.DRAFT,
    version: 1,
    ...overrides,
  }
}

function versionSnapshot(
  status: typeof NumberingRuleVersionStatus.ACTIVE
    | typeof NumberingRuleVersionStatus.DRAFT,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: status === NumberingRuleVersionStatus.ACTIVE
      ? VERSION_ID
      : DRAFT_ID,
    revision: status === NumberingRuleVersionStatus.ACTIVE ? 3 : 4,
    status,
    configFingerprint: status === NumberingRuleVersionStatus.ACTIVE
      ? '1'.repeat(64)
      : '2'.repeat(64),
    config: BASE_CONFIG,
    ...overrides,
  }
}

function createFixture() {
  const transaction = {}
  const prisma = {
    $transaction: jest.fn((callback: (tx: object) => unknown) =>
      callback(transaction)),
  }
  const audit = {
    record: jest.fn<
      Promise<unknown>,
      [Prisma.TransactionClient, RecordAuditEventInput]
    >().mockResolvedValue({ id: 'audit-id' }),
  }
  const query = {
    getDetailInTransaction: jest.fn().mockResolvedValue(detailDto()),
  }

  return {
    audit,
    query,
    prisma,
    service: new NumberingCommandService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      query as unknown as NumberingQueryService,
    ),
    transaction,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedApplyTransactionTimeouts.mockResolvedValue(undefined)
  mockedReadTimestamp.mockResolvedValue(AS_OF)
  mockedCreateRule.mockResolvedValue({ id: RULE_ID })
  mockedCreateDraft.mockResolvedValue({ id: VERSION_ID })
  mockedReadForUpdate.mockResolvedValue(ruleRecord())
  mockedReadForClone.mockResolvedValue(ruleRecord({
    id: SOURCE_ID,
    ruleCode: 'SOURCE_ORDER',
    description: '来源说明',
  }))
  mockedReadVersions.mockResolvedValue([
    versionSnapshot(NumberingRuleVersionStatus.ACTIVE),
  ])
  mockedHasIssuance.mockResolvedValue(false)
  mockedReplaceDraft.mockResolvedValue(undefined)
  mockedUpdateRule.mockResolvedValue(undefined)
})

describe('NumberingCommandService', () => {
  it('creates DRAFT rule/revision/segments/Audit and reads detail in one transaction', async () => {
    const { audit, query, service, transaction } = createFixture()

    await expect(service.create(context, {
      ruleCode: '　sales_order ',
      name: '  销售　订单  ',
      description: '  正式   单据  ',
      ...BASE_CONFIG,
    })).resolves.toEqual(detailDto())

    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(transaction)
    expect(
      mockedApplyTransactionTimeouts.mock.invocationCallOrder[0],
    ).toBeLessThan(mockedReadTimestamp.mock.invocationCallOrder[0])
    expect(mockedCreateRule).toHaveBeenCalledWith(transaction, {
      ruleCode: 'SALES_ORDER',
      name: '销售 订单',
      description: '正式 单据',
    })
    expect(mockedCreateDraft).toHaveBeenCalledWith(transaction, {
      ruleId: RULE_ID,
      revision: 1,
      config: BASE_CONFIG,
      configFingerprint: calculateNumberingConfigFingerprint(BASE_CONFIG),
    })
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.NUMBERING_RULE_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'NumberingRule',
      targetId: RULE_ID,
      requestId: REQUEST_ID,
      metadata: {
        ruleCode: 'SALES_ORDER',
        changedFields: 'description,name,resetPolicy,ruleCode,segments',
        revision: 1,
        version: 1,
        resetPolicy: 'NEVER',
        segmentTypes: 'FIXED,SEQUENCE',
        maxOutputLength: 8,
      },
    })
    expect(query.getDetailInTransaction).toHaveBeenCalledWith(
      transaction,
      RULE_ID,
      AS_OF,
    )
  })

  it('updates metadata without loading or manufacturing a draft', async () => {
    const { audit, service, transaction } = createFixture()

    await service.update(context, RULE_ID, {
      name: ' 销售订单（新版） ',
      expectedVersion: 1,
    })

    expect(mockedReadForUpdate).toHaveBeenCalledWith(transaction, RULE_ID)
    expect(mockedReadVersions).not.toHaveBeenCalled()
    expect(mockedCreateDraft).not.toHaveBeenCalled()
    expect(mockedReplaceDraft).not.toHaveBeenCalled()
    expect(mockedUpdateRule).toHaveBeenCalledWith(transaction, RULE_ID, {
      name: '销售订单（新版）',
    })
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: AuditEventType.NUMBERING_RULE_UPDATED,
        metadata: {
          ruleCode: 'SALES_ORDER',
          changedFields: 'name',
          previousVersion: 1,
          version: 2,
        },
      }),
    )
  })

  it('returns a canonical no-op without version, draft or Audit writes', async () => {
    const { audit, query, service, transaction } = createFixture()

    await service.update(context, RULE_ID, {
      name: '  销售订单 ',
      description: null,
      expectedVersion: 1,
    })

    expect(mockedUpdateRule).not.toHaveBeenCalled()
    expect(mockedReadVersions).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
    expect(query.getDetailInTransaction).toHaveBeenCalledWith(
      transaction,
      RULE_ID,
      AS_OF,
    )
  })

  it('rejects stale expectedVersion before reading or writing config', async () => {
    mockedReadForUpdate.mockResolvedValue(ruleRecord({ version: 3 }))
    const { audit, service } = createFixture()

    await expect(service.update(context, RULE_ID, {
      segments: [{ type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }],
      expectedVersion: 2,
    })).rejects.toMatchObject({
      code: 'NUMBERING_RULE_STATE_CHANGED',
      status: 409,
    })

    expect(mockedReadVersions).not.toHaveBeenCalled()
    expect(mockedUpdateRule).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('replaces the existing draft and increments rule version only once', async () => {
    mockedReadVersions.mockResolvedValue([
      versionSnapshot(NumberingRuleVersionStatus.DRAFT),
      versionSnapshot(NumberingRuleVersionStatus.ACTIVE),
    ])
    const { audit, service, transaction } = createFixture()
    const segments: NumberingRuleConfigInputDto['segments'] = [
      { type: 'FIXED', value: 'SO' },
      { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
    ]

    await service.update(context, RULE_ID, {
      name: '新名称',
      segments: [...segments],
      expectedVersion: 1,
    })

    expect(mockedReplaceDraft).toHaveBeenCalledWith(transaction, {
      versionId: DRAFT_ID,
      config: { resetPolicy: 'NEVER', segments },
      configFingerprint: calculateNumberingConfigFingerprint({
        resetPolicy: 'NEVER',
        segments,
      }),
    })
    expect(mockedCreateDraft).not.toHaveBeenCalled()
    expect(mockedUpdateRule).toHaveBeenCalledTimes(1)
    expect(mockedUpdateRule).toHaveBeenCalledWith(transaction, RULE_ID, {
      name: '新名称',
    })
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      metadata: {
        changedFields: 'name,segments',
        revision: 4,
        previousVersion: 1,
        version: 2,
      },
    })
  })

  it('creates the next draft from active only when canonical config changes', async () => {
    const { service, transaction } = createFixture()

    await service.update(context, RULE_ID, {
      segments: [
        { type: 'FIXED', value: 'SO' },
        { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
      ],
      expectedVersion: 1,
    })

    expect(mockedCreateDraft).toHaveBeenCalledWith(transaction, {
      ruleId: RULE_ID,
      revision: 4,
      config: {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value: 'SO' },
          { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
        ],
      },
      configFingerprint: calculateNumberingConfigFingerprint({
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value: 'SO' },
          { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
        ],
      }),
    })
    expect(mockedUpdateRule).toHaveBeenCalledWith(transaction, RULE_ID, {})
  })

  it('merges a resetPolicy-only change onto the preferred draft config', async () => {
    const draftConfig: NumberingRuleConfigInputDto = {
      resetPolicy: 'NEVER',
      segments: [
        { type: 'DATE', format: 'YYYYMMDD' },
        { type: 'SEQUENCE', width: 6, startValue: '1', step: '1' },
      ],
    }
    mockedReadVersions.mockResolvedValue([
      versionSnapshot(NumberingRuleVersionStatus.ACTIVE),
      versionSnapshot(NumberingRuleVersionStatus.DRAFT, {
        config: draftConfig,
        configFingerprint: calculateNumberingConfigFingerprint(draftConfig),
      }),
    ])
    const { service, transaction } = createFixture()

    await service.update(context, RULE_ID, {
      resetPolicy: 'DAILY',
      expectedVersion: 1,
    })

    expect(mockedReplaceDraft).toHaveBeenCalledWith(transaction, {
      versionId: DRAFT_ID,
      config: {
        resetPolicy: 'DAILY',
        segments: draftConfig.segments,
      },
      configFingerprint: calculateNumberingConfigFingerprint({
        resetPolicy: 'DAILY',
        segments: draftConfig.segments,
      }),
    })
    expect(mockedCreateDraft).not.toHaveBeenCalled()
    expect(mockedUpdateRule).toHaveBeenCalledWith(transaction, RULE_ID, {})
  })

  it('treats a canonically identical config update as a no-op', async () => {
    mockedReadVersions.mockResolvedValue([
      versionSnapshot(NumberingRuleVersionStatus.ACTIVE, {
        configFingerprint: calculateNumberingConfigFingerprint(BASE_CONFIG),
      }),
    ])
    const { audit, query, service, transaction } = createFixture()

    await service.update(context, RULE_ID, {
      resetPolicy: 'NEVER',
      segments: [
        { type: 'FIXED', value: 'SO' },
        { type: 'SEQUENCE', width: 6, startValue: '1', step: '1' },
      ],
      expectedVersion: 1,
    })

    expect(mockedHasIssuance).not.toHaveBeenCalled()
    expect(mockedCreateDraft).not.toHaveBeenCalled()
    expect(mockedReplaceDraft).not.toHaveBeenCalled()
    expect(mockedUpdateRule).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
    expect(query.getDetailInTransaction).toHaveBeenCalledWith(
      transaction,
      RULE_ID,
      AS_OF,
    )
  })

  it('rejects issued numbering-space structure changes', async () => {
    mockedHasIssuance.mockResolvedValue(true)
    const { service } = createFixture()

    await expect(service.update(context, RULE_ID, {
      segments: [
        { type: 'FIXED', value: 'PO' },
        { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
      ],
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'NUMBERING_RULE_CONFIG_INVALID',
      status: 422,
    })
    expect(mockedCreateDraft).not.toHaveBeenCalled()
  })

  it('allows an issued rule to expand only its sequence width', async () => {
    mockedHasIssuance.mockResolvedValue(true)
    const { service } = createFixture()

    await expect(service.update(context, RULE_ID, {
      segments: [
        { type: 'FIXED', value: 'SO' },
        { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
      ],
      expectedVersion: 1,
    })).resolves.toEqual(detailDto())
    expect(mockedCreateDraft).toHaveBeenCalled()
  })

  it('clones active before draft, copies omitted description and audits source code', async () => {
    mockedReadVersions.mockResolvedValue([
      versionSnapshot(NumberingRuleVersionStatus.DRAFT, {
        config: { ...BASE_CONFIG, segments: [{ type: 'RANDOM', letterLength: 2, digitLength: 2, mode: 'SHUFFLED' }] },
      }),
      versionSnapshot(NumberingRuleVersionStatus.ACTIVE),
    ])
    const { audit, query, service, transaction } = createFixture()

    await service.clone(context, SOURCE_ID, {
      ruleCode: ' cloned_order ',
      name: ' 克隆订单 ',
      expectedVersion: 1,
    })

    expect(mockedReadForClone).toHaveBeenCalledWith(transaction, SOURCE_ID)
    expect(mockedCreateRule).toHaveBeenCalledWith(transaction, {
      ruleCode: 'CLONED_ORDER',
      name: '克隆订单',
      description: '来源说明',
    })
    expect(mockedCreateDraft).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        ruleId: RULE_ID,
        revision: 1,
        config: BASE_CONFIG,
      }),
    )
    expect(audit.record.mock.calls[0]?.[1]).toMatchObject({
      eventType: AuditEventType.NUMBERING_RULE_CREATED,
      metadata: {
        clonedFromRuleCode: 'SOURCE_ORDER',
        ruleCode: 'CLONED_ORDER',
        revision: 1,
        version: 1,
      },
    })
    const metadata = audit.record.mock.calls[0]?.[1]?.metadata
    expect(JSON.stringify(metadata)).not.toMatch(
      /configFingerprint|idempotency|startValue|fixedValue/iu,
    )
    expect(query.getDetailInTransaction).toHaveBeenCalledWith(
      transaction,
      RULE_ID,
      AS_OF,
    )
  })

  it.each([
    ['string override', ' 新说明 ', '新说明'],
    ['explicit clear', null, null],
  ] as const)(
    'supports clone description %s',
    async (_label, description, expected) => {
      const { service, transaction } = createFixture()

      await service.clone(context, SOURCE_ID, {
        ruleCode: 'CLONED_ORDER',
        name: '克隆订单',
        description,
        expectedVersion: 1,
      })

      expect(mockedCreateRule).toHaveBeenCalledWith(
        transaction,
        expect.objectContaining({ description: expected }),
      )
    },
  )

  it('falls back to the source draft when clone has no active version', async () => {
    const draftOnlyConfig: NumberingRuleConfigInputDto = {
      resetPolicy: 'NEVER',
      segments: [
        {
          type: 'RANDOM',
          letterLength: 3,
          digitLength: 5,
          mode: 'SHUFFLED',
        },
      ],
    }
    mockedReadVersions.mockResolvedValue([
      versionSnapshot(NumberingRuleVersionStatus.DRAFT, {
        config: draftOnlyConfig,
        configFingerprint: calculateNumberingConfigFingerprint(
          draftOnlyConfig,
        ),
      }),
    ])
    const { service, transaction } = createFixture()

    await service.clone(context, SOURCE_ID, {
      ruleCode: 'CLONED_DRAFT',
      name: '草稿克隆',
      expectedVersion: 1,
    })

    expect(mockedCreateDraft).toHaveBeenCalledWith(transaction, {
      ruleId: RULE_ID,
      revision: 1,
      config: draftOnlyConfig,
      configFingerprint: calculateNumberingConfigFingerprint(draftOnlyConfig),
    })
  })

  it('rejects missing or stale clone source before creating target rows', async () => {
    mockedReadForClone.mockResolvedValueOnce(null)
    const missing = createFixture()

    await expect(missing.service.clone(context, SOURCE_ID, {
      ruleCode: 'CLONED_ORDER',
      name: '克隆订单',
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'NUMBERING_RULE_NOT_FOUND' })

    mockedReadForClone.mockResolvedValue(ruleRecord({ version: 2 }))
    const stale = createFixture()
    await expect(stale.service.clone(context, SOURCE_ID, {
      ruleCode: 'CLONED_ORDER',
      name: '克隆订单',
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'NUMBERING_RULE_STATE_CHANGED' })

    expect(mockedCreateRule).not.toHaveBeenCalled()
  })

  it('maps Audit failure safely and never performs the final detail read', async () => {
    const { audit, query, service } = createFixture()
    audit.record.mockRejectedValue(new Error('must-not-leak audit'))

    await expect(service.create(context, {
      ruleCode: 'SALES_ORDER',
      name: '销售订单',
      ...BASE_CONFIG,
    })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    })

    expect(query.getDetailInTransaction).not.toHaveBeenCalled()
  })
})
