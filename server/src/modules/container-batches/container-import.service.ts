import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { containerFailure, containerUuid, type ContainerCommandContext } from './container-batch.normalizer'
import type { ContainerImportConfirmDto, ContainerImportPreviewDto, ContainerImportResultDto, ContainerImportRowDto } from './container-import.dto'
import { importHash, importRowIdentity, normalizeContainerImport, normalizeParsedFields, validateParsedRows } from './container-import.normalizer'
import { findImportCandidates, lockImportShipments, serializeImportCandidate } from './container-import.shipments'
import { ContainerSourceFileService } from './container-source-file.service'
import { ContainerWorkbookParseError, parseContainerWorkbook } from './import-parser'
import { matchContainerShipment } from './import-matching'

const permissions = ['container-batches:read', 'container-batches:update', 'purchase-orders:read']
@Injectable()
export class ContainerImportService {
  constructor(private readonly prisma: PrismaService, private readonly source: ContainerSourceFileService, private readonly access: AccessControlService, private readonly audit: AuditService) {}

  private async authorize(tx: Prisma.TransactionClient, actorUserId: string) {
    const user = await tx.user.findUnique({ where: { id: containerUuid(actorUserId) }, select: { status: true } })
    const codes = await this.access.getPermissionCodesInTransaction(tx, actorUserId)
    if (user?.status !== 'ACTIVE' || !this.access.hasAll(codes, permissions)) return containerFailure('FORBIDDEN', '权限不足', 403)
    return codes
  }
  private async readSource(context: ContainerCommandContext, id: string) {
    // 在媒体读取/解压前复查权限，命令提交事务内再次核验，覆盖运行中权限变化。
    await this.prisma.$transaction(tx => this.authorize(tx, context.actorUserId))
    const source = await this.source.readForImport(id)
    try {
      const parsed = await parseContainerWorkbook(source.bytes)
      if (!parsed.rows.length || parsed.rows.length > 2000) return containerFailure('CONTAINER_IMPORT_SOURCE_INVALID', '来源表格须包含 1 至 2000 行装柜明细')
      return { ...source, parsed }
    } catch (error) {
      if (error instanceof ContainerWorkbookParseError) return containerFailure('CONTAINER_IMPORT_SOURCE_INVALID', error.message)
      throw error
    }
  }

  async preview(context: ContainerCommandContext, rawId: string): Promise<ContainerImportPreviewDto> {
    const id = containerUuid(rawId), source = await this.readSource(context, id)
    return this.prisma.$transaction(async tx => {
      const codes = await this.authorize(tx, context.actorUserId)
      const batch = await tx.containerBatch.findUnique({ where: { id } })
      if (!batch) return containerFailure('CONTAINER_BATCH_NOT_FOUND', '柜次不存在', 404)
      if (batch.sourceFileId !== source.sourceFileId) return containerFailure('CONTAINER_IMPORT_SOURCE_CHANGED', '来源文件已变化，请重新解析', 409)
      const parsedRows = validateParsedRows(source.parsed.rows, batch)
      const [shipments, existing] = await Promise.all([
        findImportCandidates(tx, parsedRows.map(row => row.warehouseReceiptReference)),
        tx.containerLoadingItem.findMany({ where: { containerBatchId: id }, select: { creationRequestKey: true, oceanShippingMarkText: true } }),
      ])
      const importedIdentities = new Set(existing.map(row => row.creationRequestKey))
      const alreadyImported = parsedRows.some(row => importedIdentities.has(importRowIdentity(source.sourceHash, row)))
      const rows: ContainerImportRowDto[] = parsedRows.map(parsed => {
        const { sourceData, ...row } = parsed
        void sourceData
        const match = matchContainerShipment(row.warehouseReceiptReference, shipments)
        const candidates = shipments.filter(candidate => match.candidateIds.includes(candidate.id)).map(candidate => serializeImportCandidate(candidate, id, batch.warehouseValue, codes.includes('sales-orders:read')))
        const eligibleMatch = candidates.find(candidate => candidate.id === match.shipmentId && candidate.eligible)
        const errors = [...row.errors]
        if (!alreadyImported && row.oceanShippingMarkText && existing.some(item => item.oceanShippingMarkText === row.oceanShippingMarkText)) errors.push('当前柜次已存在相同海运唛头的明细，请核对已有记录')
        const fieldNames = { shippingMarkText: '货件唛头', trackingNo: '物流单号', shipmentNo: '货件编号' }
        const matchReason = eligibleMatch ? [...new Set(match.evidence.filter(evidence => evidence.shipmentId === eligibleMatch.id).map(evidence => fieldNames[evidence.field]))].join('、') + '精确匹配' : candidates.find(candidate => !candidate.eligible)?.ineligibleReason ?? match.reason
        return { ...row, errors, candidates, matchedShipmentId: errors.length ? null : eligibleMatch?.id ?? null,
          matchStatus: errors.length ? 'INVALID' : eligibleMatch ? 'MATCHED' : candidates.length ? 'AMBIGUOUS' : 'UNMATCHED',
          matchReason }
      })
      return { containerBatchId: id, containerBatchName: batch.containerBatchName, containerBatchNo: batch.containerBatchNo,
        warehouseValue: batch.warehouseValue, expectedVersion: batch.version, sourceFileId: source.sourceFileId, sourceFilename: source.sourceFilename,
        sourceHash: source.sourceHash, alreadyImported, rows, warnings: source.parsed.warnings }
    }, { isolationLevel: 'RepeatableRead', timeout: 30_000 })
  }

  async confirm(context: ContainerCommandContext, rawId: string, rawInput: ContainerImportConfirmDto, rawKey: unknown): Promise<ContainerImportResultDto> {
    const id = containerUuid(rawId), requestKey = containerUuid(rawKey), input = normalizeContainerImport(rawInput)
    const source = await this.readSource(context, id)
    if (source.sourceFileId !== input.sourceFileId || source.sourceHash !== input.sourceHash) return containerFailure('CONTAINER_IMPORT_SOURCE_CHANGED', '来源文件与预览不一致，请重新解析', 409)
    const selection = new Map(input.rows.map(row => [row.rowKey, row.shipmentId]))
    if (selection.size !== source.parsed.rows.length || source.parsed.rows.some(row => !selection.has(row.rowKey))) return containerFailure('CONTAINER_IMPORT_ROWS_INVALID', '必须提交来源文件中的完整明细，不能遗漏或增加行')
    const unmatchedCount = input.rows.filter(row => row.shipmentId === null).length
    if (unmatchedCount && !input.allowUnmatched) return containerFailure('CONTAINER_IMPORT_UNMATCHED', '存在未匹配货件的明细，请完成匹配或明确确认不关联货件')
    const payloadHash = importHash({ format: 'container.import.v1', sourceFileId: input.sourceFileId, sourceHash: input.sourceHash, rows: input.rows, allowUnmatched: input.allowUnmatched })
    try {
      return await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId)
        await tx.$queryRaw(Prisma.sql`SELECT id FROM container_batches WHERE id = ${id}::uuid FOR UPDATE`)
        const batch = await tx.containerBatch.findUnique({ where: { id } })
        if (!batch) return containerFailure('CONTAINER_BATCH_NOT_FOUND', '柜次不存在', 404)
        if (batch.sourceFileId !== source.sourceFileId) return containerFailure('CONTAINER_IMPORT_SOURCE_CHANGED', '柜次来源文件已变化，请重新解析', 409)
        const identities = source.parsed.rows.map(row => importRowIdentity(source.sourceHash, row))
        const previous = await tx.containerLoadingItem.findMany({ where: { containerBatchId: id, creationRequestKey: { in: identities } }, select: { creationPayloadHash: true } })
        // 稳定来源行身份不依赖客户端随机重试键，换一个请求键也不能重复导入整表。
        if (previous.length) {
          if (previous.length !== identities.length) return containerFailure('CONTAINER_IMPORT_ALREADY_IMPORTED', '来源表格已有部分导入记录，请核对柜次明细', 409)
          if (previous.some(row => row.creationPayloadHash !== payloadHash)) return containerFailure('CONTAINER_IDEMPOTENCY_CONFLICT', '来源表格已按其他匹配结果导入，请编辑已有明细', 409)
          return { containerBatchId: id, importedCount: previous.length, unmatchedCount, replayed: true }
        }
        if (batch.version !== input.expectedVersion) return containerFailure('CONTAINER_STATE_CHANGED', '柜次资料已更新，请重新解析核对后导入', 409)
        const rows = validateParsedRows(source.parsed.rows, batch)
        if (rows.some(row => row.errors.length)) return containerFailure('CONTAINER_IMPORT_ROWS_INVALID', '来源表格存在数据异常，请修正后再导入')
        const marks = rows.flatMap(row => row.oceanShippingMarkText ? [row.oceanShippingMarkText] : [])
        if (marks.length && await tx.containerLoadingItem.findFirst({ where: { containerBatchId: id, oceanShippingMarkText: { in: marks } }, select: { id: true } })) return containerFailure('CONTAINER_IMPORT_MARK_CONFLICT', '当前柜次已存在相同海运唛头的明细，请核对已有记录', 409)
        await lockImportShipments(tx, input.rows.flatMap(row => row.shipmentId ? [row.shipmentId] : []), id, batch.warehouseValue)
        const last = await tx.containerLoadingItem.aggregate({ where: { containerBatchId: id }, _max: { lineNumber: true } })
        for (const [index, row] of rows.entries()) {
          const inserted = await tx.containerLoadingItem.create({ data: {
            ...normalizeParsedFields(row), shipmentId: selection.get(row.rowKey)!, volumeCai: row.volumeCai, chargeableVolumeCai: row.chargeableVolumeCai,
            containerBatchId: id, lineNumber: (last._max.lineNumber ?? 0) + index + 1, creationRequestKey: identities[index], creationPayloadHash: payloadHash,
            sourceSheetName: row.sourceSheetName, sourceRowNumber: row.sourceRowNumber,
            sourceData: { format: 'container.import.v1', sourceFileId: source.sourceFileId, sourceHash: source.sourceHash, requestKey, source: row.sourceData },
            createdById: context.actorUserId, updatedById: context.actorUserId,
          } })
          await this.audit.record(tx, { eventType: 'CONTAINER_LOADING_ITEM_CREATED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId, requestId: context.requestId,
            targetType: 'CONTAINER_LOADING_ITEM', targetId: inserted.id, metadata: { containerBatchId: id, shipmentId: inserted.shipmentId, lineNumber: inserted.lineNumber, sourceFileId: source.sourceFileId, sourceHash: source.sourceHash, importRequestKey: requestKey } })
        }
        await tx.containerBatch.update({ where: { id }, data: { version: { increment: 1 }, updatedById: context.actorUserId } })
        return { containerBatchId: id, importedCount: rows.length, unmatchedCount, replayed: false }
      }, { timeout: 30_000 })
    } catch (error) {
      if (error instanceof ApiException) throw error
      const facts = readPersistenceErrorFacts(error)
      if (['P2002', '23505', 'P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) return containerFailure('CONTAINER_STATE_CHANGED', '柜次或货件正在处理，请刷新后重试', 409)
      throw error
    }
  }
}
