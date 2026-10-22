import Decimal from 'decimal.js'

/**
 * 海运装柜明细的运费预估口径。
 *
 * 只是运营侧的参考值，不落库、不参与账单复算：费率与附加费/代收手续费都是当前业务口径的固定值，
 * 实际金额仍以顺联航对账单为准。计费材积必须按账单口径向上取整，不能直接使用 DTO 里两位小数的
 * volumeCai；除数和取整方式与服务端 ocean-freight-calculation 保持一致。
 */
export const OCEAN_FREIGHT_VOLUME_RATE_CNY = '30.00'
export const OCEAN_FREIGHT_WEIGHT_RATE_CNY = '5.00'
export const OCEAN_FREIGHT_VOLUME_DIVISOR = 28316n
export const HEAVY_CARGO_THRESHOLD_KG = 150
export const HEAVY_CARGO_SURCHARGE_CNY = '100.00'
export const COD_HANDLING_FEE_CNY = '30.00'

export interface FreightEstimateInput {
  grossWeightKg: string | null
  lengthCm: string | null
  widthCm: string | null
  heightCm: string | null
  packageCount: number
  codAmountTwd: string | null
}

export type FreightEstimateBasis = 'BOTH' | 'VOLUME' | 'WEIGHT'

export interface FreightEstimate {
  volumeCai: number | null
  weightKg: string | null
  byVolume: string | null
  byWeight: string | null
  freight: string | null
  freightBasis: FreightEstimateBasis | null
  surcharge: string | null
  codHandling: string | null
  total: string | null
}

const NON_NEGATIVE_INTEGER = /^\d+$/u

function parseNonNegativeInteger(value: string | null): bigint | null {
  if (value === null || !NON_NEGATIVE_INTEGER.test(value)) {
    return null
  }
  try {
    return BigInt(value)
  }
  catch {
    return null
  }
}

function parsePositiveDecimal(value: string | null): Decimal | null {
  if (value === null || value.trim() === '') {
    return null
  }
  try {
    const parsed = new Decimal(value)
    return parsed.isFinite() && parsed.gt(0) ? parsed : null
  }
  catch {
    return null
  }
}

/** 计费材积：长 × 宽 × 高 × 箱数 ÷ 28316，向上取整。任一尺寸或箱数缺失时返回 null。 */
export function calculateChargeableVolume(input: Pick<FreightEstimateInput, 'lengthCm' | 'widthCm' | 'heightCm' | 'packageCount'>): number | null {
  if (!Number.isSafeInteger(input.packageCount) || input.packageCount <= 0) {
    return null
  }
  const length = parseNonNegativeInteger(input.lengthCm)
  const width = parseNonNegativeInteger(input.widthCm)
  const height = parseNonNegativeInteger(input.heightCm)
  if (length === null || width === null || height === null) {
    return null
  }
  const product = length * width * height * BigInt(input.packageCount)
  if (product <= 0n) {
    return null
  }
  const chargeable = (product + OCEAN_FREIGHT_VOLUME_DIVISOR - 1n) / OCEAN_FREIGHT_VOLUME_DIVISOR
  return chargeable > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(chargeable)
}

/**
 * 运费取「按材积」与「按重量」的较大值；只有一侧资料时取该侧，两侧都缺时不产生任何金额。
 * 附加费仅在毛重达到阈值时出现；毛重缺失无法判断，按缺失处理。代收手续费只在本行有代收时出现。
 */
export function calculateFreightEstimate(input: FreightEstimateInput): FreightEstimate {
  const volumeCai = calculateChargeableVolume(input)
  const weight = parseNonNegativeInteger(input.grossWeightKg)
  const weightKg = weight === null ? null : weight.toString()
  const byVolume = volumeCai === null
    ? null
    : new Decimal(volumeCai).times(OCEAN_FREIGHT_VOLUME_RATE_CNY).toFixed(2)
  const byWeight = weightKg === null
    ? null
    : new Decimal(weightKg).times(OCEAN_FREIGHT_WEIGHT_RATE_CNY).toFixed(2)

  let freightBasis: FreightEstimateBasis | null = null
  let freight: string | null = null
  if (byVolume !== null && byWeight !== null) {
    freightBasis = 'BOTH'
    freight = new Decimal(byVolume).gte(byWeight) ? byVolume : byWeight
  }
  else if (byVolume !== null) {
    freightBasis = 'VOLUME'
    freight = byVolume
  }
  else if (byWeight !== null) {
    freightBasis = 'WEIGHT'
    freight = byWeight
  }

  if (freight === null) {
    return { volumeCai, weightKg, byVolume, byWeight, freight: null, freightBasis: null, surcharge: null, codHandling: null, total: null }
  }

  const surcharge = weight !== null && weight >= BigInt(HEAVY_CARGO_THRESHOLD_KG)
    ? HEAVY_CARGO_SURCHARGE_CNY
    : null
  const codHandling = parsePositiveDecimal(input.codAmountTwd) === null ? null : COD_HANDLING_FEE_CNY
  const total = new Decimal(freight).plus(surcharge ?? 0).plus(codHandling ?? 0).toFixed(2)
  return { volumeCai, weightKg, byVolume, byWeight, freight, freightBasis, surcharge, codHandling, total }
}
