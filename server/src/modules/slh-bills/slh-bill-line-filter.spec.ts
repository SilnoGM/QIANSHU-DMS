import { buildSlhBillLineWhere } from './slh-bill-line-filter'

// 明细筛选只影响查询条件，不参与复算，所以用纯函数把条件拼装与 Prisma 调用解耦后单测。
describe('slh bill line filter', () => {
  const billId = '0f7c5a52-1a1a-4b1a-9d5e-6f4f4f1c2b3a'

  it('keeps only the bill scope when no filter is provided', () => {
    expect(buildSlhBillLineWhere(billId)).toEqual({ billId })
    // 空白关键字与空柜号都不应该进入 where，否则会搜出一个空结果页。
    expect(buildSlhBillLineWhere(billId, { containerBatchName: '  ', keyword: '   ' })).toEqual({ billId })
    expect(buildSlhBillLineWhere(billId, { containerBatchName: '', keyword: '' })).toEqual({ billId })
  })

  it('matches the keyword against the four searchable line fields, case-insensitively', () => {
    expect(buildSlhBillLineWhere(billId, { keyword: ' 1211 ' })).toEqual({
      billId,
      OR: [
        { warehouseReceiptReference: { contains: '1211', mode: 'insensitive' } },
        { shippingMarkText: { contains: '1211', mode: 'insensitive' } },
        { goodsName: { contains: '1211', mode: 'insensitive' } },
        { recipientInfoRaw: { contains: '1211', mode: 'insensitive' } },
      ],
    })
  })

  it('filters by the container batch name text exactly as printed on the bill', () => {
    expect(buildSlhBillLineWhere(billId, { containerBatchName: '1211-01柜' })).toEqual({
      billId,
      containerBatchNameText: '1211-01柜',
    })
  })

  it('combines the container filter and the keyword when both are present', () => {
    const where = buildSlhBillLineWhere(billId, { containerBatchName: '0102-01柜', keyword: '微耕机' })
    expect(where.containerBatchNameText).toBe('0102-01柜')
    expect(where.OR).toHaveLength(4)
    expect(where.billId).toBe(billId)
  })
})
