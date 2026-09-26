import type { SlhBillLineChargeDto, SlhBillLineDto } from '@/api/generated/types.gen'
import Decimal from 'decimal.js'
import { formatContainerMeasurement } from '../containers/display.logic'

/** 金额、汇率与材积一律 2 位小数展示，只格式化不回写，计费继续使用服务端原始精度。 */
export function formatSlhBillRate(value: string | null | undefined): string | null {
  // 空串与缺失同义；不守这一层的话十进制解析会把空串当非法输入抛错。
  if (value === null || value === undefined || value.trim() === '') {
    return null
  }
  return formatContainerMeasurement(value, 2)
}

/**
 * 金额展示统一 2 位小数。
 * 账单来源的字符串会省略小数位（如 '4425'），直接输出会让列里数字长短不一。
 */
export function formatSlhBillAmount(value: string | null | undefined): string | null {
  return formatSlhBillRate(value)
}

/** 材积留痕按账单口径保存 8 位以上小数，展示统一收敛到 2 位。 */
export function formatSlhBillVolume(value: string | null | undefined): string | null {
  return formatSlhBillRate(value)
}

export interface SlhBillChargeGroup {
  currencyCode: SlhBillLineChargeDto['currencyCode']
  items: SlhBillLineChargeDto[]
}

/** 费用明细按币种分组，人民币在前台币在后，组内保持来源顺序。 */
export function groupSlhBillCharges(charges: readonly SlhBillLineChargeDto[]): SlhBillChargeGroup[] {
  return (['CNY', 'TWD'] as const).flatMap((currencyCode) => {
    const items = charges.filter(charge => charge.currencyCode === currencyCode)
    return items.length === 0 ? [] : [{ currencyCode, items }]
  })
}

/** 尺寸缺任一边即视为不完整，避免用 0 补位后冒充账单原始尺寸。 */
export function formatSlhBillDimensions(line: Pick<SlhBillLineDto, 'lengthCm' | 'widthCm' | 'heightCm'>): string | null {
  const length = line.lengthCm ?? null
  const width = line.widthCm ?? null
  const height = line.heightCm ?? null
  if (length === null || width === null || height === null) {
    return null
  }
  return `${length} × ${width} × ${height}`
}

/** 重量与单位同源展示；单位缺失时只显示数值，不猜测单位。数值按 2 位小数展示。 */
export function formatSlhBillWeight(line: Pick<SlhBillLineDto, 'grossWeightKg' | 'weightUnit'>): string | null {
  const weight = formatSlhBillAmount(line.grossWeightKg ?? null)
  if (weight === null) {
    return null
  }
  const unit = line.weightUnit ?? null
  return unit === null ? weight : `${weight} ${unit}`
}

export type SlhBillVolumeDifferenceTone = 'over' | 'under' | 'even'

export interface SlhBillVolumeDifference {
  tone: SlhBillVolumeDifferenceTone
  /** 带符号的 2 位小数差值文本；相等时为空串，由界面显示占位符。 */
  text: string
}

/**
 * 材积差异 = 系统计算材积 − 账单自报材积。
 * 正数表示账单写少了（我们算得更多），负数表示账单写多了；相等时不下发数值。
 */
export function resolveSlhBillVolumeDifference(line: Pick<SlhBillLineDto, 'volumeCai' | 'reportedVolumeCai'>): SlhBillVolumeDifference | null {
  const calculated = line.volumeCai ?? null
  const reported = line.reportedVolumeCai ?? null
  if (calculated === null || reported === null) {
    return null
  }
  const difference = new Decimal(calculated).minus(reported).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  if (difference.isZero()) {
    return { text: '', tone: 'even' }
  }
  return {
    text: `${difference.isPositive() ? '+' : '-'}${difference.abs().toFixed(2)}`,
    tone: difference.isPositive() ? 'over' : 'under',
  }
}
