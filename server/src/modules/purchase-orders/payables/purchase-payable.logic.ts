import type { FundAccountOwnerType, PurchaseOrderType } from '../../../generated/prisma/enums'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { formatPurchaseOrderAmountUnits, parsePurchaseOrderAmountUnits } from '../domain/purchase-order-decimal'

export function payableFailure(code: string, message: string, status = 422): never {
  throw new ApiException(status, code, message)
}
export function payableStateChanged(): never {
  return payableFailure('PURCHASE_PAYABLE_STATE_CHANGED', '采购应付款已变化，请刷新后重新核对', 409)
}
export function resolvePayableOwner(purchaseType: PurchaseOrderType, issuerUserId: string | null): { accountOwnerType: FundAccountOwnerType, ownerUserId: string | null } {
  if (purchaseType === 'STOCK') return { accountOwnerType: 'COMPANY', ownerUserId: null }
  if (!issuerUserId) return payableFailure('PURCHASE_PAYABLE_NOT_AVAILABLE', '销售来源或销售出单人不可用，无法生成采购应付款')
  return { accountOwnerType: 'USER', ownerUserId: issuerUserId }
}
export function summarizePayable(dueAmount: string, activePayments: readonly string[], closed: boolean) {
  const due = parsePurchaseOrderAmountUnits(dueAmount)
  const paid = activePayments.reduce((sum, amount) => sum + parsePurchaseOrderAmountUnits(amount), 0n)
  if (paid > due) return payableFailure('PURCHASE_PAYABLE_NOT_AVAILABLE', '实际付款超过该阶段约定金额，需要先核对历史付款')
  return {
    paidAmount: formatPurchaseOrderAmountUnits(paid),
    remainingAmount: formatPurchaseOrderAmountUnits(due - paid),
    status: closed ? 'CANCELLED' as const : due === 0n ? 'NO_PAYMENT' as const : paid === due ? 'PAID' as const : 'PENDING_PAYMENT' as const,
  }
}
