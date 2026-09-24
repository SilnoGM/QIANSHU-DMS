import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { DictionaryLookupService, DictionaryValueUnavailableError } from '../dictionaries/dictionary-lookup.service'
import { OceanFreightSourceFileService } from '../media/ocean-freight-source-file.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { NumberingGenerationError } from '../numbering/numbering.errors'
import { calculateOceanVolume } from '../ocean-freight-calculation/ocean-freight-calculation'
import { serializeContainerBatch as serialize, serializeContainerItem as serializeItem, containerSummaryInclude } from './container-batch.serializer'
import type { ContainerBatchDto, ContainerBatchListQueryDto, ContainerLoadingItemCreateDto, ContainerLoadingItemDto } from './container-batch.dto'
import { containerFailure, containerUuid, deriveContainerDate, normalizeContainerCreate, normalizeLoadingItemCreate, normalizeContainerUpdate, normalizeLoadingItemUpdate, requireContainerVersion, type ContainerCommandContext } from './container-batch.normalizer'

const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
function mapError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof DictionaryValueUnavailableError) return containerFailure('CONTAINER_WAREHOUSE_UNAVAILABLE', '目的地仓库当前不可用')
  if (error instanceof NumberingGenerationError) return containerFailure('CONTAINER_NUMBERING_UNAVAILABLE', '柜次编号暂时无法派发，请检查编号规则后重试', 409)
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505'].some(code => hasPersistenceCode(facts, code))) return containerFailure('CONTAINER_BATCH_CONFLICT', '该仓库同日同序号柜次或装柜记录已经存在', 409)
  if (['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) return containerFailure('CONTAINER_STATE_CHANGED', '资料已变化或正在处理，请刷新后重试', 409)
  throw error
}

@Injectable()
export class ContainerBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingGeneratorService,
    private readonly dictionary: DictionaryLookupService,
    private readonly sourceFiles: OceanFreightSourceFileService,
    private readonly access: AccessControlService,
    private readonly audit: AuditService,
  ) {}

  private async authorize(tx: Prisma.TransactionClient, actorUserId: string, permission: string) {
    containerUuid(actorUserId)
    const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { status: true } })
    const codes = await this.access.getPermissionCodesInTransaction(tx, actorUserId)
    if (user?.status !== 'ACTIVE' || !this.access.hasAll(codes, [permission])) return containerFailure('FORBIDDEN', '权限不足', 403)
  }

  async create(context: ContainerCommandContext, input: unknown, key: unknown): Promise<ContainerBatchDto> {
    const normalized = normalizeContainerCreate(input), creationRequestKey = containerUuid(key)
    const creationPayloadHash = hash({ format: 'container.create.v1', ...normalized })
    try {
      return await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId, 'container-batches:create')
        // 创建意图锁位于发号之前，网络重试只恢复同一对象，不再次消耗编号。
        await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`container.create:${context.actorUserId}:${creationRequestKey}`}, 0))`)
        const previous = await tx.containerBatch.findUnique({ where: { createdById_creationRequestKey: { createdById: context.actorUserId, creationRequestKey } }, include: containerSummaryInclude })
        if (previous) {
          if (previous.creationPayloadHash !== creationPayloadHash) return containerFailure('CONTAINER_IDEMPOTENCY_CONFLICT', '该提交标识已用于不同的柜次资料', 409)
          return serialize(previous)
        }
        const [{ now }] = await tx.$queryRaw<[{ now: Date }]>(Prisma.sql`SELECT transaction_timestamp() AS now`)
        const date = deriveContainerDate(normalized.containerBatchName, now)
        await this.dictionary.requireEffectiveValue(tx, { dictionaryCode: 'mainland.warehouse', value: normalized.warehouseValue })
        await this.sourceFiles.attach(tx, normalized.sourceFileId, context.actorUserId)
        const issuance = await this.numbering.generateScopedInTransaction(tx, { ruleCode: 'CONTAINER_BATCH_NO', consumerCode: 'CONTAINER_BATCH.CREATE', idempotencyKey: `${context.actorUserId}:${creationRequestKey}`, requestFingerprint: creationPayloadHash })
        const row = await tx.containerBatch.create({ data: { ...normalized, ...date, containerBatchNo: issuance.number, numberingIssuanceId: issuance.issuanceId, creationRequestKey, creationPayloadHash, createdById: context.actorUserId, updatedById: context.actorUserId } })
        await this.audit.record(tx, { eventType: 'CONTAINER_BATCH_CREATED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId, targetType: 'CONTAINER_BATCH', targetId: row.id, metadata: { containerBatchNo: row.containerBatchNo, warehouseValue: row.warehouseValue } })
        return serialize(row)
      }, { timeout: 30_000 })
    } catch (error) { return mapError(error) }
  }

  async get(id: string): Promise<ContainerBatchDto> {
    const row = await this.prisma.containerBatch.findUnique({ where: { id: containerUuid(id) }, include: containerSummaryInclude })
    if (!row) return containerFailure('CONTAINER_BATCH_NOT_FOUND', '柜次不存在', 404)
    return serialize(row)
  }
  async list(query: ContainerBatchListQueryDto) {
    const search = query.search?.trim()
    const where: Prisma.ContainerBatchWhereInput = { ...(query.warehouseValue ? { warehouseValue: query.warehouseValue } : {}), ...(search ? { OR: [{ containerBatchName: { contains: search, mode: 'insensitive' } }, { containerBatchNo: { contains: search, mode: 'insensitive' } }] } : {}) }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.containerBatch.findMany({ where, include: containerSummaryInclude, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ loadingDate: 'desc' }, { id: 'desc' }] }),
      this.prisma.containerBatch.count({ where }),
    ], { isolationLevel: 'RepeatableRead' })
    return { items: rows.map(serialize), total }
  }
  async items(id: string, query: ContainerBatchListQueryDto, actorUserId?: string) {
    await this.get(id)
    const permissions = actorUserId ? await this.access.getPermissionCodes(actorUserId) : []
    const canPurchase = permissions.includes('purchase-orders:read'), canSales = permissions.includes('sales-orders:read')
    const search = query.search?.trim()
    const where: Prisma.ContainerLoadingItemWhereInput = { containerBatchId: id, ...(search ? { OR: [
      { goodsName: { contains: search, mode: 'insensitive' } },
      { oceanShippingMarkText: { contains: search, mode: 'insensitive' } },
      { warehouseReceiptReference: { contains: search, mode: 'insensitive' } },
    ] } : {}) }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.containerLoadingItem.findMany({ where, include: { shipment: { select: { shipmentNo: true, shippingMarkText: true, purchaseOrder: { select: { id: true, orderNo: true, salesOrder: { select: { id: true, orderNo: true } } } } } } }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: { lineNumber: 'asc' } }),
      this.prisma.containerLoadingItem.count({ where }),
    ], { isolationLevel: 'RepeatableRead' })
    return { items: rows.map(row => serializeItem(row, canPurchase, canSales)), total }
  }

  async createItem(context: ContainerCommandContext, rawId: string, input: ContainerLoadingItemCreateDto, key: unknown): Promise<ContainerLoadingItemDto> {
    const id = containerUuid(rawId), creationRequestKey = containerUuid(key)
    const normalized = normalizeLoadingItemCreate(input), expectedVersion = requireContainerVersion(input.expectedVersion)
    // 新增可空来源字段不改变阶段 1 的请求身份，已创建明细仍可使用原请求重试。
    const { grossWeightKg, lengthCm, widthCm, heightCm, reportedVolumeCai, recipientName, recipientPhone, recipientAddress, codAmountTwd, ...legacy } = normalized
    const measurements = Object.fromEntries(Object.entries({ grossWeightKg, lengthCm, widthCm, heightCm, reportedVolumeCai, recipientName, recipientPhone, recipientAddress, codAmountTwd }).filter(([, value]) => value !== null))
    const creationPayloadHash = hash({ format: 'container.item.create.v1', actorUserId: context.actorUserId, ...legacy, ...measurements, expectedVersion })
    // 按完整尺寸表达式先乘件数再取整；缺值保留 null，越界在打开事务前拒绝。
    const { volumeCai, chargeableVolumeCai } = calculateOceanVolume(normalized)
    try {
      return await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId, 'container-batches:update')
        await tx.$queryRaw(Prisma.sql`SELECT id FROM container_batches WHERE id = ${id}::uuid FOR UPDATE`)
        const batch = await tx.containerBatch.findUnique({ where: { id } })
        if (!batch) return containerFailure('CONTAINER_BATCH_NOT_FOUND', '柜次不存在', 404)
        const previous = await tx.containerLoadingItem.findUnique({ where: { containerBatchId_creationRequestKey: { containerBatchId: id, creationRequestKey } } })
        if (previous) {
          if (previous.creationPayloadHash !== creationPayloadHash) return containerFailure('CONTAINER_IDEMPOTENCY_CONFLICT', '该提交标识已用于不同的装柜明细', 409)
          return serializeItem(previous)
        }
        if (batch.version !== expectedVersion) return containerFailure('CONTAINER_STATE_CHANGED', '柜次已更新，请刷新后重试', 409)
        if (normalized.shipmentId) {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM purchase_order_parts WHERE id = ${normalized.shipmentId}::uuid FOR UPDATE`)
          const shipment = await tx.purchaseOrderPart.findUnique({ where: { id: normalized.shipmentId }, select: { status: true } })
          if (!shipment || shipment.status !== 'ACTIVE') return containerFailure('CONTAINER_SHIPMENT_UNAVAILABLE', '货件不存在或已经取消')
          const elsewhere = await tx.containerLoadingItem.findFirst({ where: { shipmentId: normalized.shipmentId, containerBatchId: { not: id } }, select: { id: true } })
          if (elsewhere) return containerFailure('CONTAINER_SHIPMENT_ALREADY_ASSIGNED', '该货件已分配到其他柜次，首版不允许跨柜拆分', 409)
        }
        const last = await tx.containerLoadingItem.aggregate({ where: { containerBatchId: id }, _max: { lineNumber: true } })
        const row = await tx.containerLoadingItem.create({ data: { ...normalized, volumeCai, chargeableVolumeCai, containerBatchId: id, lineNumber: (last._max.lineNumber ?? 0) + 1, creationRequestKey, creationPayloadHash, createdById: context.actorUserId, updatedById: context.actorUserId } })
        await tx.containerBatch.update({ where: { id }, data: { version: { increment: 1 }, updatedById: context.actorUserId } })
        await this.audit.record(tx, { eventType: 'CONTAINER_LOADING_ITEM_CREATED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId, targetType: 'CONTAINER_LOADING_ITEM', targetId: row.id, metadata: { containerBatchId: id, shipmentId: row.shipmentId, lineNumber: row.lineNumber } })
        return serializeItem(row)
      }, { timeout: 30_000 })
    } catch (error) { return mapError(error) }
  }

  async update(context: ContainerCommandContext, rawId: string, input: unknown): Promise<ContainerBatchDto> {
    const id = containerUuid(rawId), { expectedVersion, ...normalized } = normalizeContainerUpdate(input)
    try {
      return await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId, 'container-batches:update')
        await tx.$queryRaw(Prisma.sql`SELECT id FROM container_batches WHERE id = ${id}::uuid FOR UPDATE`)
        const previous = await tx.containerBatch.findUnique({ where: { id } })
        if (!previous) return containerFailure('CONTAINER_BATCH_NOT_FOUND', '柜次不存在', 404)
        if (previous.version !== expectedVersion) return containerFailure('CONTAINER_STATE_CHANGED', '柜次已更新，请刷新后重试', 409)
        // 编辑沿用首次派发时的年份；跨年修改不应把历史柜次变成本年度柜次。
        const date = deriveContainerDate(normalized.containerBatchName, previous.createdAt)
        if (previous.warehouseValue !== normalized.warehouseValue) await this.dictionary.requireEffectiveValue(tx, { dictionaryCode: 'mainland.warehouse', value: normalized.warehouseValue })
        if (previous.sourceFileId !== normalized.sourceFileId) {
          if (previous.sourceFileId !== null) return containerFailure('CONTAINER_SOURCE_FILE_LOCKED', '已有来源文件暂不支持移除或替换，请保留原文件')
          await this.sourceFiles.attach(tx, normalized.sourceFileId, context.actorUserId)
        }
        const row = await tx.containerBatch.update({ where: { id }, data: { ...normalized, ...date, version: { increment: 1 }, updatedById: context.actorUserId }, include: containerSummaryInclude })
        await this.audit.record(tx, { eventType: 'CONTAINER_BATCH_UPDATED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId, targetType: 'CONTAINER_BATCH', targetId: id, metadata: { previousVersion: previous.version, version: row.version, warehouseValue: row.warehouseValue } })
        return serialize(row)
      }, { timeout: 30_000 })
    } catch (error) { return mapError(error) }
  }

  async updateItem(context: ContainerCommandContext, rawId: string, rawItemId: string, input: unknown): Promise<ContainerLoadingItemDto> {
    const id = containerUuid(rawId), itemId = containerUuid(rawItemId)
    const { expectedVersion, itemExpectedVersion, ...normalized } = normalizeLoadingItemUpdate(input)
    const { volumeCai, chargeableVolumeCai } = calculateOceanVolume(normalized)
    try {
      return await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId, 'container-batches:update')
        await tx.$queryRaw(Prisma.sql`SELECT id FROM container_batches WHERE id = ${id}::uuid FOR UPDATE`)
        const batch = await tx.containerBatch.findUnique({ where: { id } })
        if (!batch) return containerFailure('CONTAINER_BATCH_NOT_FOUND', '柜次不存在', 404)
        await tx.$queryRaw(Prisma.sql`SELECT id FROM container_loading_items WHERE id = ${itemId}::uuid AND container_batch_id = ${id}::uuid FOR UPDATE`)
        const previous = await tx.containerLoadingItem.findFirst({ where: { id: itemId, containerBatchId: id } })
        if (!previous) return containerFailure('CONTAINER_LOADING_ITEM_NOT_FOUND', '装柜明细不存在', 404)
        if (batch.version !== expectedVersion || previous.version !== itemExpectedVersion) return containerFailure('CONTAINER_STATE_CHANGED', '柜次或装柜明细已更新，请刷新后重试', 409)
        if (normalized.shipmentId) {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM purchase_order_parts WHERE id = ${normalized.shipmentId}::uuid FOR UPDATE`)
          const shipment = await tx.purchaseOrderPart.findUnique({ where: { id: normalized.shipmentId }, select: { status: true } })
          if (!shipment || shipment.status !== 'ACTIVE') return containerFailure('CONTAINER_SHIPMENT_UNAVAILABLE', '货件不存在或已经取消')
          if (await tx.containerLoadingItem.findFirst({ where: { shipmentId: normalized.shipmentId, containerBatchId: { not: id } }, select: { id: true } })) return containerFailure('CONTAINER_SHIPMENT_ALREADY_ASSIGNED', '该货件已分配到其他柜次，首版不允许跨柜拆分', 409)
        }
        const row = await tx.containerLoadingItem.update({ where: { id: itemId }, data: { ...normalized, volumeCai, chargeableVolumeCai, version: { increment: 1 }, updatedById: context.actorUserId } })
        await tx.containerBatch.update({ where: { id }, data: { version: { increment: 1 }, updatedById: context.actorUserId } })
        await this.audit.record(tx, { eventType: 'CONTAINER_LOADING_ITEM_UPDATED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId, targetType: 'CONTAINER_LOADING_ITEM', targetId: itemId, metadata: { containerBatchId: id, previousVersion: previous.version, version: row.version, previousShipmentId: previous.shipmentId, shipmentId: row.shipmentId } })
        return serializeItem(row)
      }, { timeout: 30_000 })
    } catch (error) { return mapError(error) }
  }
}
