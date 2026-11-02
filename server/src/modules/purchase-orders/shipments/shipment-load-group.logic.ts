import { createHash } from 'node:crypto'

import type { PackagingCostStatus, PurchaseOrderPartStatus, ShipmentOwnerType, ShipmentOwnershipState, ShipmentStorageStatus } from '../../../generated/prisma/enums'

export const MAX_LOAD_GROUP_MEMBERS = 20
export const MIN_LOAD_GROUP_MEMBERS = 2

export interface ShipmentLoadGroupMemberFacts {
  readonly id: string
  readonly status: PurchaseOrderPartStatus
  readonly purchaseOrderId: string
  readonly shippingMarkText: string | null
  readonly destinationWarehouseValue: string | null
  readonly warehouseReceivedAt: Date | null
  readonly loadedAt: Date | null
  readonly deliveredAt: Date | null
  readonly ownerType: ShipmentOwnerType | null
  readonly ownerSalesOrderId: string | null
  readonly ownershipState: ShipmentOwnershipState | null
  readonly activeStorageStatus: ShipmentStorageStatus | null
  readonly packagingStatus: PackagingCostStatus | null
  readonly activeLoadGroupId: string | null
  readonly activeSettlementId: string | null
}

export type ShipmentLoadGroupValidation =
  | { readonly ok: true; readonly ownerSalesOrderId: string }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** 同一采购单的货件唛头带 `/货件-NN` 后缀，合并只要求基础唛头一致。 */
export function baseShippingMark(value: string | null): string {
  return (value ?? '').replace(/\/货件-\d+$/u, '')
}

function invalid(code: string, message: string): ShipmentLoadGroupValidation {
  return { ok: false, code, message }
}

/** 去重后校验成员数量与主货件归属；重复 ID 直接拒绝，避免成员数与请求数量不一致。 */
export function normalizeLoadGroupMembership(
  shipmentIds: readonly string[],
  primaryShipmentId: string,
): { readonly shipmentIds: string[]; readonly primaryShipmentId: string } | { readonly code: string; readonly message: string } {
  const unique = [...new Set(shipmentIds)]
  if (unique.length !== shipmentIds.length) {
    return { code: 'VALIDATION_FAILED', message: '同一货件不能在合并组中重复出现' }
  }
  if (unique.length < MIN_LOAD_GROUP_MEMBERS) {
    return { code: 'VALIDATION_FAILED', message: '装柜合并组至少需要两个货件' }
  }
  if (unique.length > MAX_LOAD_GROUP_MEMBERS) {
    return { code: 'VALIDATION_FAILED', message: `装柜合并组最多支持 ${MAX_LOAD_GROUP_MEMBERS} 个货件` }
  }
  if (!unique.includes(primaryShipmentId)) {
    return { code: 'VALIDATION_FAILED', message: '主货件必须包含在合并组内' }
  }
  return { shipmentIds: [...unique].sort(), primaryShipmentId }
}

/**
 * 组创建资格的唯一口径。成员必须同采购单、同当前销售归属、同目的地仓库、同货件唛头，
 * 且都处于已到仓、未装柜、未签收、无寄仓、无包装费、无装柜组、无结算的状态。
 */
export function validateLoadGroupMembers(
  members: readonly ShipmentLoadGroupMemberFacts[],
): ShipmentLoadGroupValidation {
  if (members.length < MIN_LOAD_GROUP_MEMBERS) {
    return invalid('VALIDATION_FAILED', '装柜合并组至少需要两个货件')
  }

  const first = members[0]
  const ownerSalesOrderId = first.ownerSalesOrderId
  const firstBaseMark = baseShippingMark(first.shippingMarkText)
  for (const member of members) {
    if (member.status !== 'ACTIVE') {
      return invalid('SHIPMENT_LOAD_GROUP_NOT_ALLOWED', '只有有效货件可以合并装柜')
    }
    if (member.loadedAt !== null || member.deliveredAt !== null) {
      return invalid('SHIPMENT_LOAD_GROUP_NOT_ALLOWED', '已装柜或已签收的货件不能合并装柜')
    }
    if (member.warehouseReceivedAt === null) {
      return invalid('SHIPMENT_LOAD_GROUP_NOT_ALLOWED', '货件尚未到仓，不能合并装柜')
    }
    if (member.destinationWarehouseValue === null || member.destinationWarehouseValue.trim() === '') {
      return invalid('SHIPMENT_LOAD_GROUP_NOT_ALLOWED', '货件缺少目的地仓库，不能合并装柜')
    }
    if (member.shippingMarkText === null || member.shippingMarkText.trim() === '') {
      return invalid('SHIPMENT_LOAD_GROUP_NOT_ALLOWED', '货件缺少唛头，不能合并装柜')
    }
    if (member.ownerType !== 'SALES_ORDER' || member.ownershipState !== 'ACTIVE' || member.ownerSalesOrderId === null) {
      return invalid('SHIPMENT_LOAD_GROUP_NOT_ALLOWED', '货件没有当前销售归属，不能合并装柜')
    }
    if (member.activeStorageStatus !== null) {
      return invalid('SHIPMENT_LOAD_GROUP_NOT_ALLOWED', '寄仓中的货件不能合并装柜')
    }
    if (member.packagingStatus !== null) {
      return invalid('SHIPMENT_LOAD_GROUP_NOT_ALLOWED', '货件仍有包装费记录，不能合并装柜')
    }
    if (member.activeLoadGroupId !== null) {
      return invalid('SHIPMENT_LOAD_GROUP_MEMBER_CONFLICT', '货件已属于另一个装柜合并组')
    }
    if (member.activeSettlementId !== null) {
      return invalid('SHIPMENT_LOAD_GROUP_NOT_ALLOWED', '货件已有对账结算记录，不能合并装柜')
    }
    if (
      member.purchaseOrderId !== first.purchaseOrderId
      || member.ownerSalesOrderId !== ownerSalesOrderId
      || member.destinationWarehouseValue !== first.destinationWarehouseValue
      || baseShippingMark(member.shippingMarkText) !== firstBaseMark
    ) {
      return invalid('SHIPMENT_LOAD_GROUP_NOT_ALLOWED', '合并装柜的货件必须属于同一采购单、同一销售单，并共用目的地仓库和基础唛头')
    }
  }
  return { ok: true, ownerSalesOrderId: ownerSalesOrderId! }
}

export function shipmentLoadGroupPayloadHash(input: {
  readonly purchaseOrderId: string
  readonly ownerSalesOrderId: string
  readonly primaryShipmentId: string
  readonly shipmentIds: readonly string[]
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      format: 'shipment.load-group.v1',
      purchaseOrderId: input.purchaseOrderId,
      ownerSalesOrderId: input.ownerSalesOrderId,
      primaryShipmentId: input.primaryShipmentId,
      shipmentIds: [...input.shipmentIds].sort(),
    }))
    .digest('hex')
}
