import { buildInvoiceRequestListWhere, resolveIssuedSettleCutoff } from './invoice-request-list-filter'

describe('invoice request list filter', () => {
  const now = new Date('2026-11-23T00:00:00.000Z')
  const cutoff = new Date('2026-11-18T00:00:00.000Z')

  it('resolves the settle cutoff as exactly 120 hours before now', () => {
    expect(resolveIssuedSettleCutoff(now).toISOString()).toBe(cutoff.toISOString())
  })

  it('forces ISSUED and splits waiting/settleable by upload time', () => {
    // 二级视图与第一层状态互斥时以二级为准：选了可结算就不该再被 SETTLED 之类的状态约束。
    expect(buildInvoiceRequestListWhere({ status: 'SETTLED', issuedView: 'SETTLEABLE' }, { now })).toMatchObject({
      status: 'ISSUED',
      documentUploadedAt: { lte: cutoff },
    })
    expect(buildInvoiceRequestListWhere({ status: 'ALL', issuedView: 'WAITING' }, { now })).toMatchObject({
      status: 'ISSUED',
      documentUploadedAt: { gt: cutoff },
    })
  })

  it('keeps keyword and owner conditions in both views', () => {
    const where = buildInvoiceRequestListWhere({
      keyword: ' INV-1 ',
      issuedView: 'SETTLEABLE',
      ownerId: 'user-1',
    }, { now })
    expect(where.createdById).toBe('user-1')
    expect(where.status).toBe('ISSUED')
    expect(where.OR).toBeDefined()
  })

  it('ignores the issued view when building the count baseline', () => {
    // 计数基准忽略状态维度；二级视图也必须一起忽略，否则两个子计数无法共用分母。
    const where = buildInvoiceRequestListWhere({ issuedView: 'SETTLEABLE' }, { now, omitStatus: true })
    expect(where.status).toBeUndefined()
    expect(where.documentUploadedAt).toBeUndefined()
  })

  it('keeps the plain status filter when no issued view is provided', () => {
    expect(buildInvoiceRequestListWhere({ status: 'SETTLED' }, { now })).toMatchObject({ status: 'SETTLED' })
    expect(buildInvoiceRequestListWhere({ status: 'ALL' }, { now }).status).toBeUndefined()
  })
})
