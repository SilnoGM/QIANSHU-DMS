import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 状态边界使用 Node.js 测试，不依赖浏览器全局变量。
import test from 'node:test'
import { canApplyBindingResponse, classifyBindingSaveFailure, isBindableRule } from '../../src/views/system/basic-data/numbering/shipping-mark-binding.logic'

test('响应必须属于当前身份、代次和授权状态', () => {
  const input = { aborted: false, authorized: true, epoch: 1, currentEpoch: 1, version: 2, currentVersion: 2 }
  assert.equal(canApplyBindingResponse(input), true)
  assert.equal(canApplyBindingResponse({ ...input, aborted: true }), false)
  assert.equal(canApplyBindingResponse({ ...input, authorized: false }), false)
  assert.equal(canApplyBindingResponse({ ...input, currentEpoch: 3 }), false)
  assert.equal(canApplyBindingResponse({ ...input, currentVersion: 3 }), false)
})
test('冲突与未知保存结果必须先读取核对，校验失败可继续修改', () => {
  assert.equal(classifyBindingSaveFailure({ kind: 'http', status: 409 }), 'refresh')
  assert.equal(classifyBindingSaveFailure({ kind: 'network' }), 'unknown')
  assert.equal(classifyBindingSaveFailure({ kind: 'http', status: 500 }), 'unknown')
  assert.equal(classifyBindingSaveFailure({ kind: 'http', status: 422 }), 'editable')
})
test('前端防误选仍仅接受唛头、启用、生效版本齐备的规则', () => {
  const rule = { id: 'rule', ruleCode: 'MARK', name: '唛头', purpose: 'SHIPPING_MARK' as const, status: 'ENABLED' as const, activeRevision: 1 }
  assert.equal(isBindableRule(rule), true)
  assert.equal(isBindableRule({ ...rule, purpose: 'BUSINESS' }), false)
  assert.equal(isBindableRule({ ...rule, status: 'DISABLED' }), false)
  assert.equal(isBindableRule({ ...rule, activeRevision: null }), false)
})
test('入口、隐藏路由与配置页不向采购创建或编号引擎增加依赖', () => {
  const root = new URL('../../src/', import.meta.url)
  const route = readFileSync(new URL('router/modules/basic.data.ts', root), 'utf8')
  const list = readFileSync(new URL('views/system/basic-data/numbering/index.vue', root), 'utf8')
  const page = readFileSync(new URL('views/system/basic-data/numbering/shipping-mark-bindings.vue', root), 'utf8')
  assert.match(route, /numbering\/shipping-mark-bindings/u)
  assert.match(route, /auth: 'purchase-shipping-marks:read'/u)
  assert.match(list, /data-testid="shipping-mark-bindings-entry"/u)
  assert.match(page, /QsGenericTable/u)
  assert.match(page, /#actions="\{ row \}"/u)
  assert.doesNotMatch(page, /#cell-actions/u)
  assert.match(page, /CUSTOM_MARK/u)
  assert.doesNotMatch(page, /purchaseOrdersApi|NumberingGenerator|generateScoped/u)
})
