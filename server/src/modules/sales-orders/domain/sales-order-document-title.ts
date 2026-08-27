import type { SalesOrderPaymentType } from '../../../generated/prisma/enums'

export type SalesOrderDocumentTitleKind =
  | SalesOrderPaymentType
  | 'ORDER_ISSUANCE_VOUCHER'
  | 'DELIVERY_RECEIPT'

const TITLE_LABELS: Readonly<Record<SalesOrderDocumentTitleKind, string>> = {
  ORDER_ISSUANCE_VOUCHER: '出单凭证',
  DEPOSIT: '定金凭证',
  PROGRESS: '过程款凭证',
  INVOICE_TAX: '开票税金凭证',
  BALANCE: '尾款凭证',
  OTHER: '其他收款凭证',
  DELIVERY_RECEIPT: '签收单',
}

function timestampInShanghai(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid document time')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  }).formatToParts(value)
  const byType = new Map<string, string>(
    parts.map(part => [part.type, part.value]),
  )
  const orderedTypes = [
    'year',
    'month',
    'day',
    'hour',
    'minute',
    'second',
    'fractionalSecond',
  ] as const
  return orderedTypes.map(type => byType.get(type) ?? '').join('')
}

/**
 * 凭证标题由服务端统一生成，客户端只能预览，不能覆盖最终值。
 * 长度限制按 Unicode code point 计算，仅截断客户名，确保业务类型和时间戳完整保留。
 */
export function createSalesOrderDocumentTitle(
  customerName: string,
  kind: SalesOrderDocumentTitleKind,
  occurredAt: Date,
): string {
  const normalizedCustomerName = customerName.trim().normalize('NFKC')
  const suffix = `-${TITLE_LABELS[kind]}-${timestampInShanghai(occurredAt)}`
  const customerLimit = 128 - [...suffix].length
  return `${[...normalizedCustomerName].slice(0, customerLimit).join('')}${suffix}`
}
