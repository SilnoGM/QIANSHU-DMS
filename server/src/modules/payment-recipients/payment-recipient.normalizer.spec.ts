import { normalizePaymentRecipientAccounts } from './payment-recipient.normalizer'

const qr = '00000000-0000-4000-8000-000000000011'
const bank = { paymentMethod: 'BANK_TRANSFER', recipientName: ' 张三 ', bankName: ' 工商银行 ', bankAccount: ' 12345678 ' }
describe('payment recipient input boundary', () => {
  it('normalizes bank details and canonicalizes account order', () => {
    expect(normalizePaymentRecipientAccounts([bank, { paymentMethod: 'ALIPAY', recipientName: '李四', qrMediaAssetId: qr }], 1)).toEqual([
      { paymentMethod: 'ALIPAY', recipientName: '李四', qrMediaAssetId: qr, bankName: null, bankAccount: null, bankBranch: null },
      { paymentMethod: 'BANK_TRANSFER', recipientName: '张三', qrMediaAssetId: null, bankName: '工商银行', bankAccount: '12345678', bankBranch: null },
    ])
  })
  it('allows disabling all supplier accounts but requires at least one for an order', () => {
    expect(normalizePaymentRecipientAccounts([], 0)).toEqual([])
    expect(() => normalizePaymentRecipientAccounts([], 1)).toThrow()
  })
  it.each([
    [{ paymentMethod: 'ALIPAY', recipientName: '姓名' }],
    [{ paymentMethod: 'WECHAT', recipientName: '姓名', qrMediaAssetId: 'not-a-uuid' }],
    [{ ...bank, recipientName: ' ' }],
    [{ ...bank, bankAccount: '' }],
    [{ ...bank, qrMediaAssetId: qr }],
    [{ paymentMethod: 'ALIPAY', recipientName: '姓名', qrMediaAssetId: qr, bankName: '银行' }],
    [{ ...bank, unexpected: 'value' }],
    [bank, bank],
    [{ ...bank, bankBranch: 'a'.repeat(129) }],
    [{ ...bank, paymentMethod: 'CASH' }],
  ])('rejects incomplete, duplicate or incompatible details %#', (...accounts) => {
    expect(() => normalizePaymentRecipientAccounts(accounts, 1)).toThrow()
  })
})
