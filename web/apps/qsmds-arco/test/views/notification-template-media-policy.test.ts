import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import { buildTemplateMediaPolicyPayload } from '../../src/views/system/notifications/template-media-policy.logic'

const rulesSource = readFileSync(
  new URL('../../src/views/system/notifications/rules-panel.vue', import.meta.url),
  'utf8',
)

test('关闭附件时只提交 enabled:false，不携带被服务端拒绝的 maxCount', () => {
  const payload = buildTemplateMediaPolicyPayload({
    channel: 'WECOM',
    enabled: false,
    maxCount: 1,
    sources: [],
  })

  assert.deepEqual(payload, { enabled: false })
  assert.equal(Object.hasOwn(payload, 'maxCount'), false)
})

test('站内通知一期不支持附件，草稿即使开启也按禁用提交', () => {
  const payload = buildTemplateMediaPolicyPayload({
    channel: 'IN_APP',
    enabled: true,
    maxCount: 2,
    sources: ['salesOrder.issuanceVoucher'],
  })

  assert.deepEqual(payload, { enabled: false })
})

test('企业微信开启附件时提交完整策略', () => {
  const payload = buildTemplateMediaPolicyPayload({
    channel: 'WECOM',
    enabled: true,
    maxCount: 2,
    sources: ['salesOrder.issuanceVoucher'],
  })

  assert.deepEqual(payload, {
    enabled: true,
    maxCount: 2,
    kinds: ['IMAGE'],
    sources: ['salesOrder.issuanceVoucher'],
  })
})

test('保存入口统一走共享载荷构造，不再内联 maxCount 0', () => {
  assert.match(rulesSource, /buildTemplateMediaPolicyPayload/u)
  assert.doesNotMatch(
    rulesSource,
    /maxCount: enabled \? templateDraft\.value\.mediaPolicy\.maxCount : 0/u,
  )
})
