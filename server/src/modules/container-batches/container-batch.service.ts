import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma, type ContainerBatch, type ContainerLoadingItem } from '../../generated/prisma/client'
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
import { formatDecimal, parseDecimal } from '../ocean-freight-calculation/ocean-decimal'
import type { ContainerBatchDto, ContainerBatchListQueryDto, ContainerLoadingItemCreateDto, ContainerLoadingItemDto } from './container-batch.dto'
import { containerFailure, containerUuid, deriveContainerDate, normalizeContainerCreate, normalizeLoadingItemCreate, requireContainerVersion, type ContainerCommandContext } from './container-batch.normalizer'

const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
function serialize(row: ContainerBatch): ContainerBatchDto {
  return { id: row.id, containerBatchNo: row.containerBatchNo, containerBatchName: row.containerBatchName, loadingDate: row.loadingDate.toISOString().slice(0, 10), sequenceInDay: row.sequenceInDay, warehouseValue: row.warehouseValue, sourceFileId: row.sourceFileId, remark: row.remark, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}
function serializeItem(row: ContainerLoadingItem): ContainerLoadingItemDto {
  return {
    id: row.id, containerBatchId: row.containerBatchId, shipmentId: row.shipmentId, lineNumber: row.lineNumber, oceanShippingMarkText: row.oceanShippingMarkText, warehouseReceiptReference: row.warehouseReceiptReference, goodsName: row.goodsName, packageCount: row.packageCount, packageUnit: row.packageUnit, remark: row.remark, version: row.version,
    grossWeightKg: row.grossWeightKg?.toFixed(3) ?? null,
    lengthCm: row.lengthCm?.toFixed(3) ?? null, widthCm: row.widthCm?.toFixed(3) ?? null, heightCm: row.heightCm?.toFixed(3) ?? null,
    volumeCai: row.volumeCai?.toFixed(8) ?? null, chargeableVolumeCai: row.chargeableVolumeCai,
    reportedVolumeCai: row.reportedVolumeCai?.toFixed(8) ?? null,
    // 差异也按定点数相减，避免 Decimal 默认有效位数截掉大来源值的小数位。
    volumeDifferenceCai: row.volumeCai == null || row.reportedVolumeCai == null ? null : formatDecimal(parseDecimal(row.volumeCai.toFixed(8), 24, 8, 'volumeCai') - parseDecimal(row.reportedVolumeCai.toFixed(8), 24, 8, 'reportedVolumeCai'), 24, 8, 'volumeDifferenceCai'),
  }
}
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
        const previous = await tx.containerBatch.findUnique({ where: { createdById_creationRequestKey: { createdById: context.actorUserId, creationRequestKey } } })
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
    const row = await this.prisma.containerBatch.findUnique({ where: { id: containerUuid(id) } })
    if (!row) return containerFailure('CONTAINER_BATCH_NOT_FOUND', '柜次不存在', 404)
    return serialize(row)
  }
  async list(query: ContainerBatchListQueryDto) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.containerBatch.findMany({ skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ loadingDate: 'desc' }, { id: 'desc' }] }),
      this.prisma.containerBatch.count(),
    ], { isolationLevel: 'RepeatableRead' })
    return { items: rows.map(serialize), total }
  }
  async items(id: string, query: ContainerBatchListQueryDto) {
    await this.get(id)
    const where = { containerBatchId: id }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.containerLoadingItem.findMany({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: { lineNumber: 'asc' } }),
      this.prisma.containerLoadingItem.count({ where }),
    ], { isolationLevel: 'RepeatableRead' })
    return { items: rows.map(serializeItem), total }
  }

  async createItem(context: ContainerCommandContext, rawId: string, input: ContainerLoadingItemCreateDto, key: unknown): Promise<ContainerLoadingItemDto> {
    const id = containerUuid(rawId), creationRequestKey = containerUuid(key)
    const normalized = normalizeLoadingItemCreate(input), expectedVersion = requireContainerVersion(input.expectedVersion)
    // 新增可空来源字段不改变阶段 1 的请求身份，已创建明细仍可使用原请求重试。
    const { grossWeightKg, lengthCm, widthCm, heightCm, reportedVolumeCai, ...legacy } = normalized
    const measurements = Object.fromEntries(Object.entries({ grossWeightKg, lengthCm, widthCm, heightCm, reportedVolumeCai }).filter(([, value]) => value !== null))
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
}
