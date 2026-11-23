import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数。
import test from 'node:test'
import { issuedSettleSwitchItems, resolveListIssuedView } from '../../src/views/workbenches/invoices/invoice-status.logic'

test('二级视图只在已开出邮寄时传给列表', () => {
  assert.equal(resolveListIssuedView('ISSUED', 'SETTLEABLE'), 'SETTLEABLE')
  assert.equal(resolveListIssuedView('ISSUED', 'WAITING'), 'WAITING')
  // 其他状态不传二级参数，避免服务端把它强制回 ISSUED 后出现意料之外的列表。
  assert.equal(resolveListIssuedView('ALL', 'SETTLEABLE'), undefined)
  assert.equal(resolveListIssuedView('SETTLED', 'WAITING'), undefined)
})

test('二级切换项固定为等待中与可结算', () => {
  assert.deepEqual(issuedSettleSwitchItems().map(item => [item.value, item.labelKey]), [
    ['WAITING', 'invoiceRequest.issuedView.WAITING'],
    ['SETTLEABLE', 'invoiceRequest.issuedView.SETTLEABLE'],
  ])
})
