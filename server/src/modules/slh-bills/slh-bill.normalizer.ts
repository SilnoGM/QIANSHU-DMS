import { normalizeOceanDecimal } from '../ocean-freight-calculation/ocean-freight-calculation'
import { slhBillFailure } from './slh-bill-calculation'

export interface SlhBillCommandContext { actorUserId: string, requestId: string }

export function slhBillUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    return slhBillFailure('VALIDATION_FAILED', '标识必须是规范的小写 UUID v4')
  }
  return value
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    return slhBillFailure('VALIDATION_FAILED', '提交内容包含无效字段')
  }
  return value as Record<string, unknown>
}

export interface SlhBillImportInput {
  mediaAssetId: string
  manualForeignUnitsPerCny: string | null
  supersedesBillId: string | null
  duplicateAcknowledged: boolean
}

/** 手填汇率只在账单不自带汇率时生效，因此这里只校验形状，来源判定留给服务层。 */
export function normalizeSlhBillImport(raw: unknown): SlhBillImportInput {
  const input = record(raw, ['mediaAssetId', 'manualForeignUnitsPerCny', 'supersedesBillId', 'duplicateAcknowledged'])
  return {
    mediaAssetId: slhBillUuid(input.mediaAssetId),
    manualForeignUnitsPerCny: normalizeOceanDecimal(input.manualForeignUnitsPerCny ?? null, 30, 12, 'manualForeignUnitsPerCny', true),
    supersedesBillId: input.supersedesBillId == null ? null : slhBillUuid(input.supersedesBillId),
    duplicateAcknowledged: input.duplicateAcknowledged === true,
  }
}

export function normalizeSlhBillMediaAsset(raw: unknown): { mediaAssetId: string } {
  const input = record(raw, ['mediaAssetId'])
  return { mediaAssetId: slhBillUuid(input.mediaAssetId) }
}

export function normalizeSlhBillId(value: unknown): string { return slhBillUuid(value) }
