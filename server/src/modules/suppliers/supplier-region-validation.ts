import { RegionLevel } from '../../generated/prisma/enums'
import {
  type LockedRegionReference,
  RegionLookupService,
} from '../regions/region-lookup.service'
import {
  createSupplierApiException,
  SUPPLIER_ERROR_CODES,
} from './supplier.errors'
import type {
  NormalizedSupplierPrimaryAddress,
  NormalizedSupplierRegistration,
} from './supplier.normalizer'

export interface SupplierRegionValidationInput {
  readonly registration: NormalizedSupplierRegistration | null
  readonly primaryAddress: NormalizedSupplierPrimaryAddress | null
}

function collectRegionIds(input: SupplierRegionValidationInput): string[] {
  return [
    input.registration?.countryRegionId,
    input.primaryAddress?.countryRegionId,
    input.primaryAddress?.provinceStateId,
    input.primaryAddress?.cityId,
  ].filter((value): value is string => value !== null && value !== undefined)
}

/** 新增或变化的 Region 引用必须在调用方事务内锁定并验证完整层级与有效性。 */
export async function validateSupplierRegionReferences(
  regionLookup: RegionLookupService,
  transaction: Parameters<RegionLookupService['lockReferences']>[0],
  input: SupplierRegionValidationInput,
): Promise<void> {
  const regions = await regionLookup.lockReferences(
    transaction,
    collectRegionIds(input),
  )
  const registration = input.registration
  if (registration !== null) {
    const country = regions.get(registration.countryRegionId)
    if (
      country === undefined
      || country.level !== RegionLevel.COUNTRY_REGION
      || country.parentId !== null
    ) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
    }
    if (!country.effectiveEnabled) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_UNAVAILABLE)
    }
  }

  const address = input.primaryAddress
  if (address === null) return
  if (address.countryRegionId === null) {
    if (address.provinceStateId !== null || address.cityId !== null) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
    }
    return
  }
  const country = regions.get(address.countryRegionId)
  if (
    country === undefined
    || country.level !== RegionLevel.COUNTRY_REGION
    || country.parentId !== null
  ) {
    throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
  }

  let province: LockedRegionReference | undefined
  if (address.provinceStateId === null) {
    if (address.cityId !== null) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
    }
  } else {
    province = regions.get(address.provinceStateId)
    if (
      province === undefined
      || province.level !== RegionLevel.PROVINCE_STATE
      || province.parentId !== country.id
    ) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
    }
  }

  let city: LockedRegionReference | undefined
  if (address.cityId !== null) {
    city = regions.get(address.cityId)
    if (
      province === undefined
      || city === undefined
      || city.level !== RegionLevel.CITY
      || city.parentId !== province.id
    ) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
    }
  }
  if (!country.effectiveEnabled
    || (province !== undefined && !province.effectiveEnabled)
    || (city !== undefined && !city.effectiveEnabled)
  ) {
    throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_UNAVAILABLE)
  }
}
