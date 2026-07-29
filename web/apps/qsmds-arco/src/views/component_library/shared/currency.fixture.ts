import type { CurrencyDescriptor } from '@/components/base/currency'

/**
 * 仅供组件库页面演示动态币种契约，不是系统货币目录的默认数据或生产真相源。
 * 正式业务页面应把 API / Store 数据映射为同一 CurrencyDescriptor 后再传给组件。
 */
export const SHOWCASE_CURRENCIES = [
  {
    code: 'CNY',
    enabled: true,
    minorUnit: 2,
    name: '人民币',
    symbol: '¥',
  },
  {
    code: 'TWD',
    enabled: false,
    minorUnit: 2,
    name: '新台币',
    symbol: 'NT$',
  },
  {
    code: 'MYR',
    enabled: true,
    minorUnit: 2,
    name: '马来西亚林吉特',
    symbol: 'RM',
  },
  {
    code: 'USD',
    enabled: true,
    minorUnit: 2,
    name: '美元',
    symbol: '$',
  },
  {
    code: 'JPY',
    enabled: true,
    minorUnit: 0,
    name: '日元',
    symbol: 'JP¥',
  },
  {
    code: 'BHD',
    enabled: true,
    minorUnit: 3,
    name: '巴林第纳尔',
    symbol: 'BD',
  },
  {
    code: 'CLF',
    enabled: true,
    minorUnit: 4,
    name: '智利记账单位',
    symbol: 'UF',
  },
] as const satisfies readonly CurrencyDescriptor[]
