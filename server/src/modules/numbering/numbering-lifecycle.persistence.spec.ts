import type { Prisma } from '../../generated/prisma/client'
import {
  NumberingRuleStatus,
  NumberingRuleVersionStatus,
} from '../../generated/prisma/enums'
import {
  readNumberingLifetimeUsedCount,
  transitionNumberingRuleVersionStatus,
  updateNumberingRuleRecord,
} from './numbering-command.persistence'

const RULE_ID = '20000000-0000-4000-8000-000000000001'
const ACTIVE_ID = '30000000-0000-4000-8000-000000000001'
const DRAFT_ID = '30000000-0000-4000-8000-000000000002'
const AS_OF = new Date('2026-08-02T04:00:00.000Z')

interface SqlShape {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

function requireSql(value: unknown): SqlShape {
  if (
    typeof value !== 'object'
    || value === null
    || !('strings' in value)
    || !Array.isArray(value.strings)
    || !('values' in value)
    || !Array.isArray(value.values)
  ) {
    throw new Error('Expected Prisma SQL object')
  }

  return value as unknown as SqlShape
}

function createFixture() {
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>()
    .mockResolvedValue([])
  const versionUpdateMany = jest.fn<
    Promise<{ count: number }>,
    [unknown]
  >().mockResolvedValue({ count: 1 })
  const ruleUpdate = jest.fn<Promise<unknown>, [unknown]>()
    .mockResolvedValue({ id: RULE_ID })

  return {
    queryRaw,
    ruleUpdate,
    transaction: {
      $queryRaw: queryRaw,
      numberingRule: { update: ruleUpdate },
      numberingRuleVersion: { updateMany: versionUpdateMany },
    } as unknown as Prisma.TransactionClient,
    versionUpdateMany,
  }
}

describe('numbering lifecycle persistence', () => {
  it('reads exact lifetime SUM as decimal text with a parameterized rule id', async () => {
    const fixture = createFixture()
    fixture.queryRaw.mockResolvedValueOnce([{
      lifetimeUsedCount: '900719925474099300000000000000000001',
    }])

    await expect(readNumberingLifetimeUsedCount(
      fixture.transaction,
      RULE_ID,
    )).resolves.toBe('900719925474099300000000000000000001')

    const sql = requireSql(fixture.queryRaw.mock.calls[0]?.[0])
    expect(sql.strings.join('')).toContain('SUM("used_count")')
    expect(sql.strings.join('')).toContain('::text')
    expect(sql.strings.join('')).not.toContain(RULE_ID)
    expect(sql.values).toEqual([RULE_ID])
  })

  it('parameterizes ACTIVE retirement and DRAFT activation transitions', async () => {
    const fixture = createFixture()

    await expect(transitionNumberingRuleVersionStatus(
      fixture.transaction,
      {
        versionId: ACTIVE_ID,
        fromStatus: NumberingRuleVersionStatus.ACTIVE,
        toStatus: NumberingRuleVersionStatus.RETIRED,
      },
    )).resolves.toBe(true)
    await expect(transitionNumberingRuleVersionStatus(
      fixture.transaction,
      {
        versionId: DRAFT_ID,
        fromStatus: NumberingRuleVersionStatus.DRAFT,
        toStatus: NumberingRuleVersionStatus.ACTIVE,
        publishedAt: AS_OF,
      },
    )).resolves.toBe(true)

    expect(fixture.versionUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: ACTIVE_ID,
        status: NumberingRuleVersionStatus.ACTIVE,
      },
      data: { status: NumberingRuleVersionStatus.RETIRED },
    })
    expect(fixture.versionUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: DRAFT_ID,
        status: NumberingRuleVersionStatus.DRAFT,
      },
      data: {
        status: NumberingRuleVersionStatus.ACTIVE,
        publishedAt: AS_OF,
      },
    })
  })

  it('returns false instead of hiding a stale version transition', async () => {
    const fixture = createFixture()
    fixture.versionUpdateMany.mockResolvedValueOnce({ count: 0 })

    await expect(transitionNumberingRuleVersionStatus(
      fixture.transaction,
      {
        versionId: DRAFT_ID,
        fromStatus: NumberingRuleVersionStatus.DRAFT,
        toStatus: NumberingRuleVersionStatus.ACTIVE,
        publishedAt: AS_OF,
      },
    )).resolves.toBe(false)
  })

  it('updates lifecycle status and increments optimistic version once', async () => {
    const fixture = createFixture()

    await updateNumberingRuleRecord(fixture.transaction, RULE_ID, {
      status: NumberingRuleStatus.ENABLED,
    })

    expect(fixture.ruleUpdate).toHaveBeenCalledWith({
      where: { id: RULE_ID },
      data: {
        status: NumberingRuleStatus.ENABLED,
        version: { increment: 1 },
      },
      select: { id: true },
    })
  })
})
