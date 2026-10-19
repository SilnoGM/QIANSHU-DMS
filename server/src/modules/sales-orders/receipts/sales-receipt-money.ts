import { HttpStatus } from '@nestjs/common'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { parseSalesOrderAmountUnits } from '../domain/sales-order-decimal'

export function receiptFailure(code: string, message: string, status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY): never {
  throw new ApiException(status, code, message)
}

/** 全程整数运算；原币两位乘 10^4 后除四位汇率即为人民币分。 */
export function convertReceiptToCny(amount: string, rate: string): string {
  if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,4})?$/u.test(rate)) {
    return receiptFailure('SALES_RECEIPT_RATE_UNAVAILABLE', '当前汇率不可用')
  }
  const [integer = '0', fraction = ''] = rate.split('.')
  const denominator = BigInt(integer) * 10n ** 4n + BigInt(fraction.padEnd(4, '0'))
  if (denominator <= 0n) return receiptFailure('SALES_RECEIPT_RATE_UNAVAILABLE', '当前汇率不可用')
  const numerator = parseSalesOrderAmountUnits(amount) * 10n ** 4n
  const cents = (numerator * 2n + denominator) / (denominator * 2n)
  if (cents <= 0n || cents >= 10n ** 30n) {
    return receiptFailure('SALES_RECEIPT_CNY_AMOUNT_INVALID', '换算后的人民币金额超出可入账范围')
  }
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
}

export function assertReceiptCapacity(total: string, received: string, pending: string, additional = '0.00'): void {
  if (parseSalesOrderAmountUnits(received) + parseSalesOrderAmountUnits(pending) + parseSalesOrderAmountUnits(additional) > parseSalesOrderAmountUnits(total)) {
    receiptFailure('SALES_RECEIPT_AMOUNT_EXCEEDS_AVAILABLE', '已收款与待审核收款合计不能超过订单应收金额')
  }
}
