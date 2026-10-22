import type { PaymentRecipientAccountInputDto, PaymentRecipientMethod } from '@/api/modules/payment-recipients'
import { validateUploadImage } from '../../../utils/image-upload-rules'

export const PAYMENT_RECIPIENT_METHODS: PaymentRecipientMethod[] = ['ALIPAY', 'WECHAT', 'BANK_TRANSFER']

export function normalizePaymentRecipientAccounts(accounts: readonly PaymentRecipientAccountInputDto[]): PaymentRecipientAccountInputDto[] {
  return accounts.map(account => ({
    paymentMethod: account.paymentMethod,
    recipientName: account.recipientName.trim(),
    qrMediaAssetId: account.paymentMethod === 'BANK_TRANSFER' ? null : account.qrMediaAssetId ?? null,
    bankName: account.paymentMethod === 'BANK_TRANSFER' ? account.bankName?.trim() || null : null,
    bankAccount: account.paymentMethod === 'BANK_TRANSFER' ? account.bankAccount?.trim() || null : null,
    bankBranch: account.paymentMethod === 'BANK_TRANSFER' ? account.bankBranch?.trim() || null : null,
  }))
}
export function validatePaymentRecipientAccounts(accounts: readonly PaymentRecipientAccountInputDto[], minimum: 0 | 1 = 0, methods: readonly PaymentRecipientMethod[] = PAYMENT_RECIPIENT_METHODS): string | null {
  if (accounts.length < minimum) {
    return 'paymentRecipient.errors.required'
  }
  if (accounts.length > 3 || new Set(accounts.map(account => account.paymentMethod)).size !== accounts.length) {
    return 'paymentRecipient.errors.duplicate'
  }
  for (const account of accounts) {
    if (!methods.includes(account.paymentMethod)) {
      return 'paymentRecipient.errors.method'
    }
    if (!account.recipientName.trim() || account.recipientName.trim().length > 128) {
      return 'paymentRecipient.errors.recipientName'
    }
    if (account.paymentMethod === 'BANK_TRANSFER') {
      if (!account.bankName?.trim() || !account.bankAccount?.trim() || account.bankName.length > 128 || account.bankAccount.length > 128 || (account.bankBranch?.length ?? 0) > 128) {
        return 'paymentRecipient.errors.bankRequired'
      }
    }
    else if (!account.qrMediaAssetId) {
      return 'paymentRecipient.errors.qrRequired'
    }
  }
  return null
}
export function validateRecipientImage(file: { name?: string, type: string, size: number }): string | null {
  const failure = validateUploadImage(file)
  if (failure === 'type') {
    return 'paymentRecipient.errors.imageType'
  }
  return failure === null ? null : 'paymentRecipient.errors.imageSize'
}
export function paymentRecipientSaveFailure(error: unknown): 'editable' | 'refresh' | 'unknown' {
  if (typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'http' && 'status' in error && typeof error.status === 'number') {
    return error.status === 409 ? 'refresh' : error.status < 500 ? 'editable' : 'unknown'
  }
  return 'unknown'
}
export function paymentRecipientErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'http' && 'body' in error
    && typeof error.body === 'object' && error.body !== null && 'message' in error.body && typeof error.body.message === 'string') {
    return error.body.message
  }
  return fallback
}
