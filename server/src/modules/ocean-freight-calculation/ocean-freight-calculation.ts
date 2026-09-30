import {
  formatDecimal, money, normalizeOceanDecimal, OceanCalculationError,
  parseDecimal, parseMoney, positiveInteger, power, roundRatio,
} from './ocean-decimal'
import type {
  CalculatedOceanCharge, OceanChargeCargo, OceanChargeInput, OceanCodInput,
  OceanLineInput, OceanLineResult, OceanVolumeInput,
} from './ocean-freight-calculation.types'

export { normalizeOceanDecimal, OceanCalculationError } from './ocean-decimal'
export type * from './ocean-freight-calculation.types'

/**
 * 材积分母。账单表与装柜明细的来源表格都按“长 × 宽 × 高 ÷ 28316 × 箱数”计算材数，
 * 两个模块共用同一常量，避免任何一侧单独调整后再次出现口径差。
 */
export const VOLUME_CAI_DIVISOR = 28316n

/** 材积记录精度：与账单表口径一致，非按材积计价时保留两位小数。 */
export const VOLUME_CAI_SCALE = 2

/** 尺寸精度：账单表与装柜明细都按两位小数记录每件尺寸。 */
export const VOLUME_DIMENSION_SCALE = 2

const VOLUME_CAI_STORAGE_SCALE = 8

/**
 * 按记录精度比较两侧材积：两个入参都已是记录精度（两位小数）的定点值，直接相减。
 * 账单表与装柜明细共用这一口径，来源多余的小数位不构成差异。
 */
export function volumeDifferenceAtRecordScale(volumeUnits: bigint, reportedUnits: bigint): bigint {
  return volumeUnits - reportedUnits
}

export function calculateOceanVolume(input: OceanVolumeInput) {
  const dimensions = ['lengthCm', 'widthCm', 'heightCm'] as const
  const values = dimensions.map(field => normalizeOceanDecimal(input[field], 18, VOLUME_DIMENSION_SCALE, field, true))
  const reported = normalizeOceanDecimal(input.reportedVolumeCai, 24, VOLUME_CAI_SCALE, 'reportedVolumeCai')
  if (input.packageCount !== null) positiveInteger(input.packageCount, 'packageCount')
  if (values.some(value => value === null) || input.packageCount === null) {
    return { volumeCai: null, chargeableVolumeCai: null, volumeDifferenceCai: null }
  }
  const product = values.reduce<bigint>((result, value) => result * parseDecimal(value!, 18, VOLUME_DIMENSION_SCALE, 'dimensions'), BigInt(input.packageCount))
  // 三个尺寸各放大 10^2，立方后为 10^6；分母保持同一 scale 才能直接比较。
  const denominator = VOLUME_CAI_DIVISOR * power(VOLUME_DIMENSION_SCALE * 3)
  // 按材积计价时材积就是计费数量，必须向上取整；不按材积计价时按记录精度保留两位小数。
  const chargeable = (product + denominator - 1n) / denominator
  if (chargeable > 2147483647n) throw new OceanCalculationError('chargeableVolumeCai', true)
  // 舍入按记录精度进行，结果放大回落库精度后再格式化，避免用落库精度取值。
  const volume = roundRatio(product * power(VOLUME_CAI_SCALE), denominator) * power(VOLUME_CAI_STORAGE_SCALE - VOLUME_CAI_SCALE)
  // Decimal(24,8) 落库值仍须大于零；过小尺寸不能以零材积通过后再触发数据库约束。
  if (volume === 0n) throw new OceanCalculationError('volumeCai')
  return {
    volumeCai: formatDecimal(volume, 24, VOLUME_CAI_STORAGE_SCALE, 'volumeCai'),
    chargeableVolumeCai: Number(chargeable),
    volumeDifferenceCai: reported === null ? null : formatDecimal(
      volumeDifferenceAtRecordScale(volume / power(VOLUME_CAI_STORAGE_SCALE - VOLUME_CAI_SCALE), parseDecimal(reported, 24, VOLUME_CAI_SCALE, 'reportedVolumeCai')),
      24, VOLUME_CAI_SCALE, 'volumeDifferenceCai'),
  }
}

export function calculateOceanCharge(input: OceanChargeInput, cargo: OceanChargeCargo): CalculatedOceanCharge {
  if (!['WEIGHT', 'VOLUME', 'FIXED'].includes(input.pricingBasis)) throw new OceanCalculationError('pricingBasis')
  if (!['CNY', 'TWD'].includes(input.currencyCode)) throw new OceanCalculationError('currencyCode')
  if (!['NORMAL', 'SUPPLEMENT', 'DEDUCTION'].includes(input.chargeNature)) throw new OceanCalculationError('chargeNature')
  let quantity: bigint | null = null
  let unitPrice: bigint | null = null
  let amount: bigint
  if (input.pricingBasis === 'FIXED') {
    if (input.amount === null || input.amount === undefined || input.unitPriceAmount != null) throw new OceanCalculationError('amount')
    amount = parseMoney(input.amount)
  } else {
    if (input.amount != null || input.unitPriceAmount == null) throw new OceanCalculationError('unitPriceAmount')
    unitPrice = parseDecimal(input.unitPriceAmount, 30, 6, 'unitPriceAmount')
    if (input.pricingBasis === 'WEIGHT') {
      if (cargo.grossWeightKg === null) throw new OceanCalculationError('grossWeightKg')
      const weight = parseDecimal(cargo.grossWeightKg, 18, 3, 'grossWeightKg')
      if (weight <= 0n) throw new OceanCalculationError('grossWeightKg')
      quantity = weight * power(5)
    } else {
      if (cargo.chargeableVolumeCai === null) throw new OceanCalculationError('chargeableVolumeCai')
      quantity = BigInt(positiveInteger(cargo.chargeableVolumeCai, 'chargeableVolumeCai')) * power(8)
    }
    amount = roundRatio(quantity * unitPrice, power(12))
  }
  const reported = input.reportedAmount == null ? null : parseMoney(input.reportedAmount, 'reportedAmount', true)
  const effective = input.chargeNature === 'DEDUCTION' ? -amount : amount
  return {
    currencyCode: input.currencyCode,
    amount: money(amount),
    effectiveAmount: money(effective),
    chargeableQuantity: quantity === null ? null : formatDecimal(quantity, 24, 8, 'chargeableQuantity'),
    unitPriceAmount: unitPrice === null ? null : formatDecimal(unitPrice, 30, 6, 'unitPriceAmount'),
    reportedAmount: reported === null ? null : money(reported, 'reportedAmount'),
    // 来源费用保留其原始正负方向，差异按有效费用比较，避免把减免重复反转。
    amountDifference: reported === null ? null : money(effective - reported, 'amountDifference'),
  }
}

function exchangeRate(input: string): bigint {
  const rate = parseDecimal(input, 30, 12, 'twdPerCny')
  if (rate <= 0n) throw new OceanCalculationError('twdPerCny')
  return rate
}

export function calculateOceanLine(input: OceanLineInput & { twdPerCny: string }): OceanLineResult {
  const rate = exchangeRate(input.twdPerCny)
  const cod = input.codAmountTwd === null ? null : parseMoney(input.codAmountTwd, 'codAmountTwd')
  let twd: bigint | null = null
  let cny: bigint | null = null
  if (input.charges !== null) {
    twd = 0n
    cny = 0n
    for (const charge of input.charges) {
      const value = parseMoney(charge.effectiveAmount, 'effectiveAmount', true)
      if (charge.currencyCode === 'TWD') twd += value
      else if (charge.currencyCode === 'CNY') cny += value
      else throw new OceanCalculationError('currencyCode')
    }
  }
  const converted = cod === null || twd === null ? null : roundRatio((cod - twd) * power(12), rate)
  return {
    codAmountTwd: cod === null ? null : money(cod, 'codAmountTwd'),
    chargeTotalAmountTwd: twd === null ? null : money(twd, 'chargeTotalAmountTwd'),
    payableAmountCny: cny === null ? null : money(cny, 'payableAmountCny'),
    returnAmountCny: converted === null ? null : money(converted, 'returnAmountCny'),
    netReturnAmountCny: converted === null || cny === null ? null : money(converted - cny, 'netReturnAmountCny'),
  }
}

export function calculateOceanBill(input: { lines: readonly OceanLineInput[]; twdPerCny: string }) {
  const rate = exchangeRate(input.twdPerCny)
  const lines = input.lines.map(line => calculateOceanLine({ ...line, twdPerCny: input.twdPerCny }))
  const sum = (field: keyof OceanLineResult): string | null => {
    if (lines.length === 0 || lines.some(line => line[field] === null)) return null
    return money(lines.reduce((total, line) => total + parseMoney(line[field]!, field, true), 0n), field)
  }
  const codTotalAmountTwd = sum('codAmountTwd')
  const chargeTotalAmountTwd = sum('chargeTotalAmountTwd')
  const returnAmountCny = sum('returnAmountCny')
  const wholeReturn = codTotalAmountTwd === null || chargeTotalAmountTwd === null ? null
    : roundRatio((parseMoney(codTotalAmountTwd) - parseMoney(chargeTotalAmountTwd, 'chargeTotalAmountTwd', true)) * power(12), rate)
  return {
    codTotalAmountTwd, chargeTotalAmountTwd,
    payableAmountCny: sum('payableAmountCny'), returnAmountCny,
    netReturnAmountCny: sum('netReturnAmountCny'),
    roundingDifferenceCny: returnAmountCny === null || wholeReturn === null ? null
      : money(parseMoney(returnAmountCny, 'returnAmountCny', true) - wholeReturn, 'roundingDifferenceCny'),
  }
}

export function resolveOceanCod(input: OceanCodInput) {
  if (!['NORMAL', 'ADJUSTMENT'].includes(input.lineType)) throw new OceanCalculationError('lineType')
  if (!['CURRENT', 'HISTORICAL_REFERENCE', 'UNRESOLVED'].includes(input.meaning)) throw new OceanCalculationError('meaning')
  const reportedCodAmountTwd = normalizeOceanDecimal(input.reportedCodAmountTwd, 30, 2, 'reportedCodAmountTwd')
  if (input.meaning === 'HISTORICAL_REFERENCE' && input.lineType !== 'ADJUSTMENT') throw new OceanCalculationError('meaning')
  return {
    reportedCodAmountTwd,
    codAmountTwd: input.meaning === 'UNRESOLVED' || reportedCodAmountTwd === null ? null : input.meaning === 'HISTORICAL_REFERENCE' ? '0.00' : reportedCodAmountTwd,
  }
}
