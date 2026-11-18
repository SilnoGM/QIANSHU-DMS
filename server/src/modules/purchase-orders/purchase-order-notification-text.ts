import type { PurchaseOrderDetail } from './purchase-order-query.service'
import { flattenPurchaseOrderRemark } from './purchase-order-remark'
import { formatShippingMark, SHIPPING_MARK_PASTE_HINT } from './shipping-mark-label'

/**
 * 采购审核通过通知的多行变量。
 *
 * 模板渲染器只做 `{{变量}}` 纯替换，没有循环和条件，所以整块明细与货件必须
 * 在这里拼成字符串，口径与复制文案逐字一致：
 * - 产品块 2-3 行，行备注为空时不生成备注行；块间空一行。
 * - 货件块 2 行，块间空一行，已取消货件不出现。
 * - 采购备注恒定输出，贴标提示只出现一次。
 *
 * 详情 DTO 的行字段是 `Record<string, unknown>`，历史数据也可能缺字段，
 * 因此全部按运行时类型兜底。本函数在采购审核事务内执行，抛异常会回滚审核，
 * 所以任何缺失都降级为占位文本，不抛错。
 */
export interface PurchaseOrderNotificationBlocks {
  readonly productLines: string
  readonly partMarks: string
  readonly orderRemark: string
}

const NOT_RECORDED = '未记录'
const PRODUCT_UNAVAILABLE = '产品信息不可用'
const PENDING_MARK = '待派发'
const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,4})?$/u

interface LineFacts {
  readonly id: string
  readonly lineNumber: number
  readonly productName: string
  readonly description: string
  readonly quantity: number | null
  readonly unitPrice: string
  readonly subtotal: string
}

interface LoosePart {
  readonly partNumber?: unknown
  readonly status?: unknown
  readonly shippingMarkText?: unknown
  readonly shippingMarkSuffix?: unknown
  readonly items?: unknown
}

interface LoosePartItem {
  readonly purchaseOrderLineId?: unknown
  readonly lineNumber?: unknown
}

function asRecords(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? (value as readonly Record<string, unknown>[]) : []
}

function asParts(value: unknown): readonly LoosePart[] {
  return Array.isArray(value) ? (value as readonly LoosePart[]) : []
}

function asPartItems(value: unknown): readonly LoosePartItem[] {
  return Array.isArray(value) ? (value as readonly LoosePartItem[]) : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : ''
}

function money(value: unknown): string {
  if (typeof value !== 'string' || !AMOUNT_PATTERN.test(value)) {
    return NOT_RECORDED
  }
  const [integer, fraction = ''] = value.split('.')
  return `${integer}.${fraction.padEnd(2, '0').slice(0, 2)}`
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function readLine(line: Record<string, unknown>): LineFacts | null {
  const id = typeof line.id === 'string' ? line.id : ''
  const lineNumber = integer(line.lineNumber)
  if (!id || lineNumber === null) {
    return null
  }
  return {
    id,
    lineNumber,
    productName: text(line.productName),
    description: flattenPurchaseOrderRemark(typeof line.description === 'string' ? line.description : null),
    quantity: integer(line.quantity),
    unitPrice: money(line.actualPurchaseUnitPriceAmount),
    subtotal: money(line.lineTotalAmount),
  }
}

function readParts(detail: PurchaseOrderDetail, nameById: ReadonlyMap<string, string>): readonly {
  readonly partNumber: number
  readonly mark: string
  readonly suffix: string
  readonly products: readonly string[]
}[] {
  return asParts(detail.parts)
    .filter((part: LoosePart) => part.status !== 'CANCELLED')
    .map((part: LoosePart) => ({
      partNumber: integer(part.partNumber),
      mark: text(part.shippingMarkText),
      suffix: typeof part.shippingMarkSuffix === 'string' ? part.shippingMarkSuffix : '',
      products: asPartItems(part.items)
        .map((item: LoosePartItem) => ({
          lineNumber: integer(item.lineNumber) ?? Number.MAX_SAFE_INTEGER,
          name: nameById.get(typeof item.purchaseOrderLineId === 'string' ? item.purchaseOrderLineId : '') ?? PRODUCT_UNAVAILABLE,
        }))
        .sort((left, right) => left.lineNumber - right.lineNumber)
        .map(item => item.name),
    }))
    .filter(part => part.partNumber !== null)
    .map(part => ({ ...part, partNumber: part.partNumber as number }))
    .sort((left, right) => left.partNumber - right.partNumber)
}

export function buildPurchaseOrderNotificationBlocks(detail: PurchaseOrderDetail): PurchaseOrderNotificationBlocks {
  const lines = asRecords(detail.lines)
    .map(readLine)
    .filter((line): line is LineFacts => line !== null)
    .sort((left, right) => left.lineNumber - right.lineNumber)
  const nameById = new Map(lines.map(line => [line.id, line.productName || PRODUCT_UNAVAILABLE]))

  const productLines = lines.map((line) => {
    const quantity = line.quantity ?? 0
    const base = `产品名：${line.productName || PRODUCT_UNAVAILABLE}*${quantity}\n金额小计：${line.unitPrice}*${quantity}=${line.subtotal}`
    return line.description ? `${base}\n备注：${line.description}` : base
  }).join('\n\n')

  const partMarks = readParts(detail, nameById).map((part) => {
    const label = `货件-${String(part.partNumber).padStart(2, '0')}`
    const products = part.products.join('+') || PRODUCT_UNAVAILABLE
    const mark = part.mark ? formatShippingMark(part.mark, part.suffix) : PENDING_MARK
    return `${label}：${products}\n唛头：${mark}`
  }).join('\n\n')

  const customRemark = flattenPurchaseOrderRemark(detail.remark)
  const orderRemark = customRemark
    ? `\n\n采购备注：${SHIPPING_MARK_PASTE_HINT}；${customRemark}`
    : `\n\n采购备注：${SHIPPING_MARK_PASTE_HINT}`

  return { productLines, partMarks, orderRemark }
}
