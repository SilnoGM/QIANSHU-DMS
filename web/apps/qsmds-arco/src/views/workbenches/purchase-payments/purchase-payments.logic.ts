import type { PurchasePayableDto, PurchasePayableOrderDto } from '../../../api/generated/types.gen'
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
