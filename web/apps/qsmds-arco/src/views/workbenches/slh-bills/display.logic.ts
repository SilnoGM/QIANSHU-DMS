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

/** 柜号清单默认最多铺 12 个标签；再多就折叠，避免清单把信息卡撑高。 */
export const SLH_BILL_CONTAINER_BATCH_PREVIEW_LIMIT = 12

export interface SlhBillContainerBatchPreview {
  visible: string[]
  hiddenCount: number
}

/** 超出阈值的柜号不渲染，只报告剩余数量，展开入口由调用方提供。 */
export function resolveSlhBillContainerBatchPreview(
  names: readonly string[],
  limit: number = SLH_BILL_CONTAINER_BATCH_PREVIEW_LIMIT,
): SlhBillContainerBatchPreview {
  const normalizedLimit = Math.max(0, Math.trunc(limit))
  if (names.length <= normalizedLimit) {
    return { hiddenCount: 0, visible: [...names] }
  }
  return { hiddenCount: names.length - normalizedLimit, visible: names.slice(0, normalizedLimit) }
}

/**
 * 尺寸按整厘米读：去掉无意义的小数位（`240.00` → `240`），真有小数的原样保留
 * （不四舍五入，避免把 108.5 显示成 109）。非数值原样返回 null，由调用方给占位符。
 */
export function formatSlhBillDimensionValue(value: string): string | null {
  const trimmed = value.trim()
  if (!/^[+-]?\d+(?:\.\d+)?$/u.test(trimmed)) {
    return null
  }
  // 只在确实带小数点时剥尾零：整数不能剥，否则 100 会被剥成 1。
  return trimmed.includes('.') ? trimmed.replace(/\.?0+$/u, '') : trimmed
}

/** 尺寸缺任一边即视为不完整，避免用 0 补位后冒充账单原始尺寸。 */
export function formatSlhBillDimensions(line: Pick<SlhBillLineDto, 'lengthCm' | 'widthCm' | 'heightCm'>): string | null {
  const length = line.lengthCm ?? null
  const width = line.widthCm ?? null
  const height = line.heightCm ?? null
  if (length === null || width === null || height === null) {
    return null
  }
  const sides = [length, width, height].map(formatSlhBillDimensionValue)
  if (sides.includes(null)) {
    return null
  }
  // 三个维度之间不留空格，核对时更紧凑也便于整列扫读。
  return sides.join('×')
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

/** 无法折算时的空值：既缺金额也缺汇率，或汇率是 0（除零）。 */
function parseDecimalOrNull(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null
  }
  try {
    return new Decimal(value)
  }
  catch {
    return null
  }
}

/**
 * 折算净额：把不折算净额按账单内嵌汇率折成人民币，与详情页对比区同一口径（2 位小数、half-up）。
 * 没有内嵌汇率、金额缺失或汇率为 0 时返回 null——调用方据此退回不折算的台币原值，不要用 0 冒充。
 */
export function resolveSlhBillFoldedNetAmount(
  netTwd: string | null | undefined,
  embeddedForeignUnitsPerCny: string | null | undefined,
): string | null {
  const net = parseDecimalOrNull(netTwd)
  const rate = parseDecimalOrNull(embeddedForeignUnitsPerCny)
  if (net === null || rate === null || rate.isZero()) {
    return null
  }
  return net.dividedBy(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
}

export interface SlhBillNetDisplay {
  amount: string
  currency: 'CNY' | 'TWD'
}

/** 列表「折算净额」列：有内嵌汇率时出人民币折算值，否则退回不折算的台币原值（币种随之变化）。 */
export function resolveSlhBillNetDisplay(item: {
  reportedNetAmountTwd: string
  embeddedForeignUnitsPerCny?: string | null
}): SlhBillNetDisplay {
  const folded = resolveSlhBillFoldedNetAmount(item.reportedNetAmountTwd, item.embeddedForeignUnitsPerCny ?? null)
  return folded === null
    ? { amount: item.reportedNetAmountTwd, currency: 'TWD' }
    : { amount: folded, currency: 'CNY' }
}
