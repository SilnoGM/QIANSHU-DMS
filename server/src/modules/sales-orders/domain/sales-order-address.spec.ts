import { normalizeSalesOrderAddress } from './sales-order-address'

describe('sales order address normalization', () => {
  const regions = {
    countryRegionName: '中国台湾',
    provinceStateName: '台湾',
    cityName: '高雄市',
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
