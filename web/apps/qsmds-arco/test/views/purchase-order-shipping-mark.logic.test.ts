import type { PurchaseOrderShippingMarkResolutionDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 解析并发隔离使用 Node.js runner。
import test from 'node:test'
import {
  createPurchaseOrderShippingMarkResolver,
  formatPurchaseOrderShippingMarkSummary,
} from '../../src/views/operations/purchase-orders/purchase-order-shipping-mark.logic'

const available: PurchaseOrderShippingMarkResolutionDto = {
  activeConfig: {
    maxOutputLength: 64,
    resetPolicy: 'YEARLY',
    timezone: 'Asia/Shanghai',
    segments: [
      { type: 'FIXED', value: 'WGJ' },
      { type: 'SEPARATOR', value: '-' },
      { type: 'DATE', format: 'YYYY' },
      { type: 'SEPARATOR', value: '-' },
      { type: 'SEQUENCE', width: 4, startValue: '1', step: '1' },
    ],
  },
  activeRevision: 2,
  availability: 'AVAILABLE',
  matchSource: 'SUPPLIER_BINDING',
  message: '提交时最终校验',
  name: '供应商唛头',
  productMode: 'CATALOG',
  resolutionToken: 'a'.repeat(64),
  ruleCode: 'SUPPLIER_MARK',
  ruleId: '11111111-1111-4111-8111-111111111111',
}

test('变更场景立即清空旧摘要且取消请求，迟到响应不能覆盖新摘要', async () => {
  const requests: { resolve: (value: PurchaseOrderShippingMarkResolutionDto) => void, signal: AbortSignal }[] = []
  const states: { resolution: PurchaseOrderShippingMarkResolutionDto | null, loading: boolean }[] = []
  const resolver = createPurchaseOrderShippingMarkResolver({
    canRefresh: () => true,
    getAuthEpoch: () => 1,
    load: (_query, signal) => new Promise(resolve => requests.push({ resolve, signal })),
    onChange: state => states.push(state),
  })
  const first = resolver.refresh({ productMode: 'CATALOG', supplierValue: 'OLD' })
  const second = resolver.refresh({ productMode: 'CATALOG', supplierValue: 'NEW' })
  assert.equal(requests[0]!.signal.aborted, true)
  assert.equal(states.at(-1)?.resolution, null)
  requests[1]!.resolve({ ...available, ruleCode: 'NEW_MARK' })
  await second
  requests[0]!.resolve(available)
  await first
  assert.equal(states.at(-1)?.resolution?.ruleCode, 'NEW_MARK')
  assert.equal(states.at(-1)?.loading, false)
})

test('摘要复用真实生效规则结构，派发说明只出现一次且不展示候选号', () => {
  const summary = formatPurchaseOrderShippingMarkSummary({
    ...available,
    message: '正式提交后自动派发，规则容量与生成结果将在提交时最终校验',
  })
  assert.match(summary, /WGJ-\{YYYY\}-\{SEQ:4,start=1,step=1\}/u)
  assert.equal(summary.split('正式提交后自动派发').length - 1, 1)
  assert.doesNotMatch(summary, /WGJ-2026-0001/u)
})

test('无生效版本不伪造配置，摘要保留不可用原因', () => {
  const summary = formatPurchaseOrderShippingMarkSummary({
    ...available,
    activeConfig: null,
    activeRevision: null,
    availability: 'NO_ACTIVE_VERSION',
    resolutionToken: null,
    message: '唛头规则尚无生效版本',
  })
  assert.match(summary, /无生效版本.*不可用/u)
  assert.match(summary, /唛头规则尚无生效版本/u)
  assert.doesNotMatch(summary, /WGJ|SEQ|undefined|null/u)
})

test('身份变化、卸载和未知提交不会接受新解析或覆盖已确认摘要', async () => {
  let authEpoch = 1
  let editable = true
  let calls = 0
  let finish!: (value: PurchaseOrderShippingMarkResolutionDto) => void
  const resolutions: (PurchaseOrderShippingMarkResolutionDto | null)[] = []
  const resolver = createPurchaseOrderShippingMarkResolver({
    canRefresh: () => editable,
    getAuthEpoch: () => authEpoch,
    load: () => {
      calls += 1
      return new Promise((resolve) => {
        finish = resolve
      })
    },
    onChange: state => resolutions.push(state.resolution),
  })
  const first = resolver.refresh({ productMode: 'CUSTOM' })
  authEpoch += 1
  finish(available)
  await first
  assert.equal(resolutions.at(-1), null)
  editable = false
  await resolver.refresh({ productMode: 'CUSTOM' })
  assert.equal(calls, 1)
  editable = true
  const second = resolver.refresh({ productMode: 'CUSTOM' })
  resolver.reset()
  finish(available)
  await second
  assert.equal(resolutions.at(-1), null)
})

test('只读解析失败保留安全错误，不生成未知提交或候选号', async () => {
  let latest: { error: string, loading: boolean, resolution: PurchaseOrderShippingMarkResolutionDto | null } | undefined
  const resolver = createPurchaseOrderShippingMarkResolver({
    canRefresh: () => true,
    getAuthEpoch: () => 1,
    load: async () => { throw Object.assign(new Error('网络暂不可用'), { kind: 'network' }) },
    onChange: (state) => { latest = state },
  })
  await resolver.refresh({ productMode: 'CUSTOM' })
  assert.equal(latest?.loading, false)
  assert.equal(latest?.resolution, null)
  assert.equal(latest?.error, '网络暂不可用')
  assert.match(formatPurchaseOrderShippingMarkSummary(available), /SUPPLIER_MARK.*第 2 版.*可用/u)
  assert.match(formatPurchaseOrderShippingMarkSummary(available), /正式提交后自动派发/u)
  assert.match(formatPurchaseOrderShippingMarkSummary({ ...available, availability: 'RULE_DISABLED', resolutionToken: null, message: '规则已停用' }), /规则已停用/u)
})
