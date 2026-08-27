import {
  salesOrderRuleFailure,
  salesOrderValidationFailure,
} from './sales-order-errors'

const UNICODE_WHITE_SPACE_PATTERN = /\p{White_Space}+/gu
const TAIWAN_TRADITIONAL_REGION_CHARACTER_PATTERN = /[國臺灣縣連門蘭雲義東蓮園]/gu
const TAIWAN_COUNTRY_REGION_NAME = '中国台湾'
const TAIWAN_TRADITIONAL_REGION_CHARACTER_FOLD: Readonly<Record<string, string>> = {
  國: '国',
  臺: '台',
  灣: '湾',
  縣: '县',
  連: '连',
  門: '门',
  蘭: '兰',
  雲: '云',
  義: '义',
  東: '东',
  蓮: '莲',
  園: '园',
}
const ADMINISTRATIVE_REGION_SUFFIXES = [
  '联邦直辖区',
  '聯邦直轄區',
  '特别行政区',
  '特別行政區',
  '自治区',
  '自治區',
  '自治州',
  '自治县',
  '自治縣',
  '行政区',
  '行政區',
  '地区',
  '地區',
  '省',
  '市',
  '县',
  '縣',
  '区',
  '區',
  '盟',
  '旗',
] as const

interface RegionNameComparisonVariant {
  readonly value: string
  readonly omittedSuffix: string | null
}

interface RegionPrefixComparisonCandidate {
  readonly value: string
  readonly omittedTerminalSuffix: string | null
}

export function removeSalesOrderAddressWhitespace(value: string): string {
  return value.normalize('NFKC').replace(UNICODE_WHITE_SPACE_PATTERN, '')
}

/**
 * 台湾地区数据为全部 22 个县市保留了官方繁体 sourceName。这里仅折叠由该数据验证
 * 过的 12 个地区字形，且只用于重复比较；返回并持久化的地址仍保留用户原文字形。
 */
function foldTaiwanTraditionalRegionCharacters(value: string): string {
  return value.replace(
    TAIWAN_TRADITIONAL_REGION_CHARACTER_PATTERN,
    character => TAIWAN_TRADITIONAL_REGION_CHARACTER_FOLD[character] ?? character,
  )
}

function findAdministrativeRegionSuffix(
  value: string,
  position: 'end' | 'start',
): string | null {
  return ADMINISTRATIVE_REGION_SUFFIXES.find(suffix => (
    position === 'end' ? value.endsWith(suffix) : value.startsWith(suffix)
  )) ?? null
}

function createRegionNameComparisonVariants(
  value: string,
): readonly RegionNameComparisonVariant[] {
  const suffix = findAdministrativeRegionSuffix(value, 'end')
  if (suffix === null || value.length === suffix.length) {
    return [{ value, omittedSuffix: null }]
  }
  return [
    { value, omittedSuffix: null },
    { value: value.slice(0, -suffix.length), omittedSuffix: suffix },
  ]
}

function createRegionPrefixComparisonCandidates(
  country: string,
  province: string,
  city: string,
): readonly RegionPrefixComparisonCandidate[] {
  const countryVariants = createRegionNameComparisonVariants(country)
  const provinceVariants = createRegionNameComparisonVariants(province)
  const cityVariants = createRegionNameComparisonVariants(city)
  const candidates = new Map<string, RegionPrefixComparisonCandidate>()

  for (const cityVariant of cityVariants) {
    const paths = [
      ...countryVariants.flatMap(countryVariant => (
        provinceVariants.map(provinceVariant => (
          countryVariant.value + provinceVariant.value + cityVariant.value
        ))
      )),
      ...provinceVariants.map(provinceVariant => (
        provinceVariant.value + cityVariant.value
      )),
      cityVariant.value,
    ]
    for (const value of paths) {
      if (value !== '') {
        const key = `${value}\u0000${cityVariant.omittedSuffix ?? ''}`
        candidates.set(key, {
          value,
          omittedTerminalSuffix: cityVariant.omittedSuffix,
        })
      }
    }
  }
  return [...candidates.values()]
}

function matchesRegionPrefixCandidate(
  detail: string,
  candidate: RegionPrefixComparisonCandidate,
): boolean {
  if (!detail.startsWith(candidate.value)) {
    return false
  }
  if (candidate.omittedTerminalSuffix === null) {
    return true
  }

  // 简称后出现不同的明确行政后缀代表另一地区，例如选“新竹县”不能误拦
  // “台湾新竹市…”。没有后缀则按用户确认的简称规则硬拦截。
  const remainder = detail.slice(candidate.value.length)
  const explicitSuffix = findAdministrativeRegionSuffix(remainder, 'start')
  return explicitSuffix === null || explicitSuffix === candidate.omittedTerminalSuffix
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
  const isTaiwan = foldTaiwanTraditionalRegionCharacters(countryRegionName)
    === TAIWAN_COUNTRY_REGION_NAME
  const comparison = (value: string) => isTaiwan
    ? foldTaiwanTraditionalRegionCharacters(value)
    : value
  const comparisonDetail = comparison(addressDetail)
  const regionPrefixes = createRegionPrefixComparisonCandidates(
    comparison(countryRegionName),
    comparison(provinceStateName),
    comparison(cityName),
  )
  if (regionPrefixes.some(prefix => (
    matchesRegionPrefixCandidate(comparisonDetail, prefix)
  ))) {
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
