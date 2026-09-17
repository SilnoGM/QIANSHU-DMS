import type { PurchaseOrderListItemDto, PurchasePayableDto, PurchasePayableOrderDto } from '../../../api/generated/types.gen'
import { validateMoneyString } from '../../../components/base/MoneyInput/logic'

export interface PurchasePayableRow {
  id: string
  order: PurchasePayableOrderDto
  payable: PurchasePayableDto | null
  children?: PurchasePayableRow[]
}

export interface PurchasePayableSelection {
  order: PurchasePayableOrderDto
  item: PurchasePayableDto
}

export function buildPurchasePayableLinkText(order: Pick<PurchaseOrderListItemDto, 'orderNo' | 'customerName' | 'purchaseType'>, item: PurchasePayableDto, resolvedHref: string, currentUrl: string): string {
  if (!canPayPurchasePayable(item)) {
    throw new Error('Purchase payable is unavailable')
  }
  const customerName = order.customerName?.trim() || (order.purchaseType === 'STOCK' ? '公司备货' : '未记录客户')
  const paymentType = item.paymentType === 'DEPOSIT' ? '定金' : '尾款'
  const amount = validateMoneyString(item.remainingAmount, { precision: 2 }).normalizedValue
  return `我需要为【${customerName}】的订单【${order.orderNo}】付【${paymentType}】：${amount} 元。\n\n付款链接：\n${new URL(resolvedHref, currentUrl).href}`
}

export function canPayPurchasePayable(item: PurchasePayableDto): boolean {
  const amount = validateMoneyString(item.remainingAmount, { precision: 2 })
  return item.status === 'PENDING_PAYMENT' && amount.valid && amount.normalizedValue !== null && amount.normalizedValue !== '0.00'
}

export function createPurchasePayableGroups(orders: readonly PurchasePayableOrderDto[]): PurchasePayableRow[] {
  return orders.map(order => ({
    id: order.id,
    order,
    payable: null,
    children: [...order.items]
      .sort((left, right) => Number(left.paymentType === 'BALANCE') - Number(right.paymentType === 'BALANCE'))
      .map(payable => ({ id: payable.id, order, payable })),
  }))
}
