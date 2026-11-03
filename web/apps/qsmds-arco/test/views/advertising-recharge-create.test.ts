import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 广告充值新增弹窗的缺项判定使用 Node.js 内置 runner 验证。
import test from 'node:test'

import { parseAdvertisingRechargePaste, resolveAdvertisingRechargeMissingFields } from '../../src/views/workbenches/network-ads/advertising-recharges/recharge-form'

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

test('按示例解析「名称 + 标签编号」的三种写法', () => {
  assert.deepEqual(parseAdvertisingRechargePaste('YN-QS-02\n廣告帳號編號：2709967836064258'), {
    adAccountName: 'YN-QS-02',
    adAccountNo: '2709967836064258',
    conflictingNumbers: false,
  })
  assert.deepEqual(parseAdvertisingRechargePaste('QS-LB-07\n广告账户编号：1154119104237920'), {
    adAccountName: 'QS-LB-07',
    adAccountNo: '1154119104237920',
    conflictingNumbers: false,
  })
  assert.deepEqual(parseAdvertisingRechargePaste('LB-QS-05\n广告账户编号：1998934590818010'), {
    adAccountName: 'LB-QS-05',
    adAccountNo: '1998934590818010',
    conflictingNumbers: false,
  })
})

test('首行是纯数字时按约定同时作为名称和编号', () => {
  assert.deepEqual(parseAdvertisingRechargePaste('1550628950152083\n廣告帳號編號：1550628950152083'), {
    adAccountName: '1550628950152083',
    adAccountNo: '1550628950152083',
    conflictingNumbers: false,
  })
})

test('首行数字与标签编号不同时各自填充并标记冲突', () => {
  assert.deepEqual(parseAdvertisingRechargePaste('1550628950152083\n廣告帳號編號：2709967836064258'), {
    adAccountName: '1550628950152083',
    adAccountNo: '2709967836064258',
    conflictingNumbers: true,
  })
})

test('只有标签行、只有编码、单行纯数字三种部分结果', () => {
  assert.deepEqual(parseAdvertisingRechargePaste('廣告帳號編號：1550628950152083'), {
    adAccountName: null,
    adAccountNo: '1550628950152083',
    conflictingNumbers: false,
  })
  assert.deepEqual(parseAdvertisingRechargePaste('YN-QS-02'), {
    adAccountName: 'YN-QS-02',
    adAccountNo: null,
    conflictingNumbers: false,
  })
  assert.deepEqual(parseAdvertisingRechargePaste('1550628950152083'), {
    adAccountName: null,
    adAccountNo: '1550628950152083',
    conflictingNumbers: false,
  })
})

test('兼容全角冒号、全角数字、编号内空格与连字符', () => {
  assert.deepEqual(parseAdvertisingRechargePaste('QS-LB-07\n广告账户编号 1154 1191 0423 7920'), {
    adAccountName: 'QS-LB-07',
    adAccountNo: '1154119104237920',
    conflictingNumbers: false,
  })
  assert.deepEqual(parseAdvertisingRechargePaste('YN-QS-02\n廣告帳號編號：２７０９９６７８３６０６４２５８'), {
    adAccountName: 'YN-QS-02',
    adAccountNo: '2709967836064258',
    conflictingNumbers: false,
  })
  assert.deepEqual(parseAdvertisingRechargePaste('LB-QS-05\n廣告帳號編號: 1998-9345-9081-8010'), {
    adAccountName: 'LB-QS-05',
    adAccountNo: '1998934590818010',
    conflictingNumbers: false,
  })
})

test('无关文本与空输入不产生任何字段', () => {
  assert.deepEqual(parseAdvertisingRechargePaste('今天天气不错\n请尽快处理'), {
    adAccountName: null,
    adAccountNo: null,
    conflictingNumbers: false,
  })
  assert.deepEqual(parseAdvertisingRechargePaste('   \n\n  '), {
    adAccountName: null,
    adAccountNo: null,
    conflictingNumbers: false,
  })
})

test('首行的标题类文字不会被当成名称', () => {
  assert.deepEqual(parseAdvertisingRechargePaste('广告账户信息\nYN-QS-02\n廣告帳號編號：2709967836064258'), {
    adAccountName: 'YN-QS-02',
    adAccountNo: '2709967836064258',
    conflictingNumbers: false,
  })
})
