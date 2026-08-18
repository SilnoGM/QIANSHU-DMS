import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { FundConfigurationCommandService } from './fund-configuration-command.service'
import { FundPostingError } from './fund-posting.errors'

const ACTOR_ID = '11111111-1111-4111-a111-111111111111'
const TYPE_ID = '22222222-2222-4222-a222-222222222222'
const ACTIVE_RULE_ID = '33333333-3333-4333-a333-333333333333'
const DRAFT_RULE_ID = '44444444-4444-4444-a444-444444444444'
const SOURCE_ID = '55555555-5555-4555-a555-555555555555'
const SECOND_TYPE_ID = '66666666-6666-4666-a666-666666666666'
const CONTEXT = {
  actorUserId: ACTOR_ID,
  requestId: 'request-1',
  correlationId: 'correlation-1',
}

const companyOnlyLegs = [{
  position: 1,
  accountTarget: 'COMPANY' as const,
  directionPolicy: 'DEBIT' as const,
  amountStrategy: 'FULL_AMOUNT' as const,
}]

function ruleRow(options: {
  id?: string
  revision?: number
  status?: 'DRAFT' | 'ACTIVE' | 'RETIRED'
  legs?: readonly Record<string, unknown>[]
} = {}) {
  const status = options.status ?? 'DRAFT'
  return {
    id: options.id ?? DRAFT_RULE_ID,
    postingTypeId: TYPE_ID,
    revision: options.revision ?? 2,
    status,
    createdByUserId: ACTOR_ID,
    publishedByUserId: status === 'DRAFT' ? null : ACTOR_ID,
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    publishedAt: status === 'DRAFT'
      ? null
      : new Date('2026-08-18T01:00:00.000Z'),
    legs: (options.legs ?? companyOnlyLegs).map((leg, index) => ({
      id: `${index + 7}7777777-7777-4777-a777-777777777777`,
      adjustmentMode: null,
      ...leg,
    })),
  }
}

function postingTypeRow(options: {
  code?: string
  inputMode?: 'STANDARD' | 'ADMIN_ADJUSTMENT'
  version?: number
  enabled?: boolean
  active?: ReturnType<typeof ruleRow> | null
  draft?: ReturnType<typeof ruleRow> | null
} = {}) {
  const active = options.active === undefined
    ? ruleRow({ id: ACTIVE_RULE_ID, revision: 1, status: 'ACTIVE' })
    : options.active
  const draft = options.draft === undefined ? ruleRow() : options.draft
  return {
    id: TYPE_ID,
    code: options.code ?? 'RENT_UTILITIES',
    name: '房租水电',
    description: null,
    businessCategory: options.inputMode === 'ADMIN_ADJUSTMENT'
      ? 'ADJUSTMENT' as const
      : 'COST' as const,
    requiresUser: options.inputMode === 'ADMIN_ADJUSTMENT',
    amountSignPolicy: options.inputMode === 'ADMIN_ADJUSTMENT'
      ? 'NON_ZERO_SIGNED' as const
      : 'POSITIVE_ONLY' as const,
    inputMode: options.inputMode ?? 'STANDARD',
    enabled: options.enabled ?? false,
    currentRuleVersionId: active?.id ?? null,
    version: options.version ?? 3,
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T02:00:00.000Z'),
    currentRuleVersion: active,
    ruleVersions: draft ? [draft] : [],
  }
}

function sourceRow(options: {
  version?: number
  enabled?: boolean
  allowedTypeIds?: readonly string[]
} = {}) {
  const allowedTypeIds = options.allowedTypeIds ?? [TYPE_ID]
  return {
    id: SOURCE_ID,
    code: 'ORDER_DOMAIN',
    name: '订单域',
    description: null,
    enabled: options.enabled ?? true,
    version: options.version ?? 1,
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T01:00:00.000Z'),
    allowedPostingTypes: allowedTypeIds.map((id, index) => ({
      createdAt: new Date('2026-08-18T00:30:00.000Z'),
      postingType: {
        id,
        code: index === 0 ? 'ORDER_SETTLEMENT' : 'PURCHASE_PAYMENT',
        name: index === 0 ? '订单结算' : '采购付款',
        businessCategory: index === 0 ? 'REVENUE' : 'COST',
        enabled: true,
      },
    })),
  }
}

function fixture() {
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue([]),
    fundPostingType: {
      create: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown>, [unknown]>(),
      findUnique: jest.fn<Promise<unknown>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
      updateMany: jest.fn<Promise<unknown>, [unknown]>(),
    },
    fundPostingRuleVersion: {
      create: jest.fn<Promise<unknown>, [unknown]>(),
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findUnique: jest.fn<Promise<unknown>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
      updateMany: jest.fn<Promise<unknown>, [unknown]>(),
    },
    fundPostingRuleLeg: {
      deleteMany: jest.fn<Promise<unknown>, [unknown]>(),
      createMany: jest.fn<Promise<unknown>, [unknown]>(),
    },
    fundBusinessSource: {
      create: jest.fn<Promise<unknown>, [unknown]>(),
      findUnique: jest.fn<Promise<unknown>, [unknown]>(),
      updateMany: jest.fn<Promise<unknown>, [unknown]>(),
    },
    fundBusinessSourcePostingType: {
      findMany: jest.fn<Promise<unknown>, [unknown]>(),
      count: jest.fn<Promise<unknown>, [unknown]>(),
      createMany: jest.fn<Promise<unknown>, [unknown]>(),
      deleteMany: jest.fn<Promise<unknown>, [unknown]>(),
    },
  }
  const prisma = {
    $transaction: jest.fn<
      Promise<unknown>,
      [(client: typeof transaction) => Promise<unknown>]
    >(callback => callback(transaction)),
  }
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>()
      .mockResolvedValue({ id: 'audit-1' }),
  }
  const service = new FundConfigurationCommandService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { audit, prisma, service, transaction }
}

async function expectFundReject(
  promise: Promise<unknown>,
  code: string,
  field?: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(FundPostingError)
  await expect(promise).rejects.toMatchObject({
    code,
    ...(field === undefined ? {} : { field }),
  })
}

describe('FundConfigurationCommandService posting types', () => {
  it('creates a disabled STANDARD type with its first DRAFT and Audit', async () => {
    const { audit, service, transaction } = fixture()
    transaction.fundPostingType.create.mockResolvedValue({ id: TYPE_ID })
    transaction.fundPostingType.findUnique.mockResolvedValue(postingTypeRow({
      active: null,
      draft: ruleRow({ revision: 1 }),
      version: 1,
    }))

    const result = await service.createPostingType(CONTEXT, {
      code: 'RENT_REFUND',
      name: '房租退款',
      businessCategory: 'COST',
      requiresUser: false,
      amountSignPolicy: 'POSITIVE_ONLY',
      legs: companyOnlyLegs,
    })

    expect(result).toMatchObject({
      id: TYPE_ID,
      inputMode: 'STANDARD',
      enabled: false,
      version: 1,
      draftRule: { revision: 1, status: 'DRAFT' },
    })
    const createArguments = transaction.fundPostingType.create
      .mock.calls[0]?.[0] as {
        data: {
          code: string
          inputMode: string
          enabled: boolean
          version: number
          ruleVersions: {
            create: {
              revision: number
              status: string
              createdByUserId: string
              legs: { createMany: { data: unknown } }
            }
          }
        }
        select: { id: boolean }
      }
    expect(createArguments).toEqual({
      data: {
        code: 'RENT_REFUND',
        name: '房租退款',
        description: null,
        businessCategory: 'COST',
        requiresUser: false,
        amountSignPolicy: 'POSITIVE_ONLY',
        inputMode: 'STANDARD',
        enabled: false,
        version: 1,
        ruleVersions: {
          create: {
            revision: 1,
            status: 'DRAFT',
            createdByUserId: ACTOR_ID,
            legs: { createMany: { data: companyOnlyLegs } },
          },
        },
      },
      select: { id: true },
    })
    const auditInput = audit.record.mock.calls[0]?.[1] as {
      eventType: string
      targetType: string
      targetId: string
      metadata: Record<string, unknown>
    }
    expect(audit.record.mock.calls[0]?.[0]).toBe(transaction)
    expect(auditInput).toMatchObject({
      eventType: 'FUND_POSTING_TYPE_CREATED',
      targetType: 'FundPostingType',
      targetId: TYPE_ID,
      metadata: {
        code: 'RENT_REFUND',
        draftRevision: 1,
        enabled: false,
      },
    })
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.fundPostingType.create.mock.invocationCallOrder[0],
    )
  })

  it('returns a no-op when replacing an identical DRAFT', async () => {
    const { audit, service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: TYPE_ID,
        code: 'RENT_UTILITIES',
        businessCategory: 'COST',
        requiresUser: false,
        amountSignPolicy: 'POSITIVE_ONLY',
        inputMode: 'STANDARD',
        enabled: false,
        currentRuleVersionId: ACTIVE_RULE_ID,
        version: 3,
      }])
    transaction.fundPostingRuleVersion.findFirst.mockResolvedValue(
      ruleRow({ legs: companyOnlyLegs }),
    )
    transaction.fundPostingType.findUnique.mockResolvedValue(postingTypeRow())

    const result = await service.replaceDraftRule(CONTEXT, {
      postingTypeId: TYPE_ID,
      expectedVersion: 3,
      legs: companyOnlyLegs,
    })

    expect(result).toMatchObject({ changed: false })
    expect(transaction.fundPostingRuleLeg.deleteMany).not.toHaveBeenCalled()
    expect(transaction.fundPostingRuleLeg.createMany).not.toHaveBeenCalled()
    expect(transaction.fundPostingType.updateMany).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('rejects arbitrary administrator adjustment templates', async () => {
    const { audit, service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: TYPE_ID,
        code: 'ADMIN_MANUAL_ADJUSTMENT',
        businessCategory: 'ADJUSTMENT',
        requiresUser: true,
        amountSignPolicy: 'NON_ZERO_SIGNED',
        inputMode: 'ADMIN_ADJUSTMENT',
        enabled: true,
        currentRuleVersionId: ACTIVE_RULE_ID,
        version: 1,
      }])

    await expectFundReject(
      service.replaceDraftRule(CONTEXT, {
        postingTypeId: TYPE_ID,
        expectedVersion: 1,
        legs: [{
          position: 1,
          accountTarget: 'USER',
          directionPolicy: 'FOLLOW_AMOUNT_SIGN',
          amountStrategy: 'FULL_AMOUNT',
          adjustmentMode: 'USER_ONLY',
        }],
      }),
      'FUND_POSTING_RULE_INVALID',
    )
    expect(transaction.fundPostingRuleVersion.create).not.toHaveBeenCalled()
    expect(transaction.fundPostingRuleLeg.deleteMany).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('publishes under lock in RETIRED -> ACTIVE -> pointer order', async () => {
    const { audit, service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: TYPE_ID,
        code: 'RENT_UTILITIES',
        businessCategory: 'COST',
        requiresUser: false,
        amountSignPolicy: 'POSITIVE_ONLY',
        inputMode: 'STANDARD',
        enabled: false,
        currentRuleVersionId: ACTIVE_RULE_ID,
        version: 3,
      }])
    transaction.fundPostingRuleVersion.findUnique.mockResolvedValue(ruleRow())
    transaction.fundPostingRuleVersion.updateMany.mockResolvedValue({ count: 1 })
    transaction.fundPostingRuleVersion.update.mockResolvedValue({ id: DRAFT_RULE_ID })
    transaction.fundPostingType.updateMany.mockResolvedValue({ count: 1 })
    transaction.fundPostingType.findUnique.mockResolvedValue(postingTypeRow({
      active: ruleRow({ id: DRAFT_RULE_ID, revision: 2, status: 'ACTIVE' }),
      draft: null,
      version: 4,
    }))

    const result = await service.publishDraftRule(CONTEXT, {
      postingTypeId: TYPE_ID,
      draftRuleVersionId: DRAFT_RULE_ID,
      expectedVersion: 3,
    })

    expect(result).toMatchObject({
      changed: true,
      postingType: {
        currentRuleVersionId: DRAFT_RULE_ID,
        version: 4,
        activeRule: { id: DRAFT_RULE_ID, status: 'ACTIVE' },
        draftRule: null,
      },
    })
    expect(transaction.fundPostingRuleVersion.updateMany).toHaveBeenCalledWith({
      where: { postingTypeId: TYPE_ID, status: 'ACTIVE' },
      data: { status: 'RETIRED' },
    })
    const publishArguments = transaction.fundPostingRuleVersion.update
      .mock.calls[0]?.[0] as {
        where: { id: string }
        data: {
          status: string
          publishedByUserId: string
          publishedAt: Date
        }
        select: { id: boolean }
      }
    expect(publishArguments).toEqual({
      where: { id: DRAFT_RULE_ID },
      data: {
        status: 'ACTIVE',
        publishedByUserId: ACTOR_ID,
        publishedAt: publishArguments.data.publishedAt,
      },
      select: { id: true },
    })
    expect(publishArguments.data.publishedAt).toBeInstanceOf(Date)
    expect(transaction.fundPostingType.updateMany).toHaveBeenCalledWith({
      where: { id: TYPE_ID, version: 3 },
      data: { currentRuleVersionId: DRAFT_RULE_ID, version: { increment: 1 } },
    })
    expect(
      transaction.fundPostingRuleVersion.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      transaction.fundPostingRuleVersion.update.mock.invocationCallOrder[0],
    )
    expect(
      transaction.fundPostingRuleVersion.update.mock.invocationCallOrder[0],
    ).toBeLessThan(
      transaction.fundPostingType.updateMany.mock.invocationCallOrder[0],
    )
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'FUND_POSTING_RULE_PUBLISHED',
        targetId: DRAFT_RULE_ID,
        metadata: {
          postingTypeCode: 'RENT_UTILITIES',
          postingTypeId: TYPE_ID,
          revision: 2,
        },
      }),
    )
  })

  it('creates the next DRAFT revision when none exists', async () => {
    const { audit, service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: TYPE_ID,
        code: 'RENT_UTILITIES',
        businessCategory: 'COST',
        requiresUser: false,
        amountSignPolicy: 'POSITIVE_ONLY',
        inputMode: 'STANDARD',
        enabled: true,
        currentRuleVersionId: ACTIVE_RULE_ID,
        version: 3,
      }])
    transaction.fundPostingRuleVersion.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ revision: 2 })
    transaction.fundPostingRuleVersion.create.mockResolvedValue({
      id: DRAFT_RULE_ID,
    })
    transaction.fundPostingType.updateMany.mockResolvedValue({ count: 1 })
    transaction.fundPostingType.findUnique.mockResolvedValue(postingTypeRow({
      draft: ruleRow({ revision: 3 }),
      version: 4,
    }))

    const result = await service.replaceDraftRule(CONTEXT, {
      postingTypeId: TYPE_ID,
      expectedVersion: 3,
      legs: companyOnlyLegs,
    })

    expect(result).toMatchObject({
      changed: true,
      postingType: { version: 4, draftRule: { revision: 3 } },
    })
    expect(transaction.fundPostingRuleVersion.create).toHaveBeenCalledWith({
      data: {
        postingTypeId: TYPE_ID,
        revision: 3,
        status: 'DRAFT',
        createdByUserId: ACTOR_ID,
        legs: { createMany: { data: companyOnlyLegs } },
      },
      select: { id: true },
    })
    expect(audit.record).toHaveBeenCalledTimes(1)
  })

  it('enables only a type with an ACTIVE pointer and rejects stale versions', async () => {
    const enabled = fixture()
    enabled.transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: TYPE_ID,
        code: 'RENT_UTILITIES',
        name: '房租水电',
        description: null,
        businessCategory: 'COST',
        requiresUser: false,
        amountSignPolicy: 'POSITIVE_ONLY',
        inputMode: 'STANDARD',
        enabled: false,
        currentRuleVersionId: ACTIVE_RULE_ID,
        version: 3,
      }])
    enabled.transaction.fundPostingType.updateMany.mockResolvedValue({ count: 1 })
    enabled.transaction.fundPostingType.findUnique.mockResolvedValue(
      postingTypeRow({ enabled: true, version: 4, draft: null }),
    )

    const result = await enabled.service.setPostingTypeEnabled(CONTEXT, {
      postingTypeId: TYPE_ID,
      enabled: true,
      expectedVersion: 3,
    })
    expect(result).toMatchObject({
      changed: true,
      postingType: { enabled: true, version: 4 },
    })
    expect(enabled.audit.record).toHaveBeenCalledWith(
      enabled.transaction,
      expect.objectContaining({ eventType: 'FUND_POSTING_TYPE_ENABLED' }),
    )

    const stale = fixture()
    stale.transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: TYPE_ID,
        code: 'RENT_UTILITIES',
        enabled: false,
        currentRuleVersionId: ACTIVE_RULE_ID,
        version: 4,
      }])
    await expectFundReject(
      stale.service.setPostingTypeEnabled(CONTEXT, {
        postingTypeId: TYPE_ID,
        enabled: true,
        expectedVersion: 3,
      }),
      'FUND_CONFIG_STATE_CHANGED',
    )
    expect(stale.transaction.fundPostingType.updateMany).not.toHaveBeenCalled()
    expect(stale.audit.record).not.toHaveBeenCalled()
  })

  it('fails closed when configuration Audit cannot be written', async () => {
    const { audit, service, transaction } = fixture()
    transaction.fundPostingType.create.mockResolvedValue({ id: TYPE_ID })
    transaction.fundPostingType.findUnique.mockResolvedValue(postingTypeRow({
      active: null,
      draft: ruleRow({ revision: 1 }),
      version: 1,
    }))
    audit.record.mockRejectedValue(new Error('must-not-leak audit detail'))

    await expectFundReject(
      service.createPostingType(CONTEXT, {
        code: 'RENT_REFUND',
        name: '房租退款',
        businessCategory: 'COST',
        requiresUser: false,
        amountSignPolicy: 'POSITIVE_ONLY',
        legs: companyOnlyLegs,
      }),
      'FUND_INTERNAL_ERROR',
    )
  })
})

describe('FundConfigurationCommandService business sources', () => {
  it('creates an enabled source only after resolving every allowed type', async () => {
    const { audit, service, transaction } = fixture()
    transaction.fundPostingType.findMany.mockResolvedValue([
      { id: TYPE_ID },
      { id: SECOND_TYPE_ID },
    ])
    transaction.fundBusinessSource.create.mockResolvedValue({ id: SOURCE_ID })
    transaction.fundBusinessSource.findUnique.mockResolvedValue(sourceRow({
      allowedTypeIds: [TYPE_ID, SECOND_TYPE_ID],
    }))

    const result = await service.createBusinessSource(CONTEXT, {
      code: 'ORDER_DOMAIN',
      name: '订单域',
      enabled: true,
      allowedPostingTypeIds: [TYPE_ID, SECOND_TYPE_ID],
    })

    expect(result).toMatchObject({
      id: SOURCE_ID,
      enabled: true,
      allowedPostingTypes: [{ id: TYPE_ID }, { id: SECOND_TYPE_ID }],
    })
    const createArguments = transaction.fundBusinessSource.create
      .mock.calls[0]?.[0] as {
        data: Record<string, unknown>
        select: { id: boolean }
      }
    expect(createArguments).toEqual({
      data: {
        code: 'ORDER_DOMAIN',
        name: '订单域',
        description: null,
        enabled: true,
        version: 1,
        allowedPostingTypes: {
          createMany: {
            data: [
              { postingTypeId: TYPE_ID },
              { postingTypeId: SECOND_TYPE_ID },
            ],
          },
        },
      },
      select: { id: true },
    })
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'FUND_BUSINESS_SOURCE_CREATED',
        targetId: SOURCE_ID,
        metadata: {
          allowedPostingTypeIdsCsv: `${TYPE_ID},${SECOND_TYPE_ID}`,
          code: 'ORDER_DOMAIN',
          enabled: true,
        },
      }),
    )
  })

  it('does not write or Audit an identical source update', async () => {
    const { audit, service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: SOURCE_ID,
        code: 'ORDER_DOMAIN',
        name: '订单域',
        description: null,
        enabled: true,
        version: 1,
      }])
    transaction.fundBusinessSourcePostingType.findMany.mockResolvedValue([{
      postingTypeId: TYPE_ID,
    }])
    transaction.fundPostingType.findMany.mockResolvedValue([{ id: TYPE_ID }])
    transaction.fundBusinessSource.findUnique.mockResolvedValue(sourceRow())

    const result = await service.updateBusinessSource(CONTEXT, {
      businessSourceId: SOURCE_ID,
      name: '订单域',
      description: null,
      allowedPostingTypeIds: [TYPE_ID],
      expectedVersion: 1,
    })

    expect(result).toMatchObject({ changed: false })
    expect(transaction.fundBusinessSource.updateMany).not.toHaveBeenCalled()
    expect(transaction.fundBusinessSourcePostingType.createMany)
      .not.toHaveBeenCalled()
    expect(transaction.fundBusinessSourcePostingType.deleteMany)
      .not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('rejects enabling a source without an allowed type', async () => {
    const { audit, service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: SOURCE_ID,
        code: 'EMPTY_SOURCE',
        name: '空来源',
        description: null,
        enabled: false,
        version: 2,
      }])
    transaction.fundBusinessSourcePostingType.count.mockResolvedValue(0)

    await expectFundReject(
      service.setBusinessSourceEnabled(CONTEXT, {
        businessSourceId: SOURCE_ID,
        enabled: true,
        expectedVersion: 2,
      }),
      'FUND_VALIDATION_FAILED',
      'allowedPostingTypeIds',
    )
    expect(transaction.fundBusinessSource.updateMany).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('maps a used source-type relation removal to a safe state conflict', async () => {
    const { service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: SOURCE_ID,
        code: 'ORDER_DOMAIN',
        name: '订单域',
        description: null,
        enabled: false,
        version: 1,
      }])
    transaction.fundBusinessSourcePostingType.findMany.mockResolvedValue([
      { postingTypeId: TYPE_ID },
      { postingTypeId: SECOND_TYPE_ID },
    ])
    transaction.fundPostingType.findMany.mockResolvedValue([{ id: TYPE_ID }])
    transaction.fundBusinessSourcePostingType.deleteMany.mockRejectedValue({
      code: 'P2003',
      meta: { constraint: 'fund_posting_batches_allowed_source_type_fkey' },
    })

    await expectFundReject(
      service.updateBusinessSource(CONTEXT, {
        businessSourceId: SOURCE_ID,
        name: '订单域',
        description: null,
        allowedPostingTypeIds: [TYPE_ID],
        expectedVersion: 1,
      }),
      'FUND_CONFIG_STATE_CHANGED',
    )
  })

  it('atomically adds and removes allowed types with a version increment', async () => {
    const { audit, service, transaction } = fixture()
    transaction.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: SOURCE_ID,
        code: 'ORDER_DOMAIN',
        name: '订单域',
        description: null,
        enabled: true,
        version: 1,
      }])
    transaction.fundPostingType.findMany.mockResolvedValue([
      { id: SECOND_TYPE_ID },
    ])
    transaction.fundBusinessSourcePostingType.findMany.mockResolvedValue([
      { postingTypeId: TYPE_ID },
    ])
    transaction.fundBusinessSourcePostingType.deleteMany
      .mockResolvedValue({ count: 1 })
    transaction.fundBusinessSourcePostingType.createMany
      .mockResolvedValue({ count: 1 })
    transaction.fundBusinessSource.updateMany.mockResolvedValue({ count: 1 })
    transaction.fundBusinessSource.findUnique.mockResolvedValue(sourceRow({
      version: 2,
      allowedTypeIds: [SECOND_TYPE_ID],
    }))

    const result = await service.updateBusinessSource(CONTEXT, {
      businessSourceId: SOURCE_ID,
      name: '订单业务域',
      description: '订单模块调用方',
      allowedPostingTypeIds: [SECOND_TYPE_ID],
      expectedVersion: 1,
    })

    expect(result).toMatchObject({
      changed: true,
      businessSource: {
        version: 2,
        allowedPostingTypes: [{ id: SECOND_TYPE_ID }],
      },
    })
    expect(transaction.fundBusinessSourcePostingType.deleteMany)
      .toHaveBeenCalledWith({
        where: {
          businessSourceId: SOURCE_ID,
          postingTypeId: { in: [TYPE_ID] },
        },
      })
    expect(transaction.fundBusinessSourcePostingType.createMany)
      .toHaveBeenCalledWith({
        data: [{
          businessSourceId: SOURCE_ID,
          postingTypeId: SECOND_TYPE_ID,
        }],
      })
    expect(transaction.fundBusinessSource.updateMany).toHaveBeenCalledWith({
      where: { id: SOURCE_ID, version: 1 },
      data: {
        name: '订单业务域',
        description: '订单模块调用方',
        version: { increment: 1 },
      },
    })
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'FUND_BUSINESS_SOURCE_UPDATED',
        metadata: {
          addedPostingTypeIdsCsv: SECOND_TYPE_ID,
          code: 'ORDER_DOMAIN',
          removedPostingTypeIdsCsv: TYPE_ID,
        },
      }),
    )
  })
})
