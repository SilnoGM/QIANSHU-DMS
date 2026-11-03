import type { Prisma } from '../../../generated/prisma/client'

export interface ActiveLoadGroup {
  readonly id: string
  readonly primaryShipmentId: string
  readonly memberShipmentIds: readonly string[]
}

export interface LoadGroupExpansion {
  /** 请求货件加上其活跃组成员后的去重集合，用于装柜事实与资格校验。 */
  readonly shipmentIds: readonly string[]
  /** 请求货件归一到的主货件；不属于活跃组时保留自身。 */
  readonly primaryByShipment: ReadonlyMap<string, string>
  readonly groupByShipment: ReadonlyMap<string, string>
  readonly groups: readonly ActiveLoadGroup[]
}

/**
 * 活跃装柜组解析的唯一入口。装柜、导入、撤销、签收和释放都通过这里展开成员，
 * 避免某个调用点只看到主货件或只看到成员。
 */
export async function findActiveLoadGroupsForShipments(
  transaction: Prisma.TransactionClient,
  shipmentIds: readonly string[],
): Promise<ReadonlyMap<string, ActiveLoadGroup>> {
  const ids = [...new Set(shipmentIds)]
  if (ids.length === 0) return new Map()

  const rows = await transaction.shipmentLoadGroupMember.findMany({
    where: {
      shipmentId: { in: ids },
      active: true,
      group: { status: 'ACTIVE' },
    },
    select: {
      shipmentId: true,
      group: {
        select: {
          id: true,
          primaryShipmentId: true,
          members: {
            where: { active: true },
            select: { shipmentId: true },
          },
        },
      },
    },
  })

  const result = new Map<string, ActiveLoadGroup>()
  for (const row of rows) {
    result.set(row.shipmentId, {
      id: row.group.id,
      primaryShipmentId: row.group.primaryShipmentId,
      memberShipmentIds: row.group.members.map(member => member.shipmentId).sort(),
    })
  }
  return result
}

export async function resolveLoadGroupMembership(
  transaction: Prisma.TransactionClient,
  shipmentId: string,
): Promise<ActiveLoadGroup | null> {
  const groups = await findActiveLoadGroupsForShipments(transaction, [shipmentId])
  return groups.get(shipmentId) ?? null
}

export async function resolveLoadGroupExpansion(
  transaction: Prisma.TransactionClient,
  shipmentIds: readonly string[],
): Promise<LoadGroupExpansion> {
  const requested = [...new Set(shipmentIds)].sort()
  if (requested.length === 0) {
    return { shipmentIds: [], primaryByShipment: new Map(), groupByShipment: new Map(), groups: [] }
  }

  const groupsByShipment = await findActiveLoadGroupsForShipments(transaction, requested)
  const expanded = new Set<string>(requested)
  const primaryByShipment = new Map<string, string>()
  const groupByShipment = new Map<string, string>()
  const groupsById = new Map<string, ActiveLoadGroup>()

  for (const shipmentId of requested) {
    const group = groupsByShipment.get(shipmentId)
    if (group === undefined) {
      primaryByShipment.set(shipmentId, shipmentId)
      continue
    }
    primaryByShipment.set(shipmentId, group.primaryShipmentId)
    groupByShipment.set(shipmentId, group.id)
    groupsById.set(group.id, group)
    for (const memberId of group.memberShipmentIds) expanded.add(memberId)
  }

  return {
    shipmentIds: [...expanded].sort(),
    primaryByShipment,
    groupByShipment,
    groups: [...groupsById.values()],
  }
}
