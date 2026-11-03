import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { hasPersistenceCode, hasPersistenceConstraint, readPersistenceErrorFacts } from '../../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { DataScopeService, dataScopeFallback } from '../../access-control/data-scope.service'
import { AuditService } from '../../audit/audit.service'
import { purchaseOrderPartScopeWhere } from '../purchase-order-access'
import type { CreateShipmentLoadGroupDto, ReleaseShipmentLoadGroupDto, ShipmentLoadGroupDto } from './shipment-load-group.dto'
import {
  normalizeLoadGroupMembership,
  shipmentLoadGroupPayloadHash,
  validateLoadGroupMembers,
  type ShipmentLoadGroupMemberFacts,
} from './shipment-load-group.logic'

interface ShipmentLoadGroupCommandContext {
  readonly actorUserId: string
  readonly requestId: string
}

const MEMBER_GROUP_SELECT = {
  id: true,
  status: true,
  purchaseOrderId: true,
  shippingMarkText: true,
  destinationWarehouseValue: true,
  warehouseReceivedAt: true,
  loadedAt: true,
  deliveredAt: true,
  ownershipCurrent: { select: { ownerType: true, ownerSalesOrderId: true, state: true } },
  storageRecords: {
    where: { status: { in: ['IN_STORAGE', 'RESERVED', 'CLAIMED'] } },
    select: { status: true },
    take: 1,
  },
  packagingCosts: {
    where: { status: { in: ['PENDING_PAYMENT', 'PAID'] } },
    select: { status: true },
    take: 1,
  },
  loadGroupMemberships: { where: { active: true }, select: { groupId: true }, take: 1 },
} as const satisfies Prisma.PurchaseOrderPartSelect

const GROUP_SELECT = {
  id: true,
  purchaseOrderId: true,
  ownerSalesOrderId: true,
  primaryShipmentId: true,
  status: true,
  version: true,
  members: {
    where: { active: true },
    orderBy: [{ createdAt: 'asc' as const }, { shipmentId: 'asc' as const }],
    select: {
      shipmentId: true,
      isPrimary: true,
      shipment: { select: { shipmentNo: true, shippingMarkText: true } },
    },
  },
} as const satisfies Prisma.ShipmentLoadGroupSelect

function fail(code: string, message: string, status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY): never {
  throw new ApiException(status, code, message)
}

function serializeGroup(group: Prisma.ShipmentLoadGroupGetPayload<{ select: typeof GROUP_SELECT }>): ShipmentLoadGroupDto {
  return {
    id: group.id,
    purchaseOrderId: group.purchaseOrderId,
    ownerSalesOrderId: group.ownerSalesOrderId,
    primaryShipmentId: group.primaryShipmentId,
    status: group.status,
    version: group.version,
    members: group.members.map(member => ({
      shipmentId: member.shipmentId,
      shipmentNo: member.shipment.shipmentNo,
      shippingMarkText: member.shipment.shippingMarkText,
      isPrimary: member.isPrimary,
    })),
  }
}

@Injectable()
export class ShipmentLoadGroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  async create(context: ShipmentLoadGroupCommandContext, input: CreateShipmentLoadGroupDto): Promise<ShipmentLoadGroupDto> {
    const normalized = normalizeLoadGroupMembership(input.shipmentIds, input.primaryShipmentId)
    if ('code' in normalized) fail(normalized.code, normalized.message)
    const shipmentIds = normalized.shipmentIds

    try {
      return await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const scope = await this.dataScope.resolveInTransaction(transaction, context.actorUserId)

        const existing = await transaction.shipmentLoadGroup.findUnique({
          where: { createdById_requestKey: { createdById: context.actorUserId, requestKey: input.requestKey } },
          select: { ...GROUP_SELECT, payloadHash: true },
        })
        if (existing !== null) {
          const hash = shipmentLoadGroupPayloadHash({
            purchaseOrderId: existing.purchaseOrderId,
            ownerSalesOrderId: existing.ownerSalesOrderId,
            primaryShipmentId: input.primaryShipmentId,
            shipmentIds,
          })
          if (existing.payloadHash !== hash) fail('SHIPMENT_LOAD_GROUP_IDEMPOTENCY_CONFLICT', '该提交标识已用于不同的装柜合并内容', HttpStatus.CONFLICT)
          return serializeGroup(existing)
        }

        await transaction.$queryRaw(Prisma.sql`
          SELECT id FROM purchase_order_parts
           WHERE id IN (${Prisma.join(shipmentIds.map(id => Prisma.sql`${id}::uuid`))})
           ORDER BY id FOR UPDATE`)

        const parts = await transaction.purchaseOrderPart.findMany({
          where: { id: { in: shipmentIds }, ...purchaseOrderPartScopeWhere(scope, context.actorUserId) },
          select: MEMBER_GROUP_SELECT,
        })
        if (parts.length !== shipmentIds.length) {
          fail('SHIPMENT_LOAD_GROUP_NOT_FOUND', '部分货件不存在或无权操作', HttpStatus.NOT_FOUND)
        }

        const settled = await transaction.slhReconciliationSettlement.findMany({
          where: { status: 'ACTIVE', loadingItem: { shipmentId: { in: shipmentIds } } },
          select: { loadingItem: { select: { shipmentId: true } } },
        })
        const settledIds = new Set(settled.map(row => row.loadingItem.shipmentId))

        const facts: ShipmentLoadGroupMemberFacts[] = parts.map(part => ({
          id: part.id,
          status: part.status,
          purchaseOrderId: part.purchaseOrderId,
          shippingMarkText: part.shippingMarkText,
          destinationWarehouseValue: part.destinationWarehouseValue,
          warehouseReceivedAt: part.warehouseReceivedAt,
          loadedAt: part.loadedAt,
          deliveredAt: part.deliveredAt,
          ownerType: part.ownershipCurrent?.ownerType ?? null,
          ownerSalesOrderId: part.ownershipCurrent?.ownerSalesOrderId ?? null,
          ownershipState: part.ownershipCurrent?.state ?? null,
          activeStorageStatus: part.storageRecords[0]?.status ?? null,
          packagingStatus: part.packagingCosts[0]?.status ?? null,
          activeLoadGroupId: part.loadGroupMemberships[0]?.groupId ?? null,
          activeSettlementId: settledIds.has(part.id) ? 'settled' : null,
        }))
        const validation = validateLoadGroupMembers(facts)
        if (!validation.ok) fail(validation.code, validation.message)

        const purchaseOrderId = parts[0].purchaseOrderId
        const payloadHash = shipmentLoadGroupPayloadHash({
          purchaseOrderId,
          ownerSalesOrderId: validation.ownerSalesOrderId,
          primaryShipmentId: normalized.primaryShipmentId,
          shipmentIds,
        })

        const group = await transaction.shipmentLoadGroup.create({
          data: {
            purchaseOrderId,
            ownerSalesOrderId: validation.ownerSalesOrderId,
            primaryShipmentId: normalized.primaryShipmentId,
            status: 'ACTIVE',
            sealed: false,
            requestKey: input.requestKey,
            payloadHash,
            createdById: context.actorUserId,
          },
          select: { id: true },
        })
        await transaction.shipmentLoadGroupMember.createMany({
          data: shipmentIds.map(shipmentId => ({
            groupId: group.id,
            shipmentId,
            isPrimary: shipmentId === normalized.primaryShipmentId,
          })),
        })
        const sealed = await transaction.shipmentLoadGroup.update({
          where: { id: group.id },
          data: { sealed: true, version: { increment: 1 } },
          select: GROUP_SELECT,
        })

        await this.audit.record(transaction, {
          eventType: 'PURCHASE_SHIPMENT_LOAD_GROUP_CREATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'SHIPMENT_LOAD_GROUP',
          targetId: group.id,
          metadata: {
            purchaseOrderId,
            ownerSalesOrderId: validation.ownerSalesOrderId,
            primaryShipmentId: normalized.primaryShipmentId,
            shipmentIds: shipmentIds.join(','),
          },
        })
        return serializeGroup(sealed)
      })
    } catch (error) {
      if (error instanceof ApiException) throw error
      const facts = readPersistenceErrorFacts(error)
      if (
        hasPersistenceConstraint(facts, 'shipment_load_group_members_active_shipment_key')
        || hasPersistenceConstraint(facts, 'shipment_load_groups_actor_request_key')
        || hasPersistenceCode(facts, '23505')
      ) {
        fail('SHIPMENT_LOAD_GROUP_MEMBER_CONFLICT', '货件已属于另一个装柜合并组，请刷新后重试', HttpStatus.CONFLICT)
      }
      if (hasPersistenceCode(facts, '23514')) {
        fail('SHIPMENT_LOAD_GROUP_NOT_ALLOWED', '货件不满足装柜合并条件，请刷新后核对')
      }
      if (['P2002', 'P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
        fail('SHIPMENT_LOAD_GROUP_STATE_CHANGED', '装柜合并组正在处理，请刷新后重试', HttpStatus.CONFLICT)
      }
      throw error
    }
  }

  async release(context: ShipmentLoadGroupCommandContext, groupId: string, input: ReleaseShipmentLoadGroupDto): Promise<ShipmentLoadGroupDto> {
    return this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const scope = await this.dataScope.resolveInTransaction(transaction, context.actorUserId)
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM shipment_load_groups WHERE id = ${groupId}::uuid FOR UPDATE`)

      const group = await transaction.shipmentLoadGroup.findUnique({
        where: { id: groupId },
        select: {
          ...GROUP_SELECT,
          sealed: true,
          members: {
            where: { active: true },
            select: {
              shipmentId: true,
              isPrimary: true,
              shipment: { select: { shipmentNo: true, shippingMarkText: true, loadedAt: true, deliveredAt: true } },
            },
          },
        },
      })
      if (group === null) fail('SHIPMENT_LOAD_GROUP_NOT_FOUND', '装柜合并组不存在', HttpStatus.NOT_FOUND)
      const visible = await transaction.purchaseOrderPart.findFirst({
        where: { id: group.primaryShipmentId, ...purchaseOrderPartScopeWhere(scope, context.actorUserId) },
        select: { id: true },
      })
      if (visible === null) fail('SHIPMENT_LOAD_GROUP_NOT_FOUND', '装柜合并组不存在或无权操作', HttpStatus.NOT_FOUND)
      if (group.status !== 'ACTIVE') return serializeGroup(group)
      if (!group.sealed) fail('SHIPMENT_LOAD_GROUP_STATE_CHANGED', '装柜合并组尚未完成创建', HttpStatus.CONFLICT)
      if (group.version !== input.expectedVersion) {
        fail('SHIPMENT_LOAD_GROUP_STATE_CHANGED', '装柜合并组已变化，请刷新后重试', HttpStatus.CONFLICT)
      }
      if (group.members.some(member => member.shipment.loadedAt !== null || member.shipment.deliveredAt !== null)) {
        fail('SHIPMENT_LOAD_GROUP_LOADED', '已装柜的合并组只能在释放时选择撤销', HttpStatus.CONFLICT)
      }

      const releasedAt = new Date()
      await transaction.shipmentLoadGroup.update({
        where: { id: groupId },
        data: {
          status: 'RELEASED',
          releasedById: context.actorUserId,
          releasedAt,
          releaseReason: input.reason?.trim() || null,
          version: { increment: 1 },
        },
      })
      await transaction.shipmentLoadGroupMember.updateMany({
        where: { groupId, active: true },
        data: { active: false },
      })
      await this.audit.record(transaction, {
        eventType: 'PURCHASE_SHIPMENT_LOAD_GROUP_RELEASED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'SHIPMENT_LOAD_GROUP',
        targetId: groupId,
        metadata: { purchaseOrderId: group.purchaseOrderId, shipmentIds: group.members.map(member => member.shipmentId).join(','), reason: input.reason ?? null },
      })

      const updated = await transaction.shipmentLoadGroup.findUniqueOrThrow({ where: { id: groupId }, select: GROUP_SELECT })
      return serializeGroup(updated)
    })
  }
}
