import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 收款资料规则用现有 Node 测试入口验证。
import test from 'node:test'
import { normalizePaymentRecipientAccounts, paymentRecipientSaveFailure, validatePaymentRecipientAccounts, validateRecipientImage } from '../../src/components/business/QsPaymentRecipientEditor/logic'

const bank = { paymentMethod: 'BANK_TRANSFER' as const, recipientName: ' 公司 ', bankName: ' 银行 ', bankAccount: ' 12345678 ' }
const qr = { paymentMethod: 'ALIPAY' as const, recipientName: '张三', qrMediaAssetId: 'image-id' }
test('本单至少一种，管理员允许清空；每种最多一个', () => {
  assert.equal(validatePaymentRecipientAccounts([], 0), null)
  assert.equal(validatePaymentRecipientAccounts([], 1), 'paymentRecipient.errors.required')
  assert.equal(validatePaymentRecipientAccounts([bank, qr], 1), null)
  assert.equal(validatePaymentRecipientAccounts([qr, qr], 1), 'paymentRecipient.errors.duplicate')
})
test('启用方式必须完整，微信支付宝要求图片，银行支行可不填', () => {
  assert.equal(validatePaymentRecipientAccounts([{ ...qr, recipientName: ' ' }], 1), 'paymentRecipient.errors.recipientName')
  assert.equal(validatePaymentRecipientAccounts([{ ...qr, qrMediaAssetId: null }], 1), 'paymentRecipient.errors.qrRequired')
  assert.equal(validatePaymentRecipientAccounts([{ ...bank, bankName: '' }], 1), 'paymentRecipient.errors.bankRequired')
  assert.equal(validatePaymentRecipientAccounts([{ ...bank, bankAccount: ' ' }], 1), 'paymentRecipient.errors.bankRequired')
  assert.equal(validatePaymentRecipientAccounts([{ ...qr, paymentMethod: 'WECHAT' }], 1), null)
})
test('保存只携带当前方式字段，修剪输入，不误传历史id或内容地址', () => {
  assert.deepEqual(normalizePaymentRecipientAccounts([{ ...bank, qrMediaAssetId: 'wrong-image' }, { ...qr, bankName: 'wrong-bank' }]), [
    { paymentMethod: 'BANK_TRANSFER', recipientName: '公司', bankName: '银行', bankAccount: '12345678', bankBranch: null, qrMediaAssetId: null },
    { paymentMethod: 'ALIPAY', recipientName: '张三', qrMediaAssetId: 'image-id', bankName: null, bankAccount: null, bankBranch: null },
  ])
})
test('图片限制格式和体积，失败不产生可保存资料', () => {
  assert.equal(validateRecipientImage({ name: 'qr.png', type: 'image/png', size: 20 }), null)
  assert.equal(validateRecipientImage({ name: 'qr.svg', type: 'image/svg+xml', size: 20 }), 'paymentRecipient.errors.imageType')
  assert.equal(validateRecipientImage({ name: 'qr.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 }), 'paymentRecipient.errors.imageSize')
})
test('保存冲突或未知结果先核对，不盲重试旧版本；校验错误可改正', () => {
  assert.equal(paymentRecipientSaveFailure({ kind: 'network' }), 'unknown')
  assert.equal(paymentRecipientSaveFailure({ kind: 'http', status: 409 }), 'refresh')
  assert.equal(paymentRecipientSaveFailure({ kind: 'http', status: 422 }), 'editable')
})

test('包装仅允许支付宝与微信，采购默认仍然允许银行账户', () => {
  const methods = ['ALIPAY', 'WECHAT'] as const
  assert.equal(validatePaymentRecipientAccounts([bank], 0, methods), 'paymentRecipient.errors.method')
  assert.equal(validatePaymentRecipientAccounts([qr], 1, methods), null)
  assert.equal(validatePaymentRecipientAccounts([bank], 0), null)
})
