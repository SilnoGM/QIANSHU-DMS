import { ApiException } from '../../infrastructure/http/api.exception'
import { VOLUME_CAI_DIVISOR } from '../ocean-freight-calculation/ocean-freight-calculation'
import { formatDecimal, parseDecimal, power, roundRatio } from '../ocean-freight-calculation/ocean-decimal'

/** 账单来源数据的精度口径：尺寸 2 位、重量 3 位、金额 2 位、材积 2 位。 */
export const SLH_DIMENSION_SCALE = 2
export const SLH_WEIGHT_SCALE = 3
export const SLH_AMOUNT_SCALE = 2
export const SLH_VOLUME_SCALE = 2
export const SLH_AMOUNT_PRECISION = 30
export const SLH_VOLUME_PRECISION = 24

/**
 * 账单口径的材积分母：长 × 宽 × 高 ÷ 28316 × 箱数。装柜明细使用同一个常量
 * （`VOLUME_CAI_DIVISOR`），两侧不得再各自维护除数。
 */
export const SLH_VOLUME_DIVISOR = VOLUME_CAI_DIVISOR

/** 单价超过该阈值即按材积计价；这是对方账单公式里的隐式约定，不是可配置项。 */
export const SLH_VOLUME_PRICING_THRESHOLD = 10

const DECIMAL_PATTERN = /^-?\d+(?:\.(\d*))?$/u

export type SlhPricingBasisValue = 'WEIGHT' | 'VOLUME'

export function slhBillFailure(code: string, message: string, status = 422): never {
  throw new ApiException(status, code, message)
}

export interface SlhVolumeInput {
  lengthCm: string | null
  widthCm: string | null
  heightCm: string | null
  packageCount: number
}

function dimension(value: string | null, field: string): bigint | null {
  return value === null ? null : parseDecimal(value, 18, SLH_DIMENSION_SCALE, field, true)
}

/**
 * 复算材积的精确有理数（未取整）。返回 null 表示尺寸缺失，无法复算。
 * 分子按尺寸 scale 放大，因此比较与取整都必须用同一分母。
 */
export function slhVolumeRatio(input: SlhVolumeInput): { numerator: bigint, denominator: bigint } | null {
  const values = [dimension(input.lengthCm, 'lengthCm'), dimension(input.widthCm, 'widthCm'), dimension(input.heightCm, 'heightCm')]
  if (values.some(value => value === null)) return null
  if (!Number.isInteger(input.packageCount) || input.packageCount < 1) slhBillFailure('VALIDATION_FAILED', '箱数必须是正整数')
  const product = values.reduce<bigint>((result, value) => result * value!, BigInt(input.packageCount))
  // 三个尺寸各放大 10^2，立方后为 10^6；分母保持同一 scale 才能直接比较。
  return { numerator: product, denominator: SLH_VOLUME_DIVISOR * power(SLH_DIMENSION_SCALE * 3) }
}

/** 计价方式由单价推导；单价缺失的明细行没有计价方式，也没有人民币运费。 */
export function deriveSlhPricingBasis(unitPriceAmount: string | null): SlhPricingBasisValue | null {
  if (unitPriceAmount === null) return null
  const unitPrice = parseDecimal(unitPriceAmount, SLH_AMOUNT_PRECISION, SLH_AMOUNT_SCALE, 'unitPriceAmount', true)
  return unitPrice > BigInt(SLH_VOLUME_PRICING_THRESHOLD) * power(SLH_AMOUNT_SCALE) ? 'VOLUME' : 'WEIGHT'
}

/**
 * 按计价方式记录材积：按重量计价的行只是信息，四舍五入到 2 位小数；
 * 按材积计价的行材积就是计费数量，必须向上取整。
 */
export function recordSlhVolume(ratio: { numerator: bigint, denominator: bigint }, basis: SlhPricingBasisValue): string {
  // 向上取整得到的是计费数量本身，需按记录精度放大后才能交给同一格式化路径。
  const value = basis === 'VOLUME'
    ? ((ratio.numerator + ratio.denominator - 1n) / ratio.denominator) * power(SLH_VOLUME_SCALE)
    : roundRatio(ratio.numerator * power(SLH_VOLUME_SCALE), ratio.denominator)
  return formatDecimal(value, SLH_VOLUME_PRECISION, SLH_VOLUME_SCALE, 'volumeCai')
}

/** 把「分子/分母」的精确比值按金额精度落值；分子分母须来自同一 scale 的乘积。 */
export function slhRounding(numerator: bigint, denominator: bigint): string {
  return formatDecimal(
    roundRatio(numerator * power(SLH_AMOUNT_SCALE), denominator),
    SLH_AMOUNT_PRECISION, SLH_AMOUNT_SCALE, 'amount',
  )
}

export interface SlhFreightInput {
  unitPriceAmount: string | null
  pricingBasis: SlhPricingBasisValue | null
  grossWeightKg: string | null
  volumeCai: string | null
}

/**
 * 复算运费：按重量计价用毛重，按材积计价用向上取整后的材积。
 * 单价缺失时账单本身记 0，本模块同样返回 0，不视为错误。
 */
export function calculateSlhFreight(input: SlhFreightInput): string {
  if (input.unitPriceAmount === null || input.pricingBasis === null) {
    return formatDecimal(0n, SLH_AMOUNT_PRECISION, SLH_AMOUNT_SCALE, 'freightAmountCny')
  }
  const unitPrice = parseDecimal(input.unitPriceAmount, SLH_AMOUNT_PRECISION, SLH_AMOUNT_SCALE, 'unitPriceAmount', true)
  if (input.pricingBasis === 'VOLUME') {
    if (input.volumeCai === null) slhBillFailure('SLH_BILL_VOLUME_UNAVAILABLE', '按材积计价的明细缺少材积')
    const quantity = parseDecimal(input.volumeCai, SLH_VOLUME_PRECISION, SLH_VOLUME_SCALE, 'volumeCai', true)
    return slhRounding(unitPrice * quantity, power(SLH_AMOUNT_SCALE + SLH_VOLUME_SCALE))
  }
  if (input.grossWeightKg === null) slhBillFailure('SLH_BILL_WEIGHT_UNAVAILABLE', '按重量计价的明细缺少出货重量')
  const weight = parseDecimal(input.grossWeightKg, 18, SLH_WEIGHT_SCALE, 'grossWeightKg', true)
  return slhRounding(unitPrice * weight, power(SLH_AMOUNT_SCALE + SLH_WEIGHT_SCALE))
}

/** 合计应付金额 = 运费 + 代收手续费 + 附加费；三项都是 2 位小数，相加不需要再取整。 */
export function calculateSlhPayable(freightAmountCny: string, codHandlingAmountCny: string, surchargeAmountCny: string): string {
  return sumSlhAmounts([freightAmountCny, codHandlingAmountCny, surchargeAmountCny])
}

export function sumSlhAmounts(values: readonly string[]): string {
  return formatDecimal(
    values.reduce((sum, value) => sum + parseDecimal(value, SLH_AMOUNT_PRECISION, SLH_AMOUNT_SCALE, 'amount', true), 0n),
    SLH_AMOUNT_PRECISION, SLH_AMOUNT_SCALE, 'total',
  )
}

/** 两值是否在金额精度内一致；用于逐行差异比对，避免用浮点比较。 */
export function slhAmountsEqual(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right
  return normalizeToScale(left, SLH_AMOUNT_SCALE) === normalizeToScale(right, SLH_AMOUNT_SCALE)
}

/** 材积按记录精度比较；账单原值可能给到更多位小数，必须先归一否则无法比较。 */
export function slhVolumesEqual(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right
  return normalizeToScale(left, SLH_VOLUME_SCALE) === normalizeToScale(right, SLH_VOLUME_SCALE)
}

/** 把来源金额归一到记录精度并返回字符串；来源位数不受本模块精度限制。 */
export function slhNormalizeAmount(value: string): string {
  return formatDecimal(normalizeToScale(value, SLH_AMOUNT_SCALE), SLH_AMOUNT_PRECISION, SLH_AMOUNT_SCALE, 'amount')
}

/** 把来源小数按指定 scale 归一（半值远离零）。账单原值的位数不受本模块精度约束。 */
function normalizeToScale(value: string, scale: number): bigint {
  const trimmed = value.trim()
  const match = trimmed.match(DECIMAL_PATTERN)
  if (match === null) slhBillFailure('SLH_BILL_NUMBER_INVALID', '账单数值不是有效的十进制小数')
  const negative = trimmed.startsWith('-')
  const [whole, fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.')
  const kept = fraction.slice(0, scale).padEnd(scale, '0')
  const dropped = fraction.slice(scale)
  let scaled = BigInt(whole) * power(scale) + BigInt(kept || '0')
  if (dropped.length > 0 && Number(dropped[0]) >= 5) scaled += 1n
  return negative ? -scaled : scaled
}

/** 源单元格小数位数；用于在精度被截断前给出告警而不是静默取整。 */
export function sourceDecimalPlaces(value: string | null): number {
  const match = value === null ? null : value.trim().match(DECIMAL_PATTERN)
  return match ? (match[1]?.length ?? 0) : 0
}
