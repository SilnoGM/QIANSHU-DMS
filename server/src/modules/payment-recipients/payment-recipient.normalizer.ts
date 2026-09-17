import { ApiException } from '../../infrastructure/http/api.exception'
import { PAYMENT_RECIPIENT_METHODS, type PaymentRecipientAccountInputDto, type PaymentRecipientMethod } from './payment-recipient.dto'

export interface NormalizedPaymentRecipientAccount {
  paymentMethod: PaymentRecipientMethod
  recipientName: string
  qrMediaAssetId: string | null
  bankName: string | null
  bankAccount: string | null
  bankBranch: string | null
}
export function recipientFailure(code: string, message: string, status = 422): never { throw new ApiException(status, code, message) }
export function recipientStateChanged(): never { return recipientFailure('PAYMENT_RECIPIENT_STATE_CHANGED', '收款资料已变化，请刷新后重新核对', 409) }
function text(value: unknown, required = false): string | null {
  if (value === null || value === undefined) {
    if (required) return recipientFailure('PAYMENT_RECIPIENT_INVALID', '收款资料未填写完整')
    return null
  }
  if (typeof value !== 'string' || [...value.trim()].length > 128 || [...value].some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127)) return recipientFailure('PAYMENT_RECIPIENT_INVALID', '收款资料格式无效')
  const normalized = value.trim()
  if (!normalized && required) return recipientFailure('PAYMENT_RECIPIENT_INVALID', '收款资料未填写完整')
  return normalized || null
}
export function normalizePaymentRecipientAccounts(input: unknown, minimum: 0 | 1 = 0): NormalizedPaymentRecipientAccount[] {
  if (!Array.isArray(input) || input.length > 3 || (input.length < minimum)) return recipientFailure('PAYMENT_RECIPIENT_INVALID', '请配置至少一种完整的收款方式，每种方式最多一个账户')
  const used = new Set<string>()
  const accounts = input.map((value: unknown): NormalizedPaymentRecipientAccount => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['paymentMethod', 'recipientName', 'qrMediaAssetId', 'bankName', 'bankAccount', 'bankBranch'].includes(key))) return recipientFailure('PAYMENT_RECIPIENT_INVALID', '收款资料格式无效')
    const row = value as PaymentRecipientAccountInputDto
    if (!PAYMENT_RECIPIENT_METHODS.includes(row.paymentMethod) || used.has(row.paymentMethod)) return recipientFailure('PAYMENT_RECIPIENT_INVALID', '每种收款方式只能配置一个账户')
    used.add(row.paymentMethod)
    const recipientName = text(row.recipientName, true)!
    const bankName = text(row.bankName), bankAccount = text(row.bankAccount), bankBranch = text(row.bankBranch)
    const qrMediaAssetId = row.qrMediaAssetId ?? null
    if (row.paymentMethod === 'BANK_TRANSFER') {
      if (!bankName || !bankAccount || qrMediaAssetId !== null) return recipientFailure('PAYMENT_RECIPIENT_INVALID', '银行转账需填写开户名称、银行名称和账号')
    } else if (typeof qrMediaAssetId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(qrMediaAssetId) || bankName || bankAccount || bankBranch) return recipientFailure('PAYMENT_RECIPIENT_INVALID', '支付宝和微信需填写收款人并上传收款码')
    return { paymentMethod: row.paymentMethod, recipientName, qrMediaAssetId, bankName, bankAccount, bankBranch }
  })
  return accounts.sort((left, right) => PAYMENT_RECIPIENT_METHODS.indexOf(left.paymentMethod) - PAYMENT_RECIPIENT_METHODS.indexOf(right.paymentMethod))
}
