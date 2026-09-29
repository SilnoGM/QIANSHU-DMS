import { matchSlhBillLines, parseContainerCycle, parseShippingMarkCycle, type SlhBillContainerBatchInput } from './slh-bill-line-matching'

/** 柜次行样本：默认满足合格三条件（有货件、有采购来源、有销售来源）。 */
function item(id: string, mark: string | null, override: Partial<SlhBillContainerBatchInput['items'][number]> = {}) {
  return {
    id,
    oceanShippingMarkText: mark,
    shipment: { purchaseOrderId: 'po-1', salesOrderId: 'so-1' },
    ...override,
  }
}

function container(id: string, loadingDate: string, sequenceInDay: number, items: SlhBillContainerBatchInput['items']) {
  return { id, loadingDate, sequenceInDay, items }
}

describe('柜号与唛头的月日解析', () => {
  it('柜号支持 柜 / 櫃 / 子 与全角数字', () => {
    expect(parseContainerCycle('1211-01柜')).toEqual({ month: 12, day: 11, sequenceInDay: 1 })
    expect(parseContainerCycle('0116柜')).toEqual({ month: 1, day: 16, sequenceInDay: 1 })
    expect(parseContainerCycle('0116櫃子')).toEqual({ month: 1, day: 16, sequenceInDay: 1 })
    expect(parseContainerCycle('０１１６柜')).toEqual({ month: 1, day: 16, sequenceInDay: 1 })
    expect(parseContainerCycle('柜号：0116-02柜')).toEqual({ month: 1, day: 16, sequenceInDay: 2 })
  })

  it('柜号里的 5 位数字与非法月日一律判为无法解析', () => {
    // 46002 是装柜日期的 Excel 序列号误落在柜号列，不能被当成 4600/2。
    expect(parseContainerCycle('46002')).toBeNull()
    expect(parseContainerCycle('1301柜')).toBeNull()
    expect(parseContainerCycle('0232柜')).toBeNull()
    expect(parseContainerCycle('')).toBeNull()
    expect(parseContainerCycle(null)).toBeNull()
  })

  it('唛头取连字符后的四位数字作为月日，且不携带柜次序号', () => {
    expect(parseShippingMarkCycle('J-121125')).toEqual({ month: 12, day: 11 })
    expect(parseShippingMarkCycle('L-010229')).toEqual({ month: 1, day: 2 })
    expect(parseShippingMarkCycle('J-022634')).toEqual({ month: 2, day: 26 })
    expect(parseShippingMarkCycle('J-0226')).toEqual({ month: 2, day: 26 })
  })

  it('没有连字符或月日非法时不做推断', () => {
    expect(parseShippingMarkCycle('J121125')).toBeNull()
    expect(parseShippingMarkCycle('J-139925')).toBeNull()
    expect(parseShippingMarkCycle('')).toBeNull()
    expect(parseShippingMarkCycle(null)).toBeNull()
  })
})

describe('账单明细行与柜次行的匹配', () => {
  const containers: SlhBillContainerBatchInput[] = [
    container('cb-1211', '2025-12-11', 1, [item('li-1', 'J-121125')]),
    container('cb-0102', '2026-01-02', 1, [item('li-2', 'L-010229')]),
    container('cb-0116', '2026-01-16', 1, [item('li-3', 'L-011652')]),
  ]

  it('按柜号名称路径命中柜次行', () => {
    const [result] = matchSlhBillLines({
      lines: [{ lineId: 'line-1', loadingDate: '2025-12-11', containerBatchText: '1211-01柜', shippingMarkText: 'J-121125' }],
      containers,
    })
    expect(result).toEqual({ lineId: 'line-1', status: 'MATCHED', source: 'NAME', loadingItemId: 'li-1', reason: null })
  })

  it('年份逐行取该行装柜日期：同一张账单跨年也各自命中当年柜次', () => {
    // 同名柜次在跨年时合法共存（柜次名称不含年份），只能靠明细行装柜日期定年。
    const crossYear = [
      container('cb-1211-2025', '2025-12-11', 1, [item('li-a', 'J-121125')]),
      container('cb-1211-2026', '2026-12-11', 1, [item('li-b', 'J-121126')]),
    ]
    const results = matchSlhBillLines({
      lines: [
        { lineId: 'line-2025', loadingDate: '2025-12-11', containerBatchText: '1211-01柜', shippingMarkText: 'J-121125' },
        { lineId: 'line-2026', loadingDate: '2026-12-11', containerBatchText: '1211-01柜', shippingMarkText: 'J-121126' },
      ],
      containers: crossYear,
    })
    expect(results.map(result => result.loadingItemId)).toEqual(['li-a', 'li-b'])
  })

  it('唛头尾两位不参与柜次序号：J-121125 命中 1211-01柜', () => {
    const [result] = matchSlhBillLines({
      lines: [{ lineId: 'line-1', loadingDate: '2025-12-11', containerBatchText: '1211柜', shippingMarkText: 'J-121125' }],
      containers,
    })
    expect(result.loadingItemId).toBe('li-1')
  })

  it('柜号定位不到时用唛头里的月日辅助推断，并标记来源', () => {
    const [result] = matchSlhBillLines({
      lines: [{ lineId: 'line-1', loadingDate: '2026-02-27', containerBatchText: '9999柜', shippingMarkText: 'J-022634' }],
      containers: [...containers, container('cb-0226', '2026-02-26', 1, [item('li-0226', 'J-022634')])],
    })
    expect(result).toEqual({ lineId: 'line-1', status: 'MATCHED', source: 'MARK', loadingItemId: 'li-0226', reason: null })
  })

  it('名称路径按明细行年份定位，缺柜次又缺可推断唛头时给出分层原因', () => {
    const [notFound] = matchSlhBillLines({
      lines: [{ lineId: 'line-1', loadingDate: '2026-01-02', containerBatchText: '1211-01柜', shippingMarkText: null }],
      containers,
    })
    expect(notFound.status).toBe('UNMATCHED')
    expect(notFound.reason).toBe('CONTAINER_NOT_FOUND')

    const [missing] = matchSlhBillLines({
      lines: [{ lineId: 'line-2', loadingDate: '2026-01-02', containerBatchText: null, shippingMarkText: null }],
      containers,
    })
    expect(missing.reason).toBe('MISSING_CONTAINER_REFERENCE')

    const [invalid] = matchSlhBillLines({
      lines: [{ lineId: 'line-3', loadingDate: '2026-01-02', containerBatchText: '46002', shippingMarkText: '无编号' }],
      containers,
    })
    expect(invalid.reason).toBe('INVALID_CONTAINER_NAME')
  })

  it('账单行缺唛头时不能核对', () => {
    const [result] = matchSlhBillLines({
      lines: [{ lineId: 'line-1', loadingDate: '2026-01-02', containerBatchText: '0102-01柜', shippingMarkText: null }],
      containers,
    })
    expect(result.reason).toBe('MISSING_SHIPPING_MARK')
  })

  it('柜次内没有同唛头行时给出原因', () => {
    const [result] = matchSlhBillLines({
      lines: [{ lineId: 'line-1', loadingDate: '2026-01-02', containerBatchText: '0102-01柜', shippingMarkText: 'L-999999' }],
      containers,
    })
    expect(result.reason).toBe('MARK_NOT_FOUND_IN_CONTAINER')
  })

  it('同日同序号命中多个柜次（跨仓）时判为歧义，不猜测', () => {
    const [result] = matchSlhBillLines({
      lines: [{ lineId: 'line-1', loadingDate: '2026-01-02', containerBatchText: '0102-01柜', shippingMarkText: 'L-010229' }],
      containers: [
        container('cb-a', '2026-01-02', 1, [item('li-a', 'L-010229')]),
        container('cb-b', '2026-01-02', 1, [item('li-b', 'L-010229')]),
      ],
    })
    expect(result.reason).toBe('CONTAINER_AMBIGUOUS')
  })

  it('柜次内同唛头行重复时判为歧义', () => {
    const [result] = matchSlhBillLines({
      lines: [{ lineId: 'line-1', loadingDate: '2026-01-02', containerBatchText: '0102-01柜', shippingMarkText: 'L-010229' }],
      containers: [container('cb-a', '2026-01-02', 1, [item('li-a', 'L-010229'), item('li-b', ' l-010229 ')])],
    })
    expect(result.reason).toBe('LOADING_ITEM_AMBIGUOUS')
  })

  it('合格三条件逐项校验', () => {
    const mark = 'L-010229'
    const cases = [
      { items: [item('li-x', mark, { shipment: null })], reason: 'SHIPMENT_NOT_MATCHED' },
      { items: [item('li-x', mark, { shipment: { purchaseOrderId: null, salesOrderId: 'so-1' } })], reason: 'PURCHASE_SOURCE_MISSING' },
      { items: [item('li-x', mark, { shipment: { purchaseOrderId: 'po-1', salesOrderId: null } })], reason: 'SALES_SOURCE_MISSING' },
    ] as const
    for (const testCase of cases) {
      const [result] = matchSlhBillLines({
        lines: [{ lineId: 'line-1', loadingDate: '2026-01-02', containerBatchText: '0102-01柜', shippingMarkText: mark }],
        containers: [container('cb-a', '2026-01-02', 1, [...testCase.items])],
      })
      expect(result.reason).toBe(testCase.reason)
    }
  })

  it('唛头比较忽略大小写与空白差异', () => {
    const [result] = matchSlhBillLines({
      lines: [{ lineId: 'line-1', loadingDate: '2026-01-02', containerBatchText: '0102-01柜', shippingMarkText: 'l-010229' }],
      containers: [container('cb-a', '2026-01-02', 1, [item('li-a', ' L-010229 ')])],
    })
    expect(result.status).toBe('MATCHED')
    expect(result.loadingItemId).toBe('li-a')
  })
})
