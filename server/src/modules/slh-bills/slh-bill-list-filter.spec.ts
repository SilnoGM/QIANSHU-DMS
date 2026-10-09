import { Prisma } from '../../generated/prisma/client'
import { buildSlhBillListWhere, withSlhBillIncompleteReconciliation, withSlhBillReconciliationStatus, withSlhBillState } from './slh-bill-list-filter'

describe('SLH bill list filter', () => {
  it('defaults to active bills and keeps blank input unfiltered', () => {
    // 状态缺省与 active 同义；空白关键字不产生筛选条件。
    expect(buildSlhBillListWhere({})).toEqual({ supersededById: null })
    expect(buildSlhBillListWhere({ state: 'active' })).toEqual({ supersededById: null })
    expect(buildSlhBillListWhere({ keyword: '   ', state: 'all' })).toEqual({})
    expect(buildSlhBillListWhere({ state: 'superseded' })).toEqual({ supersededById: { not: null } })
  })

  it('keeps every bill that still has an unreconciled line', () => {
    // 候选账单用：未对账与部分对账是同一个谓词（至少一行没有对账时刻）。
    expect(withSlhBillIncompleteReconciliation({ supersededById: null })).toEqual({
      supersededById: null,
      AND: [{ lines: { some: { reconciledAt: null } } }],
    })
    expect(withSlhBillIncompleteReconciliation({ AND: [{ supersededById: null }] })).toEqual({
      AND: [{ supersededById: null }, { lines: { some: { reconciledAt: null } } }],
    })
  })

  it('trims the keyword and matches bill number, file name and container batches', () => {
    expect(buildSlhBillListWhere({ keyword: ' CBILL ', state: 'all' })).toEqual({
      OR: [
        { slhBillNo: { contains: 'CBILL', mode: 'insensitive' } },
        { sourceFileName: { contains: 'CBILL', mode: 'insensitive' } },
        { containerBatchNames: { contains: 'CBILL', mode: 'insensitive' } },
      ],
    })
  })

  it('maps the reconciliation status to existence checks on reconciled lines', () => {
    expect(buildSlhBillListWhere({ reconciliationStatus: 'PENDING' })).toEqual({
      supersededById: null,
      AND: [{ lines: { none: { reconciledAt: { not: null } } } }],
    })
    expect(buildSlhBillListWhere({ reconciliationStatus: 'COMPLETED' })).toEqual({
      supersededById: null,
      AND: [{ lines: { none: { reconciledAt: null } } }],
    })
    // 部分对账要同时命中"有已对账行"与"有未对账行"，两个条件都必须保留。
    expect(buildSlhBillListWhere({ reconciliationStatus: 'PARTIAL' })).toEqual({
      supersededById: null,
      AND: [
        { lines: { some: { reconciledAt: { not: null } } } },
        { lines: { some: { reconciledAt: null } } },
      ],
    })
    // all 与缺省一样：不加对账条件。
    expect(buildSlhBillListWhere({ reconciliationStatus: 'all' })).toEqual({ supersededById: null })
  })

  it('keeps both amount bounds in one predicate', () => {
    // 回归：上下界曾经分别写成两个 payableTotalAmountCny 键，后者把前者覆盖掉，下界静默失效。
    const where = buildSlhBillListWhere({ payableMin: '10.00', payableMax: '20.00', state: 'all' })
    expect(where.AND).toEqual([{ payableTotalAmountCny: { gte: new Prisma.Decimal('10.00'), lte: new Prisma.Decimal('20.00') } }])
    expect(buildSlhBillListWhere({ payableMin: '10.00', state: 'all' })).toEqual({ AND: [{ payableTotalAmountCny: { gte: new Prisma.Decimal('10.00') } }] })
  })

  it('combines the amount range with the reconciliation condition in one AND list', () => {
    const where = buildSlhBillListWhere({ payableMin: '10.00', payableMax: '20.00', reconciliationStatus: 'PARTIAL', state: 'all' })
    const and = where.AND as Prisma.SlhBillWhereInput[]
    expect(and).toHaveLength(3)
    expect(and[0]).toEqual({ payableTotalAmountCny: { gte: new Prisma.Decimal('10.00'), lte: new Prisma.Decimal('20.00') } })
    expect(and.slice(1)).toEqual([
      { lines: { some: { reconciledAt: { not: null } } } },
      { lines: { some: { reconciledAt: null } } },
    ])
  })

  it('omits one dimension for counting while keeping the other', () => {
    // 计数基准条件：忽略自己那一维，但另一块工具栏的选择仍然生效。
    const forStateCounts = buildSlhBillListWhere({ reconciliationStatus: 'PENDING', state: 'superseded' }, { omitState: true })
    expect(forStateCounts.supersededById).toBeUndefined()
    expect(forStateCounts.AND).toEqual([{ lines: { none: { reconciledAt: { not: null } } } }])

    const forReconciliationCounts = buildSlhBillListWhere({ reconciliationStatus: 'PENDING', state: 'superseded' }, { omitReconciliationStatus: true })
    expect(forReconciliationCounts).toEqual({ supersededById: { not: null } })
  })

  it('appends a single dimension value onto a base predicate', () => {
    const base = buildSlhBillListWhere({ keyword: 'CBILL' }, { omitState: true, omitReconciliationStatus: true })
    expect(withSlhBillState(base, 'active')).toEqual({ ...base, supersededById: null })
    expect(withSlhBillState(base, 'superseded')).toEqual({ ...base, supersededById: { not: null } })
    // all 不改动基准谓词。
    expect(withSlhBillState(base, 'all')).toEqual(base)
    expect(withSlhBillReconciliationStatus(base, 'COMPLETED')).toEqual({
      ...base,
      AND: [{ lines: { none: { reconciledAt: null } } }],
    })
    expect(withSlhBillReconciliationStatus(base, 'all')).toEqual(base)
  })
})
