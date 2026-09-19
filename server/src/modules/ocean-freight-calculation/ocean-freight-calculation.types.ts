export interface OceanVolumeInput {
  lengthCm: string | null
  widthCm: string | null
  heightCm: string | null
  packageCount: number | null
  reportedVolumeCai: string | null
}

export interface OceanChargeInput {
  pricingBasis: 'WEIGHT' | 'VOLUME' | 'FIXED'
  currencyCode: 'CNY' | 'TWD'
  chargeNature: 'NORMAL' | 'SUPPLEMENT' | 'DEDUCTION'
  amount?: string | null
  unitPriceAmount?: string | null
  reportedAmount?: string | null
}

export interface OceanChargeCargo {
  grossWeightKg: string | null
  chargeableVolumeCai: number | null
}

export interface CalculatedOceanCharge {
  currencyCode: 'CNY' | 'TWD'
  amount: string
  effectiveAmount: string
  chargeableQuantity: string | null
  unitPriceAmount: string | null
  reportedAmount: string | null
  amountDifference: string | null
}

export interface OceanLineInput {
  codAmountTwd: string | null
  charges: readonly CalculatedOceanCharge[] | null
}

export interface OceanLineResult {
  codAmountTwd: string | null
  chargeTotalAmountTwd: string | null
  payableAmountCny: string | null
  returnAmountCny: string | null
  netReturnAmountCny: string | null
}

export interface OceanCodInput {
  lineType: 'NORMAL' | 'ADJUSTMENT'
  reportedCodAmountTwd: string | null
  meaning: 'CURRENT' | 'HISTORICAL_REFERENCE' | 'UNRESOLVED'
}
