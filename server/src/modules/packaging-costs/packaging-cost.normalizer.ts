import { Prisma } from '../../generated/prisma/client'
import { normalizePaymentRecipientAccounts } from '../payment-recipients/payment-recipient.normalizer'
import { ApiException } from '../../infrastructure/http/api.exception'

export function packagingCostFailure(code: string, message: string, status = 422): never {
  throw new ApiException(status, code, message)
}
export function packagingCostUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    return packagingCostFailure('VALIDATION_FAILED', '标识必须是规范的小写 UUID v4')
  }
  return value
}
export const packagingCostIdempotencyKey = packagingCostUuid
export interface PackagingCostContext { actorUserId: string, requestId: string }
function normalizePackagingAmount(value: unknown) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,25})(\.\d{1,2})?$/u.test(value)) return packagingCostFailure('VALIDATION_FAILED', '金额必须为最多两位小数的人民币金额')
  const decimal = new Prisma.Decimal(value)
  if (decimal.lte(0)) return packagingCostFailure('VALIDATION_FAILED', '金额必须大于零')
  return decimal.toFixed(4)
}
export function normalizePackagingCostAmountUpdate(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return packagingCostFailure('VALIDATION_FAILED', '金额修改内容无效')
  const input = raw as Record<string, unknown>
  if (Object.keys(input).some(key => !['amount', 'expectedVersion'].includes(key))
    || !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) return packagingCostFailure('VALIDATION_FAILED', '金额修改内容无效')
  return { amount: normalizePackagingAmount(input.amount), expectedVersion: Number(input.expectedVersion) }
}
export function normalizePackagingCostCreate(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return packagingCostFailure('VALIDATION_FAILED', '提报内容无效')
  const input = raw as Record<string, unknown>
  if (Object.keys(input).some(key => !['shipmentId', 'packagingType', 'packagingVendor', 'amount', 'packagingImageMediaAssetId', 'quotationImageMediaAssetId', 'remark', 'paymentRecipients'].includes(key))) return packagingCostFailure('VALIDATION_FAILED', '提报包含未知字段')
  const shipmentId = packagingCostUuid(input.shipmentId)
  const packagingImageMediaAssetId = packagingCostUuid(input.packagingImageMediaAssetId)
  const quotationImageMediaAssetId = packagingCostUuid(input.quotationImageMediaAssetId)
  if (packagingImageMediaAssetId === quotationImageMediaAssetId) return packagingCostFailure('VALIDATION_FAILED', '两项截图凭证必须分别上传')
  if (typeof input.packagingType !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(input.packagingType)) return packagingCostFailure('VALIDATION_FAILED', '包装类型无效')
  if (input.packagingVendor !== 'CHENGXIN' && input.packagingVendor !== 'OTHER') return packagingCostFailure('VALIDATION_FAILED', '包装厂商无效')
  const amount = normalizePackagingAmount(input.amount)
  if (input.remark != null && (typeof input.remark !== 'string' || [...input.remark].length > 500)) return packagingCostFailure('VALIDATION_FAILED', '备注不得超过500字')
  const paymentRecipients = input.packagingVendor === 'OTHER' ? normalizePackagingRecipients(input.paymentRecipients, 1) : undefined
  if (input.packagingVendor === 'CHENGXIN' && input.paymentRecipients !== undefined) return packagingCostFailure('PAYMENT_RECIPIENT_INVALID', '诚信木箱应使用管理员配置的收款资料')
  return { ...(paymentRecipients ? { paymentRecipients } : {}), shipmentId, packagingType: input.packagingType, packagingVendor: input.packagingVendor, amount, packagingImageMediaAssetId, quotationImageMediaAssetId, remark: typeof input.remark === 'string' ? input.remark.trim() || null : null }
}

export function normalizePackagingRecipients(input: unknown, minimum: 0 | 1 = 0) {
  const accounts = normalizePaymentRecipientAccounts(input, minimum)
  if (accounts.some(account => account.paymentMethod === 'BANK_TRANSFER')) return packagingCostFailure('PAYMENT_RECIPIENT_INVALID', '包装厂商仅支持支付宝或微信收款码')
  return accounts
}
export function normalizePackagingPayment(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return packagingCostFailure('VALIDATION_FAILED', '付款内容无效')
  const row = input as Record<string, unknown>
  if (Object.keys(row).some(key => !['expectedVersion', 'recipientAccountId', 'recipientProfileVersion', 'paymentMethod', 'voucher', 'remark'].includes(key))
    || !Number.isSafeInteger(row.expectedVersion) || Number(row.expectedVersion) < 1 || !Number.isSafeInteger(row.recipientProfileVersion) || Number(row.recipientProfileVersion) < 1
    || !['ALIPAY', 'WECHAT'].includes(String(row.paymentMethod))) return packagingCostFailure('VALIDATION_FAILED', '付款确认内容无效')
  if (!row.voucher || typeof row.voucher !== 'object' || Array.isArray(row.voucher) || Object.keys(row.voucher).some(key => key !== 'mediaAssetId')) return packagingCostFailure('VALIDATION_FAILED', '请上传付款截图')
  if (row.remark != null && (typeof row.remark !== 'string' || [...row.remark].length > 500)) return packagingCostFailure('VALIDATION_FAILED', '备注不得超过500字')
  return { expectedVersion: Number(row.expectedVersion), recipientProfileVersion: Number(row.recipientProfileVersion), recipientAccountId: packagingCostUuid(row.recipientAccountId), paymentMethod: row.paymentMethod as 'ALIPAY' | 'WECHAT', voucher: { mediaAssetId: packagingCostUuid((row.voucher as Record<string, unknown>).mediaAssetId) }, remark: typeof row.remark === 'string' ? row.remark.trim() || null : null }
}
