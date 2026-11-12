import type { NotificationChannelPolicyDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 策略草稿逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildPolicyUpdate,
  canSavePolicyDraft,
  createPolicyDraft,
  policyDraftSignature,
  policyTtlHint,
} from '../../src/views/system/notifications/policy-draft.logic'

function policy(overrides: Partial<NotificationChannelPolicyDto> = {}): NotificationChannelPolicyDto {
  return {
    id: 'policy-1',
    eventType: 'PURCHASE_REVIEW_PENDING',
    channel: 'ASSISTANT',
    targetMode: 'PERMISSION',
    targetConfig: { permissionCode: 'purchase-orders:review' },
    templateKey: 'purchase.review.pending',
    priority: 'HIGH',
    ttlSeconds: 43_200,
    quietHours: { start: '21:30', end: '07:30', timezone: 'Asia/Shanghai' },
    allowSensitive: true,
    enabled: true,
    version: 3,
    updatedAt: '2026-11-10T08:00:00.000Z',
    updatedByName: '张三',
    ...overrides,
  }
}

test('已有策略还原为草稿，保留目标、模板、静默和版本', () => {
  const draft = createPolicyDraft(policy(), 'ASSISTANT')
  assert.equal(draft.targetMode, 'PERMISSION')
  assert.equal(draft.targetConfig.permissionCode, 'purchase-orders:review')
  assert.equal(draft.templateKey, 'purchase.review.pending')
  assert.equal(draft.priority, 'HIGH')
  assert.equal(draft.ttlSeconds, 43_200)
  assert.equal(draft.quietHoursEnabled, true)
  assert.equal(draft.quietStart, '21:30')
  assert.equal(draft.quietEnd, '07:30')
  assert.equal(draft.expectedVersion, 3)
})

test('新策略按渠道给默认 TTL：站内为空，小助理 24 小时', () => {
  assert.equal(createPolicyDraft(null, 'IN_APP').ttlSeconds, null)
  assert.equal(createPolicyDraft(null, 'ASSISTANT').ttlSeconds, 86_400)
  assert.equal(createPolicyDraft(null, 'IN_APP').quietHoursEnabled, false)
  assert.equal(createPolicyDraft(null, 'IN_APP').enabled, false)
  assert.equal(createPolicyDraft(null, 'ASSISTANT').enabled, false)
})

test('保存载荷清洗模板键，并让站内策略清空 TTL 与静默', () => {
  const draft = createPolicyDraft(policy(), 'IN_APP')
  draft.templateKey = '  '
  draft.quietHoursEnabled = true

  const payload = buildPolicyUpdate(draft, 'IN_APP')
  assert.equal(payload.templateKey, null)
  assert.equal(payload.ttlSeconds, null)
  assert.equal(payload.quietHours, null)
  assert.deepEqual(payload.targetConfig, { permissionCode: 'purchase-orders:review' })
  assert.equal(payload.expectedVersion, 3)
})

test('小助理保存载荷按目标模式只提交对应字段', () => {
  const draft = createPolicyDraft(null, 'ASSISTANT')
  draft.targetMode = 'GROUP'
  draft.targetConfig = { permissionCode: '', roleCodes: [], targetKeys: ['operations'], userIds: ['user-1'] }

  const payload = buildPolicyUpdate(draft, 'ASSISTANT')
  assert.deepEqual(payload.targetConfig, { targetKeys: ['operations'] })
  assert.deepEqual(payload.quietHours, null)
  assert.equal(payload.ttlSeconds, 86_400)
})

test('保存校验覆盖目标必填与小助理 TTL 范围', () => {
  const draft = createPolicyDraft(null, 'ASSISTANT')
  assert.equal(canSavePolicyDraft(draft, 'ASSISTANT', true), true)

  draft.targetMode = 'ROLE'
  assert.equal(canSavePolicyDraft(draft, 'ASSISTANT', true), false)
  draft.targetConfig.roleCodes = ['finance']
  assert.equal(canSavePolicyDraft(draft, 'ASSISTANT', true), true)
  assert.equal(canSavePolicyDraft(draft, 'ASSISTANT', false), false)

  draft.ttlSeconds = 30
  assert.equal(canSavePolicyDraft(draft, 'ASSISTANT', true), false)
  draft.ttlSeconds = 604_800
  assert.equal(canSavePolicyDraft(draft, 'ASSISTANT', true), true)
})

test('草稿签名对相同配置稳定，模板键变化会改变签名', () => {
  const first = createPolicyDraft(policy(), 'ASSISTANT')
  const second = createPolicyDraft(policy(), 'ASSISTANT')
  assert.equal(policyDraftSignature(first), policyDraftSignature(second))

  second.templateKey = 'purchase.review.pending.short'
  assert.notEqual(policyDraftSignature(first), policyDraftSignature(second))
})

test('TTL 提示按合法值换算小时', () => {
  assert.match(policyTtlHint(86_400), /24\.0 小时/u)
  assert.match(policyTtlHint(30), /60–604800/u)
})
