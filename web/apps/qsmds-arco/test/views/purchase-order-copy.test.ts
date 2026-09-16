import type { PurchaseOrderDetailDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 复制文本必须精确使用采购金额及当前货件分配，不能串行或丢精度。
import test from 'node:test'
import { createI18n } from 'vue-i18n'
import messages from '../../src/locales/lang/purchase-review/zh-cn.json'
import { buildPurchaseOrderCopyText } from '../../src/views/operations/purchase-orders/purchase-order-copy.logic'

const i18n = createI18n({ legacy: false, locale: 'zh-cn', messages: { 'zh-cn': messages } })
const t = (key: string, values: Record<string, string | number> = {}) => i18n.global.t(key, values)
function fixture(): PurchaseOrderDetailDto {
  return {
    orderNo: 'PO/20260916-00016',
    orderDate: '2026-09-16',
    supplier: { label: '示例供应商' },
    amounts: { purchaseTotalAmount: '160.0000', depositDueAmount: '30.0000', balanceDueAmount: '130.0000', paidAmount: '100.0000', outstandingAmount: '60.0000' },
    lines: [
      { id: 'b', lineNumber: 2, productName: '椅子', actualPurchaseUnitPriceAmount: '30.0000', referencePurchaseUnitPriceAmount: '99', quantity: 2, lineTotalAmount: '60.0000' },
      { id: 'a', lineNumber: 1, productName: '木桌', actualPurchaseUnitPriceAmount: '100.0000', referencePurchaseUnitPriceAmount: '999', quantity: 1, lineTotalAmount: '100.0000' },
    ],
    parts: [
      { partNumber: 2, status: 'PENDING_REVIEW', shipmentNo: 'PKG/20260916-00002', shippingMarkText: 'TEST/00016/货件-02', items: [{ purchaseOrderLineId: 'b', lineNumber: 2, quantity: 1 }] },
      { partNumber: 1, status: 'PENDING_REVIEW', shipmentNo: 'PKG/20260916-00001', shippingMarkText: 'TEST/00016/货件-01', items: [{ purchaseOrderLineId: 'b', lineNumber: 2, quantity: 1 }, { purchaseOrderLineId: 'a', lineNumber: 1, quantity: 1 }] },
    ],
  } as PurchaseOrderDetailDto
}

test('完整复制模板按采购行和货件顺序输出，以真实行 ID 关联本件产品，使用约定订金尾款', () => {
  const detail = fixture()
  const before = JSON.stringify(detail)
  assert.equal(buildPurchaseOrderCopyText(detail, t), `【PO/20260916-00016】
供应商：示例供应商
采购日期：2026-09-16

[ 采购产品明细]
产品名：木桌*1
金额小计：100.00*1=100.00

产品名：椅子*2
金额小计：30.00*2=60.00

总价：160.00
订金：30.00
尾款：130.00

出货请贴货物唛头：
货件-01：木桌+椅子
此货件唛头：TEST/00016/货件-01

货件-02：椅子
此货件唛头：TEST/00016/货件-02`)
  assert.equal(JSON.stringify(detail), before)
})

test('大额与四位单价保留精度，零约定金额不作为缺失', () => {
  const detail = fixture()
  detail.lines[0]!.actualPurchaseUnitPriceAmount = '9007199254740993.1234'
  detail.lines[0]!.lineTotalAmount = '18014398509481986.2468'
  detail.amounts.depositDueAmount = '0.0000'
  const text = buildPurchaseOrderCopyText(detail, t)
  assert.ok(text.includes('金额小计：9007199254740993.1234*2=18014398509481986.2468'))
  assert.ok(text.includes('订金：0.00'))
})

test('货件序号不依赖 PKG 编号，未派发唛头明确标注，已取消货件不出现在贴标清单', () => {
  const detail = fixture()
  detail.parts[0]!.status = 'CANCELLED'
  detail.parts[1]!.shipmentNo = null
  detail.parts[1]!.shippingMarkText = null
  const text = buildPurchaseOrderCopyText(detail, t)
  assert.ok(text.includes('货件-01：木桌+椅子\n此货件唛头：待派发'))
  assert.ok(!text.includes('货件-02'))
  assert.ok(!text.includes('PKG/'))
  detail.parts = []
  assert.ok(buildPurchaseOrderCopyText(detail, t).endsWith('出货请贴货物唛头：\n暂无预定义货件'))
})

test('复制字段内换行归一，缺失产品和金额保留明确占位', () => {
  const detail = fixture()
  detail.supplier.label = '  示例\n供应商 '
  detail.lines[0]!.actualPurchaseUnitPriceAmount = 'invalid'
  detail.parts[0]!.items[0]!.purchaseOrderLineId = 'missing'
  const text = buildPurchaseOrderCopyText(detail, t)
  assert.ok(text.includes('供应商：示例 供应商\n采购日期：'))
  assert.ok(text.includes('金额小计：未记录*2=60.00'))
  assert.ok(text.includes('货件-02：产品信息不可用'))
})
