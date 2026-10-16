import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数。
import test from 'node:test'
import { calculateEstimatedCostCny } from '../../src/views/workbenches/invoices/invoice-cost.logic'

test('预估成本与后端同序：先除汇率、再乘费率、最后加邮寄费并向上取整', () => {
  // 需求示例：283500 ÷ 5.2 × 0.06 + 30 = 3301.153… → 向上取整 3302。
  assert.equal(calculateEstimatedCostCny(283500, 5.2), 3302)
  // 恰好为整数时不上取：2600 ÷ 5.2 = 500，500 × 0.06 + 30 = 60。
  assert.equal(calculateEstimatedCostCny(2600, 5.2), 60)
  // 半数时向上收：283500 ÷ 4.32 = 65625，× 0.06 = 3937.5，+ 30 = 3967.5 → 3968。
  assert.equal(calculateEstimatedCostCny(283500, 4.32), 3968)
})

test('预估成本在输入非法时返回 null（不展示按错误输入算出的数字）', () => {
  assert.equal(calculateEstimatedCostCny(283500, 0), null)
  assert.equal(calculateEstimatedCostCny(283500, -5), null)
  assert.equal(calculateEstimatedCostCny(283500, Number.NaN), null)
  assert.equal(calculateEstimatedCostCny(Number.NaN, 5.2), null)
  assert.equal(calculateEstimatedCostCny(-1, 5.2), null)
  // 总计为 0 时只有固定邮寄费：公式照常生效。
  assert.equal(calculateEstimatedCostCny(0, 5.2), 30)
})
