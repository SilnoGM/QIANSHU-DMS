import type { Prisma } from '../../generated/prisma/client'
import type { DataScope } from '../access-control/data-scope'

/**
 * 采购订单、货件与应付的业务归属。
 *
 * 采购单按销售来源出单人归属：`STOCK` 与无销售来源的采购单在 SELF 下自然被关系
 * 过滤排除。应付单独使用 `ownerUserId`，因为它的创建人是审核人，不是业务归属人。
 */
export function purchaseOrderScopeWhere(
  scope: DataScope,
  actorUserId: string,
): Prisma.PurchaseOrderWhereInput {
  return scope === 'SELF'
    ? { salesOrder: { is: { issuerUserId: actorUserId } } }
    : {}
}

export function purchaseOrderPartScopeWhere(
  scope: DataScope,
  actorUserId: string,
): Prisma.PurchaseOrderPartWhereInput {
  return scope === 'SELF'
    ? {
        purchaseOrder: {
          is: { salesOrder: { is: { issuerUserId: actorUserId } } },
        },
      }
    : {}
}

export function purchaseOrderPayableScopeWhere(
  scope: DataScope,
  actorUserId: string,
): Prisma.PurchaseOrderPayableWhereInput {
  return scope === 'SELF' ? { ownerUserId: actorUserId } : {}
}
