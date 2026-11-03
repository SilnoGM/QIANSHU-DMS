import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 广告充值新增弹窗的缺项判定使用 Node.js 内置 runner 验证。
import test from 'node:test'

import { resolveAdvertisingRechargeMissingFields } from '../../src/views/workbenches/network-ads/advertising-recharges/recharge-form'

const COMPLETE = {
  accountType: 'PERSONAL' as const,
  adAccountName: ' 千树-美国投放户 ',
  adAccountNo: 'act_verify_0001',
  rechargeAmount: '500.00',
  paymentQrMediaAssetId: '00000000-0000-4000-8000-000000000001',
}

test('完整填写时没有缺项，首尾空白不算缺失', () => {
  assert.deepEqual(resolveAdvertisingRechargeMissingFields(COMPLETE), [])
})

test('按固定顺序返回缺失字段，便于聚焦第一个错误', () => {
  assert.deepEqual(resolveAdvertisingRechargeMissingFields({
    ...COMPLETE,
    adAccountName: '   ',
    adAccountNo: '',
  }), ['adAccountName', 'adAccountNo'])
  assert.deepEqual(resolveAdvertisingRechargeMissingFields({
    ...COMPLETE,
    adAccountName: '',
    adAccountNo: '',
    rechargeAmount: null,
    paymentQrMediaAssetId: null,
  }), ['adAccountName', 'adAccountNo', 'rechargeAmount', 'paymentQr'])
  assert.deepEqual(resolveAdvertisingRechargeMissingFields({
    ...COMPLETE,
    rechargeAmount: '   ',
  }), ['rechargeAmount'])
})

test('只有个人户要求二维码，非个人户忽略已上传的二维码', () => {
  assert.deepEqual(resolveAdvertisingRechargeMissingFields({
    ...COMPLETE,
    paymentQrMediaAssetId: null,
  }), ['paymentQr'])
  assert.deepEqual(resolveAdvertisingRechargeMissingFields({
    ...COMPLETE,
    accountType: 'NON_PERSONAL',
    paymentQrMediaAssetId: null,
  }), [])
})
