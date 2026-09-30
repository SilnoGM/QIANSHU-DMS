import type { ContainerBatchDto, ContainerBatchUpdateDto, ContainerLoadingItemCreateDto, ContainerLoadingItemDto } from '@/api/generated/types.gen'

export interface ContainerDraft { containerBatchName: string, warehouseValue: string | null, remark: string, sourceFileId: string | null }
export type ContainerSubmission = Omit<ContainerBatchUpdateDto, 'expectedVersion'>
export interface LoadingItemDraft {
  shipmentId: string | null
  goodsName: string
  packageCount: string
  packageUnit: string
  oceanShippingMarkText: string
  warehouseReceiptReference: string
  grossWeightKg: string
  lengthCm: string
  widthCm: string
  heightCm: string
  reportedVolumeCai: string
  recipientName: string
  recipientPhone: string
  recipientAddress: string
  codAmountTwd: string
  remark: string
}
interface RecipientFields { recipientName?: string | null, recipientPhone?: string | null, recipientAddress?: string | null, codAmountTwd?: string | null }
export type LoadingItemSubmission = Omit<ContainerLoadingItemCreateDto, 'expectedVersion'> & RecipientFields
export type FormErrors = Partial<Record<keyof LoadingItemDraft | keyof ContainerDraft, string>>
const optional = (value: string) => value.trim() || null
const validText = (value: string, maximum: number) => !/[\p{Cc}\p{Cs}]/u.test(value) && [...value.trim()].length <= maximum

export function createContainerDraft(batch?: ContainerBatchDto | null): ContainerDraft {
  return { containerBatchName: batch?.containerBatchName ?? '', warehouseValue: batch?.warehouseValue ?? null, remark: batch?.remark ?? '', sourceFileId: batch?.sourceFileId ?? null }
}
export function createLoadingItemDraft(item?: (ContainerLoadingItemDto & RecipientFields) | null): LoadingItemDraft {
  return {
    shipmentId: item?.shipmentId ?? null,
    goodsName: item?.goodsName ?? '',
    packageCount: String(item?.packageCount ?? 1),
    packageUnit: item?.packageUnit ?? '',
    oceanShippingMarkText: item?.oceanShippingMarkText ?? '',
    warehouseReceiptReference: item?.warehouseReceiptReference ?? '',
    grossWeightKg: item?.grossWeightKg ?? '',
    lengthCm: item?.lengthCm ?? '',
    widthCm: item?.widthCm ?? '',
    heightCm: item?.heightCm ?? '',
    reportedVolumeCai: item?.reportedVolumeCai ?? '',
    recipientName: item?.recipientName ?? '',
    recipientPhone: item?.recipientPhone ?? '',
    recipientAddress: item?.recipientAddress ?? '',
    codAmountTwd: item?.codAmountTwd ?? '',
    remark: item?.remark ?? '',
  }
}
export function validateContainerDraft(draft: ContainerDraft, requireSource = false): FormErrors {
  const errors: FormErrors = {}
  const match = /^(\d{2})(\d{2})(?:-(\d{2}))?柜子?$/u.exec(draft.containerBatchName.trim())
  // 这里只排除不可能的月日；具体年份和闰年以服务端持久化口径为准。
  const date = match ? new Date(Date.UTC(2000, Number(match[1]) - 1, Number(match[2]))) : null
  if (!match || date?.getUTCMonth() !== Number(match[1]) - 1 || date?.getUTCDate() !== Number(match[2]) || (match[3] && Number(match[3]) < 1)) {
    errors.containerBatchName = 'nameInvalid'
  }
  if (!draft.warehouseValue) {
    errors.warehouseValue = 'warehouseRequired'
  }
  if (requireSource && !draft.sourceFileId?.trim()) {
    errors.sourceFileId = 'sourceRequired'
  }
  if (!validText(draft.remark, 500)) {
    errors.remark = 'textInvalid'
  }
  return errors
}
/** 精度校验只检查十进制字符串，禁止以 JS Number 改写用户输入的重量和金额。 */
export function validDecimal(value: string, precision: number, scale: number, positive: boolean): boolean {
  if (!value.trim()) {
    return true
  }
  const raw = value.trim()
  if (!/^\d+(?:\.\d+)?$/u.test(raw)) {
    return false
  }
  const [whole = '', fraction = ''] = raw.split('.')
  if (fraction.length > scale || whole.replace(/^0+/u, '').length > precision - scale) {
    return false
  }
  return !positive || /[1-9]/u.test(raw)
}
export function validateLoadingItemDraft(draft: LoadingItemDraft): FormErrors {
  const errors: FormErrors = {}
  const limits = { goodsName: 255, packageUnit: 32, oceanShippingMarkText: 128, warehouseReceiptReference: 500, recipientName: 128, recipientPhone: 128, recipientAddress: 2000, remark: 500 } as const
  for (const [key, maximum] of Object.entries(limits)) {
    if (!validText(draft[key as keyof typeof limits], maximum)) {
      errors[key as keyof typeof limits] = 'textInvalid'
    }
  }
  if (!draft.goodsName.trim()) {
    errors.goodsName = 'goodsRequired'
  }
  if (!/^\d+$/u.test(draft.packageCount) || Number(draft.packageCount) < 1 || Number(draft.packageCount) > 1_000_000) {
    errors.packageCount = 'countInvalid'
  }
  if (!validDecimal(draft.grossWeightKg, 18, 3, true)) {
    errors.grossWeightKg = 'measurementInvalid'
  }
  // 每件尺寸与账单表同口径：两位小数；毛重仍按三位小数。
  for (const key of ['lengthCm', 'widthCm', 'heightCm'] as const) {
    if (!validDecimal(draft[key], 18, 2, true)) {
      errors[key] = 'measurementInvalid'
    }
  }
  if (!validDecimal(draft.reportedVolumeCai, 24, 8, false)) {
    errors.reportedVolumeCai = 'volumeInvalid'
  }
  if (!validDecimal(draft.codAmountTwd, 30, 2, false)) {
    errors.codAmountTwd = 'codInvalid'
  }
  return errors
}
export function buildContainerSubmission(draft: ContainerDraft): ContainerSubmission {
  return { containerBatchName: draft.containerBatchName.trim(), warehouseValue: draft.warehouseValue ?? '', remark: optional(draft.remark), sourceFileId: draft.sourceFileId }
}
export function buildLoadingItemSubmission(draft: LoadingItemDraft): LoadingItemSubmission {
  return {
    shipmentId: draft.shipmentId,
    goodsName: draft.goodsName.trim(),
    packageCount: Number(draft.packageCount),
    packageUnit: optional(draft.packageUnit),
    oceanShippingMarkText: optional(draft.oceanShippingMarkText),
    warehouseReceiptReference: optional(draft.warehouseReceiptReference),
    grossWeightKg: optional(draft.grossWeightKg),
    lengthCm: optional(draft.lengthCm),
    widthCm: optional(draft.widthCm),
    heightCm: optional(draft.heightCm),
    reportedVolumeCai: optional(draft.reportedVolumeCai),
    recipientName: optional(draft.recipientName),
    recipientPhone: optional(draft.recipientPhone),
    recipientAddress: optional(draft.recipientAddress),
    codAmountTwd: optional(draft.codAmountTwd),
    remark: optional(draft.remark),
  }
}

/** 关联主键只用于提交，界面只展示有业务意义的唛头或货件号。 */
export function resolveShipmentDisplay(
  shipmentId: string | null,
  shipment: { id: string, shippingMarkText: string | null, shipmentNo: string | null } | null,
  item: { shipmentId: string | null, shippingMark: string | null, shipmentNo: string | null } | null,
): string | null {
  if (!shipmentId) {
    return null
  }
  if (shipment?.id === shipmentId) {
    return shipment.shippingMarkText || shipment.shipmentNo || null
  }
  if (item?.shipmentId === shipmentId) {
    return item.shippingMark || item.shipmentNo || null
  }
  return null
}

/** 仅用于表单预览；正式日期仍由服务端根据创建时间推断并持久化。 */
export function previewContainerDate(name: string, referenceDate = new Date()): string | null {
  if (!Number.isFinite(referenceDate.getTime())) {
    return null
  }
  const match = /^(\d{2})(\d{2})(?:-(\d{2}))?柜子?$/u.exec(name.trim())
  if (!match || (match[3] && Number(match[3]) < 1)) {
    return null
  }
  const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(referenceDate))
  const date = new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2])))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(match[1]) - 1 || date.getUTCDate() !== Number(match[2])) {
    return null
  }
  return `${year}-${match[1]}-${match[2]}`
}

/** 只采用文件名中唯一且日期有效的柜次，避免误取长编号片段或多柜汇总文件。 */
export function inferContainerNameFromFilename(filename: string, referenceDate = new Date()): string | null {
  const matches = [...filename.matchAll(/(?<!\d)(\d{4}(?:-\d{2})?)[柜櫃]子?/gu)]
  if (matches.length !== 1) {
    return null
  }
  const name = `${matches[0]![1]}柜`
  return previewContainerDate(name, referenceDate) ? name : null
}
