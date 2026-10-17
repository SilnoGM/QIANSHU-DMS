import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 状态映射与三语键对齐使用 Node.js 内置 runner 验证。
import test from 'node:test'
import en from '../../src/locales/lang/fund-withdrawal/en.json'
import zhCn from '../../src/locales/lang/fund-withdrawal/zh-cn.json'
import zhTw from '../../src/locales/lang/fund-withdrawal/zh-tw.json'
import {
  FUND_WITHDRAWAL_STATUS_META,
  FUND_WITHDRAWAL_STATUS_VALUES,
} from '../../src/views/operations/personal-finance/withdrawals/status.logic'
import { buildWithdrawalProofItems } from '../../src/views/operations/personal-finance/withdrawals/withdrawal-proof.logic'

test('提款状态只包含三种，标签与色调固定', () => {
  assert.deepEqual(Object.keys(FUND_WITHDRAWAL_STATUS_META), [...FUND_WITHDRAWAL_STATUS_VALUES])
  assert.equal(FUND_WITHDRAWAL_STATUS_META.PENDING.labelKey, 'fundWithdrawal.status.PENDING')
  assert.equal(FUND_WITHDRAWAL_STATUS_META.APPROVED.labelKey, 'fundWithdrawal.status.APPROVED')
  assert.equal(FUND_WITHDRAWAL_STATUS_META.REJECTED.labelKey, 'fundWithdrawal.status.REJECTED')
  assert.match(FUND_WITHDRAWAL_STATUS_META.PENDING.tagClass, /amber/u)
  assert.match(FUND_WITHDRAWAL_STATUS_META.APPROVED.tagClass, /emerald/u)
  assert.match(FUND_WITHDRAWAL_STATUS_META.REJECTED.tagClass, /destructive/u)
})

test('提款付款截图列只在已有截图时生成图片项', () => {
  assert.deepEqual(buildWithdrawalProofItems({
    id: '6f2d0f7a-21c4-4b68-8c82-9a5fe2ac4cf5',
    paymentProof: null,
  }, '付款截图'), [])

  assert.deepEqual(buildWithdrawalProofItems({
    id: '6f2d0f7a-21c4-4b68-8c82-9a5fe2ac4cf5',
    paymentProof: {
      fileName: '张三-提款100元-20261017.png',
      mediaAssetId: '2d8f74f2-2fb7-4a5e-8425-3fb0e5e71db0',
      uploadedAt: '2026-10-17T06:30:57.000Z',
    },
  }, '付款截图'), [{
    alt: '付款截图',
    key: '2d8f74f2-2fb7-4a5e-8425-3fb0e5e71db0',
    previewSrc: '/api/fund-withdrawals/me/6f2d0f7a-21c4-4b68-8c82-9a5fe2ac4cf5/payment-proof',
    src: '/api/fund-withdrawals/me/6f2d0f7a-21c4-4b68-8c82-9a5fe2ac4cf5/payment-proof',
    tooltip: '张三-提款100元-20261017.png',
  }])
})

function collectKeys(source: Record<string, unknown>): string[] {
  return Object.entries(source).flatMap(([key, value]) => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? collectKeys(value as Record<string, unknown>).map(child => `${key}.${child}`)
      : [key]
  )).sort()
}

test('提款页面三语文案键完全对齐', () => {
  const reference = collectKeys(zhCn as unknown as Record<string, unknown>)
  assert.deepEqual(collectKeys(zhTw as unknown as Record<string, unknown>), reference)
  assert.deepEqual(collectKeys(en as unknown as Record<string, unknown>), reference)
  for (const key of [
    'fundWithdrawal.status.PENDING',
    'fundWithdrawal.status.APPROVED',
    'fundWithdrawal.status.REJECTED',
    'fundWithdrawal.approve.proof',
    'fundWithdrawal.reject.reason',
    'fundWithdrawal.toast.submitted',
  ]) {
    assert.ok(reference.includes(key), `missing ${key}`)
  }
})
