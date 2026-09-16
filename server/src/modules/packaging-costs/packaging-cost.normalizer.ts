import { Prisma } from '../../generated/prisma/client'
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
export function normalizePackagingCostCreate(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return packagingCostFailure('VALIDATION_FAILED', '提报内容无效')
  const input = raw as Record<string, unknown>
  if (Object.keys(input).some(key => !['shipmentId', 'packagingType', 'packagingVendor', 'amount', 'packagingImageMediaAssetId', 'quotationImageMediaAssetId', 'remark'].includes(key))) return packagingCostFailure('VALIDATION_FAILED', '提报包含未知字段')
  const shipmentId = packagingCostUuid(input.shipmentId)
  const packagingImageMediaAssetId = packagingCostUuid(input.packagingImageMediaAssetId)
  const quotationImageMediaAssetId = packagingCostUuid(input.quotationImageMediaAssetId)
  if (packagingImageMediaAssetId === quotationImageMediaAssetId) return packagingCostFailure('VALIDATION_FAILED', '两项截图凭证必须分别上传')
  if (typeof input.packagingType !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(input.packagingType)) return packagingCostFailure('VALIDATION_FAILED', '包装类型无效')
  if (input.packagingVendor !== 'CHENGXIN' && input.packagingVendor !== 'OTHER') return packagingCostFailure('VALIDATION_FAILED', '包装厂商无效')
  if (typeof input.amount !== 'string' || !/^(0|[1-9]\d{0,25})(\.\d{1,2})?$/u.test(input.amount)) return packagingCostFailure('VALIDATION_FAILED', '金额必须为最多两位小数的人民币金额')
  const decimal = new Prisma.Decimal(input.amount)
  if (decimal.lte(0)) return packagingCostFailure('VALIDATION_FAILED', '金额必须大于零')
  if (input.remark != null && (typeof input.remark !== 'string' || [...input.remark].length > 500)) return packagingCostFailure('VALIDATION_FAILED', '备注不得超过500字')
  return { shipmentId, packagingType: input.packagingType, packagingVendor: input.packagingVendor, amount: decimal.toFixed(4), packagingImageMediaAssetId, quotationImageMediaAssetId, remark: typeof input.remark === 'string' ? input.remark.trim() || null : null }
}
