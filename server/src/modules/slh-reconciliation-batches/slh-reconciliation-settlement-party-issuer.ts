import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { PERSON_REFERENCE_SELECT } from '../../infrastructure/database/person-reference'
import { readAllocationSnapshot } from './slh-reconciliation-allocation.logic'
import type { SlhReconciliationSettlementAllocationPartyDto } from './slh-reconciliation-batch.dto'

interface SettlementAllocationPartyIssuer {
  readonly displayName: string
  readonly avatarUrl: string | null
}

type SettlementAllocationPartyIssuerMap = ReadonlyMap<string, SettlementAllocationPartyIssuer>

/**
 * 结算记录的分摊目标只快照了订单号，出单人从销售单当前关联补读。
 * 出单人创建后不可变，因此历史记录也能按 salesOrderId 稳定对应。
 */
export async function loadSettlementAllocationPartyIssuers(
  prisma: PrismaService,
  snapshots: readonly Prisma.JsonValue[],
): Promise<SettlementAllocationPartyIssuerMap> {
  const salesOrderIds = new Set<string>()
  for (const snapshot of snapshots) {
    for (const party of readAllocationSnapshot(snapshot)?.parties ?? []) {
      if (typeof party.salesOrderId === 'string' && party.salesOrderId !== '') {
        salesOrderIds.add(party.salesOrderId)
      }
    }
  }
  if (salesOrderIds.size === 0) {
    return new Map()
  }
  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: [...salesOrderIds] } },
    select: { id: true, issuer: { select: PERSON_REFERENCE_SELECT } },
  })
  return new Map(orders.map(order => [order.id, {
    displayName: order.issuer.displayName,
    avatarUrl: order.issuer.profile?.avatarUrl ?? null,
  }]))
}

/** 把出单人补进快照派生物；公司目标或订单缺失时保持 null，不猜人。 */
export function withSettlementAllocationPartyIssuers(
  snapshot: Prisma.JsonValue,
  issuers: SettlementAllocationPartyIssuerMap,
): SlhReconciliationSettlementAllocationPartyDto[] {
  return (readAllocationSnapshot(snapshot)?.parties ?? []).map((party) => {
    const issuer = typeof party.salesOrderId === 'string' && party.salesOrderId !== ''
      ? issuers.get(party.salesOrderId)
      : undefined
    return {
      ...party,
      issuerDisplayName: issuer?.displayName ?? null,
      issuerAvatarUrl: issuer?.avatarUrl ?? null,
    } as SlhReconciliationSettlementAllocationPartyDto
  })
}
