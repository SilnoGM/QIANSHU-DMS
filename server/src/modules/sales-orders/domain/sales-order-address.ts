import {
  salesOrderRuleFailure,
  salesOrderValidationFailure,
} from './sales-order-errors'

const UNICODE_WHITE_SPACE_PATTERN = /\p{White_Space}+/gu

export function removeSalesOrderAddressWhitespace(value: string): string {
  return value.normalize('NFKC').replace(UNICODE_WHITE_SPACE_PATTERN, '')
}

export interface SalesOrderAddressInput {
  readonly countryRegionName: string
  readonly provinceStateName: string
  readonly cityName: string
  readonly addressDetail: string
}

export interface NormalizedSalesOrderAddress {
  readonly addressDetail: string
  readonly fullAddress: string
}

/**
 * 防重复只处理规范化后的开头，不扫描中间文本，也不尝试模糊删除。这样既硬拦截
 * 重复地区，又不会误伤“高雄市路”等合法的中间地址词。
 */
export function normalizeSalesOrderAddress(
  input: SalesOrderAddressInput,
): NormalizedSalesOrderAddress {
  const countryRegionName = removeSalesOrderAddressWhitespace(
    input.countryRegionName,
  )
  const provinceStateName = removeSalesOrderAddressWhitespace(
    input.provinceStateName,
  )
  const cityName = removeSalesOrderAddressWhitespace(input.cityName)
  const addressDetail = removeSalesOrderAddressWhitespace(input.addressDetail)

  if (addressDetail.length === 0 || [...addressDetail].length > 1000) {
    return salesOrderValidationFailure('customer.addressDetail')
  }
  const regionPrefixes = [
    `${countryRegionName}${provinceStateName}${cityName}`,
    `${provinceStateName}${cityName}`,
    cityName,
  ].filter(prefix => prefix.length > 0)
  if (regionPrefixes.some(prefix => addressDetail.startsWith(prefix))) {
    return salesOrderRuleFailure(
      'ADDRESS_DETAIL_CONTAINS_SELECTED_REGION',
      '详细地址不能重复填写已选择的地区',
      'customer.addressDetail',
    )
  }

  const fullAddress = `${countryRegionName}${provinceStateName}${cityName}${addressDetail}`
  if ([...fullAddress].length > 1500) {
    return salesOrderValidationFailure('customer.addressDetail')
  }
  return Object.freeze({ addressDetail, fullAddress })
}
