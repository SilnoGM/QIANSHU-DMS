import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { NumberingGenerationError } from '../numbering/numbering.errors'
import { OceanFreightSourceFileService } from '../media/ocean-freight-source-file.service'
import type { OceanFreightBillCreateDto, OceanFreightBillLineCreateDto, OceanFreightBillListQueryDto } from './ocean-freight-bill.dto'
import { billFailure, fingerprint, normalizeBill, normalizeBillLine, parseCreationKey } from './ocean-freight-bill.normalizer'
import { serializeBill, serializeBillLine } from './ocean-freight-bill.serializer'

export interface OceanFreightBillContext { actorUserId: string; requestId: string }
function replay<T extends { creationPayloadHash: string }>(row: T | null, hash: string): T | null {
  if (row && row.creationPayloadHash !== hash) billFailure('OCEAN_FREIGHT_BILL_IDEMPOTENCY_CONFLICT', '该请求标识已用于不同的账单内容', 409)
  return row
}
function mapError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof NumberingGenerationError) {
    if (error.retryable) billFailure('OCEAN_FREIGHT_BILL_STATE_CHANGED', '编号状态已变化，请重试', 409)
    billFailure('OCEAN_FREIGHT_BILL_NUMBERING_UNAVAILABLE', '海运账单编号规则当前不可用')
  }
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505', 'P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
    billFailure('OCEAN_FREIGHT_BILL_STATE_CHANGED', '海运账单状态已变化，请重试', 409)
  }
  throw error
}
@Injectable()
export class OceanFreightBillService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessControlService,
    private readonly numbering: NumberingGeneratorService, private readonly audit: AuditService,
    private readonly sourceFiles: OceanFreightSourceFileService) {}

  private async authorize(tx: Prisma.TransactionClient, actorUserId: string, permissions: string[]) {
    const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { status: true } })
    const granted = await this.access.getPermissionCodesInTransaction(tx, actorUserId)
    if (user?.status !== 'ACTIVE' || !this.access.hasAll(granted, permissions)) billFailure('FORBIDDEN', '权限不足', 403)
  }
  async create(context: OceanFreightBillContext, input: OceanFreightBillCreateDto, key: unknown) {
    const command = normalizeBill(input), creationRequestKey = parseCreationKey(key), creationPayloadHash = fingerprint(command)
    try {
      const row = await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId, ['ocean-freight-bills:create'])
        // 相同操作者与请求键先串行，再查询重放；编号与业务记录一同提交，失败不耗号。
        await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`ocean-bill:${context.actorUserId}:${creationRequestKey}`}, 0))`)
        const previous = replay(await tx.oceanFreightBill.findUnique({ where: { createdById_creationRequestKey: { createdById: context.actorUserId, creationRequestKey } } }), creationPayloadHash)
        if (previous) return previous
        await this.sourceFiles.attach(tx, command.sourceFileId, context.actorUserId)
        const issuance = await this.numbering.generateScopedInTransaction(tx, { ruleCode: 'CTN_BILL_NO', consumerCode: 'OCEAN_FREIGHT_BILL.CREATE', idempotencyKey: `${context.actorUserId}:${creationRequestKey}`, requestFingerprint: creationPayloadHash })
        const created = await tx.oceanFreightBill.create({ data: { ...command, billNo: issuance.number, numberingIssuanceId: issuance.issuanceId,
          creationRequestKey, creationPayloadHash, createdById: context.actorUserId, updatedById: context.actorUserId } })
        await this.audit.record(tx, { eventType: 'OCEAN_FREIGHT_BILL_CREATED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
          targetType: 'OCEAN_FREIGHT_BILL', targetId: created.id, requestId: context.requestId, metadata: { billNo: created.billNo } })
        return created
      }, { timeout: 15000 })
      return serializeBill(row)
    } catch (error) { return mapError(error) }
  }
  async createLine(context: OceanFreightBillContext, billId: string, input: OceanFreightBillLineCreateDto, key: unknown) {
    const command = normalizeBillLine(input), creationRequestKey = parseCreationKey(key), creationPayloadHash = fingerprint({ actorUserId: context.actorUserId, ...command })
    try {
      const row = await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId, ['ocean-freight-bills:read', 'ocean-freight-bills:update'])
        // 父账单锁同时保护单内行序号和行重试；装柜明细锁保护跨账单正常计费唯一性。
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ocean_freight_bills WHERE id = ${billId}::uuid FOR UPDATE`)
        if (!await tx.oceanFreightBill.findUnique({ where: { id: billId } })) billFailure('OCEAN_FREIGHT_BILL_NOT_FOUND', '海运账单不存在', 404)
        const previous = replay(await tx.oceanFreightBillLine.findUnique({ where: { billId_creationRequestKey: { billId, creationRequestKey } } }), creationPayloadHash)
        if (previous) return previous
        let matched = false
        if (command.loadingItemId) {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM container_loading_items WHERE id = ${command.loadingItemId}::uuid FOR UPDATE`)
          const loadingItem = await tx.containerLoadingItem.findUnique({ where: { id: command.loadingItemId } })
          if (!loadingItem) billFailure('OCEAN_FREIGHT_LINE_REFERENCE_INVALID', '关联装柜明细不存在')
          matched = loadingItem.shipmentId !== null
          if (command.lineType === 'NORMAL' && await tx.oceanFreightBillLine.findFirst({ where: { loadingItemId: command.loadingItemId, lineType: 'NORMAL' }, select: { id: true } })) {
            billFailure('OCEAN_FREIGHT_NORMAL_LINE_EXISTS', '该装柜明细已存在正常计费账单行', 409)
          }
        }
        if (command.adjustsBillLineId) {
          const original = await tx.oceanFreightBillLine.findUnique({ where: { id: command.adjustsBillLineId } })
          // 调整只指向正常历史行，避免形成调整链及循环；不自动继承历史代收金额。
          if (!original || original.lineType !== 'NORMAL' || !command.loadingItemId || original.loadingItemId !== command.loadingItemId) {
            billFailure('OCEAN_FREIGHT_LINE_REFERENCE_INVALID', '调整明细必须关联同一装柜明细的正常账单行')
          }
        }
        const maximum = await tx.oceanFreightBillLine.aggregate({ where: { billId }, _max: { lineNumber: true } })
        const created = await tx.oceanFreightBillLine.create({ data: { ...command, billId, lineNumber: (maximum._max.lineNumber ?? 0) + 1,
          creationRequestKey, creationPayloadHash, reconciliationStatus: matched ? 'PENDING' : 'UNMATCHED' } })
        await tx.oceanFreightBill.update({ where: { id: billId }, data: { version: { increment: 1 }, updatedById: context.actorUserId } })
        await this.audit.record(tx, { eventType: 'OCEAN_FREIGHT_BILL_LINE_CREATED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
          targetType: 'OCEAN_FREIGHT_BILL_LINE', targetId: created.id, requestId: context.requestId, metadata: { billId, lineType: created.lineType, loadingItemId: created.loadingItemId } })
        return created
      }, { timeout: 15000 })
      return serializeBillLine(row)
    } catch (error) { return mapError(error) }
  }
  async list(query: OceanFreightBillListQueryDto) {
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20
    const keyword = query.keyword?.trim()
    const where: Prisma.OceanFreightBillWhereInput = keyword ? { OR: [{ billNo: { contains: keyword, mode: 'insensitive' } }, { billName: { contains: keyword, mode: 'insensitive' } }] } : {}
    const [items, total] = await this.prisma.$transaction([this.prisma.oceanFreightBill.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), this.prisma.oceanFreightBill.count({ where })], { isolationLevel: 'RepeatableRead' })
    return { items: items.map(serializeBill), total, page, pageSize }
  }
  async detail(id: string) {
    const row = await this.prisma.oceanFreightBill.findUnique({ where: { id } })
    if (!row) billFailure('OCEAN_FREIGHT_BILL_NOT_FOUND', '海运账单不存在', 404)
    return serializeBill(row)
  }
  async lines(id: string, query: OceanFreightBillListQueryDto) {
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20
    return this.prisma.$transaction(async tx => {
      if (!await tx.oceanFreightBill.findUnique({ where: { id } })) billFailure('OCEAN_FREIGHT_BILL_NOT_FOUND', '海运账单不存在', 404)
      const keyword = query.keyword?.trim()
      const where: Prisma.OceanFreightBillLineWhereInput = { billId: id, ...(keyword ? { OR: [{ goodsName: { contains: keyword, mode: 'insensitive' as const } }, { oceanShippingMarkText: { contains: keyword, mode: 'insensitive' as const } }] } : {}) }
      const items = await tx.oceanFreightBillLine.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { lineNumber: 'asc' } })
      const total = await tx.oceanFreightBillLine.count({ where })
      return { items: items.map(serializeBillLine), total, page, pageSize }
    }, { isolationLevel: 'RepeatableRead' })
  }
}
