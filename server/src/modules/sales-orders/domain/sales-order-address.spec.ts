import { normalizeSalesOrderAddress } from './sales-order-address'

describe('sales order address normalization', () => {
  const regions = {
    countryRegionName: '中国台湾',
    provinceStateName: '台湾',
    cityName: '高雄市',
  } as const
  const hsinchuRegions = {
    countryRegionName: '中国台湾',
    provinceStateName: '台湾',
    cityName: '新竹县',
  } as const

  it('removes every Unicode whitespace and composes without separators', () => {
    expect(normalizeSalesOrderAddress({
      ...regions,
      addressDetail: ' 苓雅区\t中正一路 100\u00a0号\u30003 楼\n',
    })).toEqual({
      addressDetail: '苓雅区中正一路100号3楼',
      fullAddress: '中国台湾台湾高雄市苓雅区中正一路100号3楼',
    })
  })

  it.each([
    '中国台湾 台湾 高雄市 苓雅区中正一路100号',
    '台湾 高雄市 苓雅区中正一路100号',
    '高雄市 苓雅区中正一路100号',
  ])('hard-blocks a selected region prefix: %s', (addressDetail) => {
    expect(() => normalizeSalesOrderAddress({
      ...regions,
      addressDetail,
    })).toThrow(expect.objectContaining({
      code: 'ADDRESS_DETAIL_CONTAINS_SELECTED_REGION',
      fieldErrors: {
        'customer.addressDetail': ['详细地址不能重复填写已选择的地区'],
      },
    }))
  })

  it.each([
    '中国台湾 台湾 新竹县 测试区测试22号',
    '台湾 新竹县 测试区测试22号',
    '台湾 新竹 测试区测试22号',
    '新竹县 测试区测试22号',
    '新竹 测试区测试22号',
    '中國臺灣 臺灣 新竹縣 測試區測試22號',
    '台灣 新竹縣 測試區測試22號',
    '臺灣 新竹 測試區測試22號',
    '新竹縣 測試區測試22號',
  ])('hard-blocks a selected Taiwan region alias: %s', (addressDetail) => {
    expect(() => normalizeSalesOrderAddress({
      ...hsinchuRegions,
      addressDetail,
    })).toThrow(expect.objectContaining({
      code: 'ADDRESS_DETAIL_CONTAINS_SELECTED_REGION',
      fieldErrors: {
        'customer.addressDetail': ['详细地址不能重复填写已选择的地区'],
      },
    }))
  })

  it.each([
    ['连江县', '連江縣'],
    ['金门县', '金門縣'],
    ['宜兰县', '宜蘭縣'],
    ['云林县', '雲林縣'],
    ['嘉义县', '嘉義縣'],
    ['屏东县', '屏東縣'],
    ['花莲县', '花蓮縣'],
    ['桃园市', '桃園市'],
  ])('folds the official Taiwan city alias %s <- %s', (
    cityName,
    traditionalCityName,
  ) => {
    expect(() => normalizeSalesOrderAddress({
      ...hsinchuRegions,
      cityName,
      addressDetail: `${traditionalCityName}測試區測試22號`,
    })).toThrow(expect.objectContaining({
      code: 'ADDRESS_DETAIL_CONTAINS_SELECTED_REGION',
    }))
  })

  it.each([
    '测试区测试22号',
    '測試區測試22號',
    '桃園路22號',
    '测试区台湾新竹县22号',
    '台湾新竹市测试区测试22号',
  ])('keeps a non-duplicate address detail: %s', (addressDetail) => {
    expect(normalizeSalesOrderAddress({
      ...hsinchuRegions,
      addressDetail,
    }).addressDetail).toBe(removeSpaces(addressDetail))
  })

  it('does not fuzzy-remove region words in the middle', () => {
    expect(normalizeSalesOrderAddress({
      ...regions,
      addressDetail: '苓雅区高雄市路100号',
    }).addressDetail).toBe('苓雅区高雄市路100号')
  })

  it('rejects an empty detail after normalization', () => {
    expect(() => normalizeSalesOrderAddress({
      ...regions,
      addressDetail: ' \t\u3000\n',
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })
})

function removeSpaces(value: string): string {
  return value.replace(/\p{White_Space}+/gu, '')
}
