import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { readPersistenceErrorFacts, hasPersistenceCode } from '../../infrastructure/database/persistence-error-facts'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { containerFailure as fail, containerUuid, type ContainerCommandContext } from './container-batch.normalizer'
import type { OperationsOceanContainerChangeResultDto } from './operations-ocean-change.dto'
import { normalizeOceanChange, normalizeOceanUndoChange, recipientChangeFields, type OceanChangeKind } from './operations-ocean-change.normalizer'
import { operationsOceanLineSelect, personalOceanLineWhere, serializeOperationsOceanLine } from './operations-ocean-container.service'

const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
function mapPersistence(error: unknown): never {
  if (error instanceof ApiException) throw error
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505', 'P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) return fail('CONTAINER_STATE_CHANGED', '资料已变化或正在处理，请刷新后重试', 409)
  throw error
}

@Injectable()
export class OperationsOceanChangeService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessControlService, private readonly audit: AuditService) {}

  private async authorize(tx: Prisma.TransactionClient, actorUserId: string) {
    containerUuid(actorUserId)
    const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { status: true } })
    const permissions = await this.access.getPermissionCodesInTransaction(tx, actorUserId)
    if (user?.status !== 'ACTIVE' || !this.access.hasAll(permissions, ['sales-orders:read', 'sales-orders:update'])) fail('FORBIDDEN', '没有修改装柜明细的权限', 403)
  }

  private async lockOwned(tx: Prisma.TransactionClient, actorUserId: string, id: string, itemId: string, key: string) {
    await applyTransactionTimeouts(tx)
    await this.authorize(tx, actorUserId)
    // 同一提交意图先串行处理重试，再沿采运维护既有顺序锁柜次和明细，避免重复落库和锁顺序倒置。
    await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`ocean.change:${actorUserId}:${key}`}, 0))`)
    await tx.$queryRaw(Prisma.sql`SELECT id FROM container_batches WHERE id = ${id}::uuid FOR UPDATE`)
    await tx.$queryRaw(Prisma.sql`SELECT id FROM container_loading_items WHERE id = ${itemId}::uuid AND container_batch_id = ${id}::uuid FOR UPDATE`)
    // 锁住归属关系直到提交，防止销售归属或采购来源在更新期间切换。
    await tx.$queryRaw(Prisma.sql`SELECT sale.id FROM sales_orders sale
      JOIN purchase_orders purchase ON purchase.sales_order_id = sale.id
      JOIN purchase_order_parts part ON part.purchase_order_id = purchase.id
      JOIN container_loading_items item ON item.shipment_id = part.id
      WHERE item.id = ${itemId}::uuid AND item.container_batch_id = ${id}::uuid
      FOR SHARE OF sale, purchase, part`)
    const row = await tx.containerLoadingItem.findFirst({ where: { id: itemId, containerBatchId: id, ...personalOceanLineWhere(actorUserId) }, select: operationsOceanLineSelect })
    // 相同响应覆盖跨柜、他人货件和不存在的行，管理员也不能绕过销售归属。
    if (!row) return fail('CONTAINER_LOADING_ITEM_NOT_FOUND', '装柜明细不存在或无权修改', 404)
    return row
  }
  private async replay(tx: Prisma.TransactionClient, actorUserId: string, requestKey: string, payloadHash: string) {
    const result = await tx.containerLoadingItemChange.findUnique({ where: { actorUserId_requestKey: { actorUserId, requestKey } } })
    if (result && result.payloadHash !== payloadHash) fail('CONTAINER_CHANGE_IDEMPOTENCY_CONFLICT', '该提交标识已用于不同的修改，请重新操作', 409)
    return result
  }
  private async record(tx: Prisma.TransactionClient, context: ContainerCommandContext, id: string, itemId: string, input: { kind: OceanChangeKind, changes: Record<string, string | null>, beforeData: Record<string, string | null>, requestKey: string, payloadHash: string, previousVersion: number, reversesChangeId?: string }) {
    const row = await tx.containerLoadingItem.update({ where: { id: itemId }, data: { ...input.changes, version: { increment: 1 }, updatedById: context.actorUserId }, select: operationsOceanLineSelect })
    await tx.containerBatch.update({ where: { id }, data: { version: { increment: 1 }, updatedById: context.actorUserId } })
    const record = await tx.containerLoadingItemChange.create({ data: { loadingItemId: itemId, kind: input.kind, beforeData: input.beforeData, afterData: input.changes, previousVersion: input.previousVersion, version: row.version, requestKey: input.requestKey, payloadHash: input.payloadHash, actorUserId: context.actorUserId, reversesChangeId: input.reversesChangeId } })
    await this.audit.record(tx, { eventType: 'CONTAINER_LOADING_ITEM_UPDATED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId, targetType: 'CONTAINER_LOADING_ITEM', targetId: itemId, metadata: { containerBatchId: id, kind: input.kind, previousVersion: input.previousVersion, version: row.version, changeId: record.id, reversesChangeId: input.reversesChangeId ?? null } })
    return { line: serializeOperationsOceanLine(row), changeId: record.id }
  }

  async change(context: ContainerCommandContext, rawId: string, rawItemId: string, raw: unknown): Promise<OperationsOceanContainerChangeResultDto> {
    const id = containerUuid(rawId), itemId = containerUuid(rawItemId), input = normalizeOceanChange(raw)
    const payloadHash = hash({ format: 'ocean.line.change.v2', id, itemId, ...input })
    try {
      return await this.prisma.$transaction(async tx => {
        const previous = await this.lockOwned(tx, context.actorUserId, id, itemId, input.requestKey)
        const replay = await this.replay(tx, context.actorUserId, input.requestKey, payloadHash)
        if (replay) return { line: serializeOperationsOceanLine(previous), changeId: replay.id }
        if (previous.version !== input.expectedVersion) fail('CONTAINER_STATE_CHANGED', '装柜明细已更新，请重新核对修改内容', 409)
        const current = serializeOperationsOceanLine(previous)
        const beforeData = Object.fromEntries(Object.keys(input.changes).map(field => [field, current[field as keyof typeof input.changes]])) as Record<string, string | null>
        const changes = Object.fromEntries(Object.entries(input.changes)) as Record<string, string | null>
        if (JSON.stringify(beforeData) === JSON.stringify(changes)) fail('CONTAINER_CHANGE_NO_DIFFERENCE', '资料没有变化，无需提交修改')
        return this.record(tx, context, id, itemId, { ...input, changes, beforeData, payloadHash, previousVersion: previous.version })
      }, { timeout: 30_000 })
    } catch (error) { return mapPersistence(error) }
  }

  async undo(context: ContainerCommandContext, rawId: string, rawItemId: string, rawChangeId: string, raw: unknown): Promise<OperationsOceanContainerChangeResultDto> {
    const id = containerUuid(rawId), itemId = containerUuid(rawItemId), changeId = containerUuid(rawChangeId), input = normalizeOceanUndoChange(raw)
    const payloadHash = hash({ format: 'ocean.line.undo.v1', id, itemId, changeId, ...input })
    try {
      return await this.prisma.$transaction(async tx => {
        const previous = await this.lockOwned(tx, context.actorUserId, id, itemId, input.requestKey)
        const original = await tx.containerLoadingItemChange.findFirst({ where: { id: changeId, loadingItemId: itemId, actorUserId: context.actorUserId, reversesChangeId: null }, include: { reversedBy: { select: { id: true } } } })
        if (!original) fail('CONTAINER_CHANGE_NOT_FOUND', '修改记录不存在或无权撤销', 404)
        // 重放在版本检查之前恢复已完成的撤销，仍须先验证当前归属和原操作人。
        const replay = await this.replay(tx, context.actorUserId, input.requestKey, payloadHash)
        if (replay) return { line: serializeOperationsOceanLine(previous), changeId: replay.id }
        if (original.reversedBy) fail('CONTAINER_CHANGE_ALREADY_UNDONE', '本次修改已经撤销', 409)
        if (previous.version !== input.expectedVersion || previous.version !== original.version) fail('CONTAINER_STATE_CHANGED', '装柜明细已有后续修改，无法撤销本次操作，请刷新后核对', 409)
        const current = serializeOperationsOceanLine(previous), fields = original.kind === 'COD' ? ['codAmountTwd'] as const : recipientChangeFields
        const stored = original.beforeData as Record<string, string | null>
        const changes = Object.fromEntries(fields.map(field => [field, stored[field]]))
        const beforeData = Object.fromEntries(fields.map(field => [field, current[field]]))
        // 逆向写入也只允许恢复该类型的字段，绝不以 JSON 快照覆盖整行或其他用户的新值。
        return this.record(tx, context, id, itemId, { ...input, kind: original.kind, changes, beforeData, payloadHash, previousVersion: previous.version, reversesChangeId: original.id })
      }, { timeout: 30_000 })
    } catch (error) { return mapPersistence(error) }
  }
}
