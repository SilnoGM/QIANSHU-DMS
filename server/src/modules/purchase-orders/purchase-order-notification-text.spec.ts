import type { PurchaseOrderDetail } from './purchase-order-query.service'
import { buildPurchaseOrderNotificationBlocks } from './purchase-order-notification-text'

// 期望字符串与前端 purchase-order-copy.test.ts 保持逐字一致，防止三个出口口径漂移。
// fixture 使用可变类型，用例里直接改写字段；调用处统一按详情类型断言。
interface DetailFixture {
  id: string
  orderNo: string
  remark: string | null
  lines: {
    id: string
    lineNumber: number
    productName: string
    description: string | null
    actualPurchaseUnitPriceAmount: string
    quantity: number
    lineTotalAmount: string
  }[]
  parts: {
    partNumber: number
    status: string
    shippingMarkText: string | null
    shippingMarkSuffix: string
    items: { purchaseOrderLineId: string, lineNumber: number, quantity: number }[]
  }[]
}

function fixture(): DetailFixture {
  return {
    id: 'order-id',
    orderNo: 'PO/20260916-00016',
    remark: '请按货件分别包装并附采购单。',
    lines: [
      { id: 'b', lineNumber: 2, productName: '椅子', description: null, actualPurchaseUnitPriceAmount: '30.00', quantity: 2, lineTotalAmount: '60.00' },
      { id: 'a', lineNumber: 1, productName: '木桌', description: '请附带说明书', actualPurchaseUnitPriceAmount: '100.00', quantity: 1, lineTotalAmount: '100.00' },
    ],
    parts: [
      { partNumber: 2, status: 'PENDING_REVIEW', shippingMarkText: 'TEST/00016/货件-02', shippingMarkSuffix: '椅子（李华-赖文寿）', items: [{ purchaseOrderLineId: 'b', lineNumber: 2, quantity: 1 }] },
      { partNumber: 1, status: 'PENDING_REVIEW', shippingMarkText: 'TEST/00016/货件-01', shippingMarkSuffix: '木桌+椅子（李华-赖文寿）', items: [{ purchaseOrderLineId: 'b', lineNumber: 2, quantity: 1 }, { purchaseOrderLineId: 'a', lineNumber: 1, quantity: 1 }] },
    ],
  }
}

function build(detail: DetailFixture | Record<string, unknown>) {
  return buildPurchaseOrderNotificationBlocks(detail as unknown as PurchaseOrderDetail)
}

describe('buildPurchaseOrderNotificationBlocks', () => {
  it('按采购行与货件顺序输出多行变量，行备注只在有值时出现', () => {
    expect(build(fixture())).toEqual({
      productLines: `产品名：木桌*1
金额小计：100.00*1=100.00
备注：请附带说明书

产品名：椅子*2
金额小计：30.00*2=60.00`,
      partMarks: `货件-01：木桌+椅子
唛头：【TEST/00016/货件-01】木桌+椅子（李华-赖文寿）

货件-02：椅子
唛头：【TEST/00016/货件-02】椅子（李华-赖文寿）`,
      orderRemark: `

采购备注：请将上述货件唛头贴到对应的包装箱 / 货物上；请按货件分别包装并附采购单。`,
    })
  })

  it('多行备注用全角分号压平，空备注不生成备注行', () => {
    const detail = fixture()
    detail.remark = '请按货件分别包装\n并附采购单'
    detail.lines[1].description = '  请附带\n说明书  '
    const blocks = build(detail)
    expect(blocks.productLines).toContain('金额小计：100.00*1=100.00\n备注：请附带；说明书')
    expect(blocks.productLines).not.toContain('备注：-')
    expect(blocks.orderRemark).toContain('请将上述货件唛头贴到对应的包装箱 / 货物上；请按货件分别包装；并附采购单')
  })

  it('已取消货件不出现，未派发唛头标注为待派发，STOCK 后缀原样保留', () => {
    const detail = fixture()
    detail.parts[0].status = 'CANCELLED'
    detail.parts[1].shippingMarkText = null
    detail.parts[1].shippingMarkSuffix = ''
    expect(build(detail).partMarks).toBe(`货件-01：木桌+椅子
唛头：待派发`)

    const stock = fixture()
    stock.parts[0].shippingMarkSuffix = '（公司囤货采购）'
    stock.parts[1].shippingMarkSuffix = '（公司囤货采购）'
    expect(build(stock).partMarks).toContain('唛头：【TEST/00016/货件-01】（公司囤货采购）')
  })

  it('详情缺字段时降级为空串或占位，不抛错', () => {
    const blocks = build({ id: 'order-id' })
    expect(blocks.productLines).toBe('')
    expect(blocks.partMarks).toBe('')
    expect(blocks.orderRemark).toBe('\n\n采购备注：请将上述货件唛头贴到对应的包装箱 / 货物上')
  })
})
