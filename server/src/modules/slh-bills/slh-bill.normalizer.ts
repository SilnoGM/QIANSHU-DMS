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
  billName: string
  billMonth: string
  remark: string | null
  manualForeignUnitsPerCny: string | null
  supersedesBillId: string | null
  duplicateAcknowledged: boolean
}

const BILL_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u

/** 名称与备注都要去掉首尾空白后判定，避免「看起来填了」实际是空格。 */
function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') {
    return slhBillFailure('VALIDATION_FAILED', label + '不能为空')
  }
  const trimmed = value.trim()
  if (trimmed === '' || trimmed !== value) {
    return slhBillFailure('VALIDATION_FAILED', label + '需要去掉首尾空白后仍非空')
  }
  if ([...trimmed].length > maximum) {
    return slhBillFailure('VALIDATION_FAILED', label + '超出长度限制')
  }
  return trimmed
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    return slhBillFailure('VALIDATION_FAILED', label + '格式无效')
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  if (trimmed !== value || [...trimmed].length > maximum) {
    return slhBillFailure('VALIDATION_FAILED', label + '需要去掉首尾空白且不超出长度限制')
  }
  return trimmed
}

/** 手填汇率只在账单不自带汇率时生效，因此这里只校验形状，来源判定留给服务层。 */
export function normalizeSlhBillImport(raw: unknown): SlhBillImportInput {
  const input = record(raw, ['mediaAssetId', 'billName', 'billMonth', 'remark', 'manualForeignUnitsPerCny', 'supersedesBillId', 'duplicateAcknowledged'])
  const billMonth = requiredText(input.billMonth, '账单月份', 7)
  if (!BILL_MONTH_PATTERN.test(billMonth)) {
    return slhBillFailure('VALIDATION_FAILED', '账单月份必须是 YYYY-MM 形式')
  }
  return {
    mediaAssetId: slhBillUuid(input.mediaAssetId),
    billName: requiredText(input.billName, '账单名称', 200),
    billMonth,
    remark: optionalText(input.remark, '备注', 500),
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
