import type { SalesOrderStatus } from '../../generated/prisma/enums'

/** 只读检查与最终审核共用阻断原因；业务终态不能用“刷新重试”掩盖。 */
export function purchaseReviewSourceBlockReason(status: SalesOrderStatus | null): string | null {
  switch (status) {
    case 'CONFIRMED': return null
    case 'CANCELLED': return '关联销售订单已取消，不能审核该采购单；请核实销售需求并处理待审核采购单'
    case 'PENDING_RECONCILIATION': return '关联销售订单已进入待对账，不能继续审核采购；请联系销售负责人核实后续处理'
    case 'COMPLETED': return '关联销售订单已完成，不能继续审核采购；请联系销售负责人核实后续处理'
    case 'DRAFT': return '关联销售订单尚未确认，请先确认销售订单后重新检查'
    case null: return '关联销售来源不存在，请核实来源订单并处理待审核采购单'
  }
}
