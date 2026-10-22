import type { PackagingCostRequestDto, PaymentRecipientAccountInputDto } from '@/api/generated/types.gen'
import Decimal from 'decimal.js'
import { validateMoneyString } from '../../../components/base/MoneyInput/logic'
import { normalizePaymentRecipientAccounts, validatePaymentRecipientAccounts } from '../../../components/business/QsPaymentRecipientEditor/logic'
import { UPLOAD_POLICIES, validateUploadFile } from '../../../utils/upload-policy'

export interface PackagingCostContext {
  shipmentId: string
  shipmentNo: string | null
  shippingMarkText: string | null
  purchaseOrderNo: string | null
  salesOrderNo: string | null
  ownerName: string | null
  ownerAvatarUrl: string | null
}

export interface PackagingCostInput {
  packagingTypeValue: string | null
  vendor: string | null
  amount: string | null
  packagingImages: File[]
  quotationImages: File[]
  remark: string
  paymentRecipients?: PaymentRecipientAccountInputDto[]
}

export interface PackagingCostDraft {
  packagingTypeValue: string
  vendor: 'CHENGXIN' | 'OTHER'
  amount: string
  currency: 'CNY'
  packagingImages: File[]
  quotationImages: File[]
  remark: string | null
  paymentRecipients?: PaymentRecipientAccountInputDto[]
}

export type PackagingCostField = keyof PackagingCostInput
export type PackagingImageError = 'invalidImageType' | 'imageTooLarge' | 'tooManyImages' | 'previewFailed'
export type PackagingCostError = PackagingImageError | 'requiredPackagingType' | 'requiredVendor' | 'requiredAmount' | 'invalidAmount' | 'requiredImages' | 'remarkTooLong' | 'invalidRecipients'
export const PACKAGING_IMAGE_LIMIT = 1
export const PACKAGING_DEFAULT_VENDOR = '沙井·诚信木箱'
export const PACKAGING_RECIPIENT_METHODS = ['ALIPAY', 'WECHAT'] as const

export function buildPackagingPaymentRequestText(request: Pick<PackagingCostRequestDto, 'shippingMarkText' | 'packagingVendor' | 'packagingTypeName' | 'amount'>, resolvedHref: string, currentUrl: string): string {
  const vendor = request.packagingVendor === 'CHENGXIN' ? PACKAGING_DEFAULT_VENDOR : '其他'
  const amount = new Decimal(request.amount).toFixed(2)
  return `【打木架/木箱付款申请】\n货件唛头：${request.shippingMarkText}\n包装厂商：${vendor}\n本次申请支付 [${request.packagingTypeName}]费用：${amount} 元。\n付款链接： ${new URL(resolvedHref, currentUrl).href}`
}

export function validatePackagingImage(file: File): PackagingImageError | null {
  const failure = validateUploadFile(file, UPLOAD_POLICIES.IMAGE_ONLY)
  if (failure === 'too-large') {
    return 'imageTooLarge'
  }
  return failure === null ? null : 'invalidImageType'
}

export function validatePackagingCost(input: PackagingCostInput, precision = 2): {
  errors: Partial<Record<PackagingCostField, PackagingCostError>>
  draft: PackagingCostDraft | null
} {
  const errors: Partial<Record<PackagingCostField, PackagingCostError>> = {}
  if (!input.packagingTypeValue?.trim()) {
    errors.packagingTypeValue = 'requiredPackagingType'
  }
  if (!['CHENGXIN', 'OTHER'].includes(input.vendor ?? '')) {
    errors.vendor = 'requiredVendor'
  }
  const amount = validateMoneyString(input.amount, { precision, min: precision > 0 ? `0.${'0'.repeat(precision - 1)}1` : '1' })
  if (input.amount === null || input.amount === '') {
    errors.amount = 'requiredAmount'
  }
  else if (!amount.valid) {
    errors.amount = 'invalidAmount'
  }
  for (const field of ['packagingImages', 'quotationImages'] as const) {
    const files = input[field]
    if (!files.length) {
      errors[field] = 'requiredImages'
    }
    else if (files.length > PACKAGING_IMAGE_LIMIT) {
      errors[field] = 'tooManyImages'
    }
    else {
      const error = files.map(validatePackagingImage).find(Boolean)
      if (error) {
        errors[field] = error
      }
    }
  }
  if (input.remark.length > 500) {
    errors.remark = 'remarkTooLong'
  }
  if (input.vendor === 'OTHER' && validatePaymentRecipientAccounts(input.paymentRecipients ?? [], 1, PACKAGING_RECIPIENT_METHODS)) {
    errors.paymentRecipients = 'invalidRecipients'
  }
  if (Object.keys(errors).length || !amount.valid || amount.normalizedValue === null) {
    return { errors, draft: null }
  }
  return {
    errors,
    draft: {
      packagingTypeValue: input.packagingTypeValue!,
      vendor: input.vendor as 'CHENGXIN' | 'OTHER',
      amount: amount.normalizedValue,
      currency: 'CNY',
      packagingImages: [...input.packagingImages],
      quotationImages: [...input.quotationImages],
      remark: input.remark.trim() || null,
      ...(input.vendor === 'OTHER' ? { paymentRecipients: normalizePaymentRecipientAccounts(input.paymentRecipients ?? []) } : {}),
    },
  }
}
