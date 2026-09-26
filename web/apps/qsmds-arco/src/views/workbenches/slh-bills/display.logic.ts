import type { SlhBillLineChargeDto, SlhBillLineDto } from '@/api/generated/types.gen'
import { formatContainerMeasurement } from '../containers/display.logic'

/** 汇率与材积一律 2 位小数展示，只格式化不回写，计费继续使用服务端原始精度。 */
export function formatSlhBillRate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  return formatContainerMeasurement(value, 2)
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

/** 重量与单位同源展示；单位缺失时只显示数值，不猜测单位。 */
export function formatSlhBillWeight(line: Pick<SlhBillLineDto, 'grossWeightKg' | 'weightUnit'>): string | null {
  const weight = line.grossWeightKg ?? null
  if (weight === null) {
    return null
  }
  const unit = line.weightUnit ?? null
  return unit === null ? weight : `${weight} ${unit}`
}
