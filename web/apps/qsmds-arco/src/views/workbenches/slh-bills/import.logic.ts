import type { SlhBillImportCreateDto, SlhBillImportPreviewDto, SlhBillPreviewLineDto } from '@/api/generated/types.gen'
import Decimal from 'decimal.js'
import { countSlhBillFindings } from './comparison.logic'

export type SlhBillImportPhase = 'upload' | 'parsing' | 'preview'
export type SlhBillManualRateError = 'format' | 'required' | null
export type SlhBillImportBlockReason = 'manualRateRequired' | 'manualRateFormat' | 'lineErrors' | 'duplicateUnacknowledged' | null
export type SlhBillImportKeyAction = 'mine' | 'keep' | 'drop'
// 手填汇率与系统汇率同精度：非负、最多 12 位小数、无前导零。
const MANUAL_RATE_PATTERN = /^(?:0|[1-9]\d{0,27})(?:\.\d{1,12})?$/

/** 三段式：上传 → 解析中 → 预览确认；预览一旦到手就不再回退。 */
export function resolveSlhBillImportPhase(input: {
  mediaAssetId: string | null
  parsing: boolean
  preview: SlhBillImportPreviewDto | null
}): SlhBillImportPhase {
  if (input.preview !== null) {
    return 'preview'
  }
  return input.parsing ? 'parsing' : 'upload'
}

/**
 * 账单公式自带除数（换算公式原文）时不开放手填，否则要让用户确认入库汇率。
 * 预览只在公式缺少除数时才读系统汇率，因此两个条件任一成立都说明账单不自带汇率。
 */
export function needsSlhBillManualRate(preview: Pick<SlhBillImportPreviewDto, 'reported' | 'systemForeignUnitsPerCny'>): boolean {
  return (preview.reported.netAmountFormula ?? null) === null || preview.systemForeignUnitsPerCny !== null
}

/** 账单存在台币金额时才必须落一条汇率，没有台币金额的账单可以不带汇率入库。 */
export function hasSlhBillTwdAmounts(preview: Pick<SlhBillImportPreviewDto, 'totals'>): boolean {
  return new Decimal(preview.totals.codTotalAmountTwd).greaterThan(0)
    || new Decimal(preview.totals.ntdSurchargeTotalAmountTwd).greaterThan(0)
}

/**
 * 手填汇率解析：与系统汇率相等的值不提交为手填，避免把系统汇率错误标记成 MANUAL。
 * 返回 null 表示“交给服务端按系统汇率冻结”。
 */
export function resolveSlhBillManualRate(
  preview: Pick<SlhBillImportPreviewDto, 'reported' | 'systemForeignUnitsPerCny' | 'totals'>,
  raw: string,
): { value: string | null, error: SlhBillManualRateError } {
  if (!needsSlhBillManualRate(preview)) {
    return { error: null, value: null }
  }
  const systemRate = preview.systemForeignUnitsPerCny ?? null
  const trimmed = raw.trim()
  if (trimmed === '') {
    // 空值只在既没有系统汇率、又存在台币金额时才阻塞：此时入库必然无法落汇率。
    return systemRate === null && hasSlhBillTwdAmounts(preview)
      ? { error: 'required', value: null }
      : { error: null, value: null }
  }
  if (!MANUAL_RATE_PATTERN.test(trimmed) || new Decimal(trimmed).lessThanOrEqualTo(0)) {
    return { error: 'format', value: null }
  }
  if (systemRate !== null && new Decimal(trimmed).equals(systemRate)) {
    return { error: null, value: null }
  }
  return { error: null, value: trimmed }
}

/** 明细行的解析错误必须逐行回显，不能只给一个总数。 */
export function collectSlhBillLineErrors(lines: readonly SlhBillPreviewLineDto[]): string[] {
  return lines.flatMap(line => line.errors.map(error => `第 ${line.lineNumber} 行：${error}`))
}

export interface SlhBillImportIssueCounts {
  differences: number
  warnings: number
  lineErrors: number
}

/** 计数直接取自 findings 的 severity：行级与账单级是同一份数据，不再重复累加。 */
export function countSlhBillImportIssues(preview: Pick<SlhBillImportPreviewDto, 'findings' | 'lines'>): SlhBillImportIssueCounts {
  const counts = countSlhBillFindings(preview.findings)
  return {
    differences: counts.difference,
    warnings: counts.warning,
    lineErrors: preview.lines.reduce((total, line) => total + line.errors.length, 0),
  }
}

/** 服务端对同一「期间 + 柜号集合」返回重复提示，用户勾选确认后才允许继续。 */
export function resolveSlhBillImportBlock(input: {
  preview: Pick<SlhBillImportPreviewDto, 'lines' | 'duplicate'>
  manualRateError: SlhBillManualRateError
  duplicateAcknowledged: boolean
}): SlhBillImportBlockReason {
  if (input.manualRateError === 'required') {
    return 'manualRateRequired'
  }
  if (input.manualRateError === 'format') {
    return 'manualRateFormat'
  }
  if (input.preview.lines.some(line => line.errors.length > 0)) {
    return 'lineErrors'
  }
  if (input.preview.duplicate !== null && input.preview.duplicate !== undefined && !input.duplicateAcknowledged) {
    return 'duplicateUnacknowledged'
  }
  return null
}

/** 未手填时不发送该字段，让服务端冻结系统汇率并把来源记为 SYSTEM。 */
export function buildSlhBillImportPayload(input: {
  mediaAssetId: string
  archive: SlhBillArchiveDraft
  manualRate: string | null
  duplicateAcknowledged: boolean
  supersedesBillId?: SlhBillImportCreateDto['supersedesBillId']
}): SlhBillImportCreateDto {
  return {
    mediaAssetId: input.mediaAssetId,
    billName: input.archive.billName.trim(),
    billMonth: input.archive.billMonth.trim(),
    // 备注留空时不发该字段，与服务端的「空即缺」口径一致。
    ...(input.archive.remark.trim() === '' ? {} : { remark: input.archive.remark.trim() }),
    duplicateAcknowledged: input.duplicateAcknowledged,
    ...(input.supersedesBillId === undefined ? {} : { supersedesBillId: input.supersedesBillId }),
    ...(input.manualRate === null ? {} : { manualForeignUnitsPerCny: input.manualRate }),
  }
}

/**
 * 幂等键生命周期：内容变化必须签发新键，否则同一键配不同内容会被服务端判为冲突；
 * 结果未知（网络中断或 5xx）时保留原键，人工重试才能恢复到同一张账单。
 */
export function resolveSlhBillImportKeyAction(input: {
  signature: string
  pendingSignature: string | null
  settled: 'pending' | 'created' | 'rejected' | 'unknown'
}): SlhBillImportKeyAction {
  if (input.settled === 'unknown') {
    return 'keep'
  }
  if (input.settled === 'created' || input.settled === 'rejected') {
    return 'drop'
  }
  return input.pendingSignature === input.signature ? 'keep' : 'mine'
}

export interface SlhBillArchiveDraft {
  billName: string
  billMonth: string
  remark: string
}

export type SlhBillArchiveFieldError = 'nameRequired' | 'nameTooLong' | 'monthRequired' | 'remarkTooLong'

const BILL_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u

/** 弹窗打开时的草稿：名称与月份用服务端推导的默认值（期间结束月优先），备注留空。 */
export function createSlhBillArchiveDraft(preview: Pick<SlhBillImportPreviewDto, 'suggestedBillName' | 'suggestedBillMonth'>): SlhBillArchiveDraft {
  return { billName: preview.suggestedBillName, billMonth: preview.suggestedBillMonth, remark: '' }
}

/**
 * 归档字段校验，与服务端 DTO 同口径：名称必填且不超长、月份必须是 YYYY-MM、备注不超长。
 * 返回字段到错误标识的映射，空对象表示可提交。
 */
export function validateSlhBillArchiveDraft(draft: SlhBillArchiveDraft): Partial<Record<keyof SlhBillArchiveDraft, SlhBillArchiveFieldError>> {
  const errors: Partial<Record<keyof SlhBillArchiveDraft, SlhBillArchiveFieldError>> = {}
  const name = draft.billName.trim()
  if (name === '') {
    errors.billName = 'nameRequired'
  }
  else if ([...name].length > 200) {
    errors.billName = 'nameTooLong'
  }
  if (!BILL_MONTH_PATTERN.test(draft.billMonth.trim())) {
    errors.billMonth = 'monthRequired'
  }
  if ([...draft.remark.trim()].length > 500) {
    errors.remark = 'remarkTooLong'
  }
  return errors
}

/**
 * 名称被占用时自动加日期后缀（-YYYYMMDD）。
 *
 * 用导入当天而不是账单期间：同一个期间重复导入时，只有导入日期能把两次区分开。
 * 名称已经带同类后缀时先去掉再补，避免叠成「名称-20260927-20260927」。
 */
export function withSlhBillNameSuffix(name: string, now: Date): string {
  const trimmed = name.trim().replace(/-\d{8}$/u, '')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${trimmed}-${now.getFullYear()}${month}${day}`
}
