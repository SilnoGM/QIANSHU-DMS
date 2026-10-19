import Decimal from 'decimal.js'

/**
 * 汇率只读展示统一两位小数：存储与录入最多四位，计算继续使用服务端原始值。
 * 空串与缺失同义；非法值返回 null，由调用方给占位符。
 */
export function formatExchangeRate(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null
  }
  try {
    return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
  }
  catch {
    return null
  }
}
