import { createHash } from 'node:crypto'
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
import { parseDecimal } from '../ocean-freight-calculation/ocean-decimal'
import { slhBillFailure } from './slh-bill-calculation'
import { parseSlhBillWorkbook, type ParsedSlhBill } from './slh-bill-parser'
import { SlhBillSourceFileService } from './slh-bill-source-file.service'
import { normalizeSlhBillImport, slhBillUuid, type SlhBillCommandContext, type SlhBillImportInput } from './slh-bill.normalizer'
import { serializeSlhBill, serializeSlhBillPreviewLine, slhBillRateInclude, toFindingDto } from './slh-bill.serializer'
import {
  type SlhBillDto, type SlhBillImportPreviewDto, type SlhBillMediaAssetDto,
} from './slh-bill.dto'

const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
/** 幂等键与指纹都以 SHA-256 落库，两者都必须是 32 字节。 */
const digest = (value: string) => Buffer.from(createHash('sha256').update(value).digest('hex'), 'hex')
const TWD = 'TWD'

function mapError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof NumberingGenerationError) return slhBillFailure('SLH_BILL_NUMBERING_UNAVAILABLE', '账单编号暂时无法派发，请检查编号规则 CTN_BILL_NO 后重试', 409)
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505'].some(code => hasPersistenceCode(facts, code))) return slhBillFailure('SLH_BILL_CONFLICT', '该账单或编号已经存在', 409)
  if (['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) return slhBillFailure('SLH_BILL_STATE_CHANGED', '资料已变化或正在处理，请刷新后重试', 409)
  throw error
}

function isoDate(value: Date): string { return value.toISOString().slice(0, 10) }

@Injectable()
export class SlhBillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingGeneratorService,
    private readonly sourceFiles: SlhBillSourceFileService,
    private readonly access: AccessControlService,
    private readonly audit: AuditService,
  ) {}

  private async authorize(tx: Prisma.TransactionClient, actorUserId: string, permission: string) {
    slhBillUuid(actorUserId)
    const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { status: true } })
    const codes = await this.access.getPermissionCodesInTransaction(tx, actorUserId)
    if (user?.status !== 'ACTIVE' || !this.access.hasAll(codes, [permission])) return slhBillFailure('FORBIDDEN', '权限不足', 403)
  }

  /**
   * 系统当前汇率：按 Currency → ExchangeRate 的确定锁序读取，缺失即明确报错，
   * 不静默兜底成 1，否则账单会带着错误汇率入库。
   */
  private async systemRate(tx: Prisma.TransactionClient) {
    const currencies = await tx.$queryRaw<Array<{ id: string, enabled: boolean }>>(Prisma.sql`
      SELECT id, enabled FROM currencies WHERE code = ${TWD} FOR SHARE`)
    const currency = currencies[0]
    if (!currency?.enabled) return slhBillFailure('SLH_BILL_RATE_UNAVAILABLE', '新台币当前未启用，请先在货币管理中启用并配置当前汇率', 409)
    const rates = await tx.$queryRaw<Array<{ id: string, version: number, rate: Prisma.Decimal }>>(Prisma.sql`
      SELECT id, version, foreign_units_per_cny AS rate FROM exchange_rates
      WHERE currency_id = ${currency.id}::uuid FOR SHARE`)
    const rate = rates[0]
    if (!rate || rate.rate.lte(0)) return slhBillFailure('SLH_BILL_RATE_UNAVAILABLE', '新台币当前缺少有效汇率，请先在货币管理中配置', 409)
    return rate
  }

  /** 预览阶段读系统汇率只供展示；入库时会在事务内重新读取并冻结。 */
  private async previewRate(): Promise<string | null> {
    const currency = await this.prisma.currency.findUnique({ where: { code: TWD }, select: { enabled: true, exchangeRate: { select: { foreignUnitsPerCny: true } } } })
    if (!currency?.enabled || !currency.exchangeRate) return null
    return currency.exchangeRate.foreignUnitsPerCny.toFixed(12)
  }

  private async findDuplicate(periodStart: string, periodEnd: string, containerBatchNames: string) {
    return this.prisma.slhBill.findFirst({
      where: {
        supersededById: null,
        containerBatchNames,
        periodStart: { lte: new Date(periodEnd) },
        periodEnd: { gte: new Date(periodStart) },
      },
      select: { id: true, slhBillNo: true, periodStart: true, periodEnd: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  private async readAndParse(mediaAssetId: string, actorUserId: string): Promise<{ parsed: ParsedSlhBill, fileName: string, checksumSha256: string, sizeBytes: number }> {
    const source = await this.sourceFiles.readForParse(mediaAssetId, actorUserId)
    const parsed = await parseSlhBillWorkbook(source.bytes)
    const failed = parsed.lines.flatMap(line => line.errors.map(error => `第 ${line.lineNumber} 行：${error}`))
    if (failed.length > 0) slhBillFailure('SLH_BILL_CONTENT_INVALID', `账单内容无法入库：${failed.slice(0, 5).join('；')}`)
    if (parsed.periodStart === '' || parsed.periodEnd === '') slhBillFailure('SLH_BILL_CONTENT_INVALID', '账单缺少可识别的装柜日期')
    return { parsed, fileName: source.fileName, checksumSha256: source.checksumSha256, sizeBytes: source.sizeBytes }
  }

  async preview(context: SlhBillCommandContext, input: SlhBillMediaAssetDto): Promise<SlhBillImportPreviewDto> {
    await this.requireCreate(context.actorUserId)
    const { parsed } = await this.readAndParse(input.mediaAssetId, context.actorUserId)
    const duplicate = await this.findDuplicate(parsed.periodStart, parsed.periodEnd, parsed.containerBatchNames.join(','))
    // 账单自带汇率时不读系统汇率：此时系统状态与账单无关，不该因为新台币停用而挡住预览。
    const systemForeignUnitsPerCny = parsed.reported.embeddedForeignUnitsPerCny === null ? await this.previewRate() : null
    return {
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      containerBatchNames: parsed.containerBatchNames,
      lineCount: parsed.lines.length,
      containerBatchCount: parsed.containerBatchNames.length,
      totals: parsed.totals,
      reported: {
        subtotalPayableAmountCny: parsed.reported.subtotalPayableAmountCny,
        subtotalCodAmountTwd: parsed.reported.subtotalCodAmountTwd,
        subtotalNtdSurchargeAmountTwd: parsed.reported.subtotalNtdSurchargeAmountTwd,
        payableAmountCny: parsed.reported.payableAmountCny,
        netAmountTwd: parsed.reported.netAmountTwd,
        netAmountFormula: parsed.reported.netAmountFormula,
        embeddedForeignUnitsPerCny: parsed.reported.embeddedForeignUnitsPerCny,
        reportedNetAmountTwd: parsed.totals.reportedNetAmountTwd,
      },
      systemForeignUnitsPerCny,
      duplicate: duplicate === null ? null : {
        billId: duplicate.id, slhBillNo: duplicate.slhBillNo,
        periodStart: isoDate(duplicate.periodStart), periodEnd: isoDate(duplicate.periodEnd),
      },
      findings: parsed.findings.map(toFindingDto),
      lines: parsed.lines.map(line => serializeSlhBillPreviewLine(line, parsed.findings)),
    }
  }

  private async requireCreate(actorUserId: string): Promise<void> {
    slhBillUuid(actorUserId)
    const user = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { status: true } })
    const codes = await this.access.getPermissionCodes(actorUserId)
    if (user?.status !== 'ACTIVE' || !this.access.hasAll(codes, ['slh-bills:create'])) return slhBillFailure('FORBIDDEN', '权限不足', 403)
  }

  async create(context: SlhBillCommandContext, raw: unknown, key: unknown): Promise<SlhBillDto> {
    const normalized: SlhBillImportInput = normalizeSlhBillImport(raw)
    const importRequestKey = slhBillUuid(key)
    const payloadHash = hash({ format: 'slh-bill.create.v1', ...normalized })
    // 解析与实体复核都在事务外完成；事务内的 attach 会重新校验摘要，文件被换掉就无法挂载。
    const { parsed, checksumSha256 } = await this.readAndParse(normalized.mediaAssetId, context.actorUserId)
    const containerBatchNames = parsed.containerBatchNames.join(',')
    if (parsed.reported.embeddedForeignUnitsPerCny !== null && normalized.manualForeignUnitsPerCny !== null) {
      slhBillFailure('VALIDATION_FAILED', '账单已自带汇率，不能再手填覆盖')
    }
    try {
      return await this.prisma.$transaction(async tx => {
        await applyTransactionTimeouts(tx)
        await this.authorize(tx, context.actorUserId, 'slh-bills:create')
        // 幂等锁在发号之前：网络重试只恢复同一张账单，不再次消耗编号。
        await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`slh-bill.create:${context.actorUserId}:${importRequestKey}`}, 0))`)
        const previous = await tx.slhBill.findUnique({
          where: { createdById_importRequestKeyHash: { createdById: context.actorUserId, importRequestKeyHash: digest(importRequestKey) } },
          include: slhBillRateInclude,
        })
        if (previous) {
          if (Buffer.from(previous.importPayloadHash).toString('hex') !== payloadHash) return slhBillFailure('SLH_BILL_IDEMPOTENCY_CONFLICT', '该提交标识已用于另一张账单', 409)
          return serializeSlhBill(previous)
        }
        const duplicate = await this.findDuplicate(parsed.periodStart, parsed.periodEnd, containerBatchNames)
        if (duplicate && !normalized.duplicateAcknowledged) {
          return slhBillFailure('SLH_BILL_DUPLICATE_PERIOD', `期间与柜号集合与账单 ${duplicate.slhBillNo} 相同，确认后可继续导入`, 409)
        }
        const superseded = normalized.supersedesBillId === null ? null : await tx.slhBill.findUnique({ where: { id: normalized.supersedesBillId }, select: { id: true, supersededById: true, slhBillNo: true } })
        if (normalized.supersedesBillId !== null) {
          if (!superseded) return slhBillFailure('SLH_BILL_NOT_FOUND', '要取代的账单不存在', 404)
          if (superseded.supersededById !== null) return slhBillFailure('SLH_BILL_STATE_CHANGED', `账单 ${superseded.slhBillNo} 已被取代`, 409)
        }

        // 汇率来源三选一：账单自带优先，其次手填，最后读系统当前汇率并冻结。
        const needsRate = parseDecimal(parsed.totals.codTotalAmountTwd, 30, 2, 'codTotalAmountTwd') > 0n
          || parseDecimal(parsed.totals.ntdSurchargeTotalAmountTwd, 30, 2, 'ntdSurchargeTotalAmountTwd') > 0n
        let rate: { source: 'EMBEDDED' | 'SYSTEM' | 'MANUAL', snapshot: string, embedded: string | null, exchangeRateId: string | null, version: number | null, capturedAt: Date | null } | null = null
        if (needsRate) {
          const capturedAt = new Date()
          if (parsed.reported.embeddedForeignUnitsPerCny !== null) {
            rate = { source: 'EMBEDDED', snapshot: parsed.reported.embeddedForeignUnitsPerCny, embedded: parsed.reported.embeddedForeignUnitsPerCny, exchangeRateId: null, version: null, capturedAt }
          }
          else if (normalized.manualForeignUnitsPerCny !== null) {
            rate = { source: 'MANUAL', snapshot: normalized.manualForeignUnitsPerCny, embedded: null, exchangeRateId: null, version: null, capturedAt }
          }
          else {
            const current = await this.systemRate(tx)
            rate = { source: 'SYSTEM', snapshot: current.rate.toFixed(12), embedded: null, exchangeRateId: current.id, version: current.version, capturedAt }
          }
        }
        const { fileName: attachedName } = await this.sourceFiles.attach(tx, normalized.mediaAssetId, context.actorUserId)
        const issuance = await this.numbering.generateScopedInTransaction(tx, {
          ruleCode: 'CTN_BILL_NO', consumerCode: 'SLH_BILL.CREATE',
          idempotencyKey: `${context.actorUserId}:${importRequestKey}`, requestFingerprint: payloadHash,
        })
        const created = await tx.slhBill.create({
          data: {
            slhBillNo: issuance.number,
            numberingIssuanceId: issuance.issuanceId,
            periodStart: new Date(parsed.periodStart),
            periodEnd: new Date(parsed.periodEnd),
            sourceFileId: normalized.mediaAssetId,
            sourceFileName: attachedName,
            sourceFileSha256: checksumSha256,
            freightTotalAmountCny: parsed.totals.freightTotalAmountCny,
            codHandlingTotalAmountCny: parsed.totals.codHandlingTotalAmountCny,
            surchargeTotalAmountCny: parsed.totals.surchargeTotalAmountCny,
            payableTotalAmountCny: parsed.totals.payableTotalAmountCny,
            codTotalAmountTwd: parsed.totals.codTotalAmountTwd,
            ntdSurchargeTotalAmountTwd: parsed.totals.ntdSurchargeTotalAmountTwd,
            reportedNetAmountTwd: parsed.totals.reportedNetAmountTwd,
            reportedPayableAmountCny: parsed.reported.payableAmountCny ?? null,
            reportedNetAmountCell: parsed.reported.netAmountTwd,
            reportedNetAmountFormula: parsed.reported.netAmountFormula,
            reportedSubtotalPayableAmountCny: parsed.reported.subtotalPayableAmountCny,
            reportedSubtotalCodAmountTwd: parsed.reported.subtotalCodAmountTwd,
            reportedSubtotalNtdSurchargeAmountTwd: parsed.reported.subtotalNtdSurchargeAmountTwd,
            // 差异快照按确认那一刻原样留痕：详情页据此复原当时看到的核对结论。
            importFindings: parsed.findings.map(toFindingDto) as unknown as Prisma.InputJsonValue,
            rateSource: rate?.source ?? null,
            foreignUnitsPerCnySnapshot: rate?.snapshot ?? null,
            embeddedForeignUnitsPerCny: rate?.embedded ?? null,
            exchangeRateId: rate?.exchangeRateId ?? null,
            exchangeRateVersionSnapshot: rate?.version ?? null,
            rateCapturedAt: rate?.capturedAt ?? null,
            lineCount: parsed.lines.length,
            containerBatchCount: parsed.containerBatchNames.length,
            containerBatchNames,
            importRequestKeyHash: digest(importRequestKey),
            importPayloadHash: digest(payloadHash),
            createdById: context.actorUserId,
            updatedById: context.actorUserId,
            lines: {
              create: parsed.lines.map(line => ({
                lineNumber: line.lineNumber,
                loadingDate: new Date(line.loadingDate),
                containerBatchNameText: line.containerBatchName,
                warehouseReceiptReference: line.warehouseReceiptReference,
                shippingMarkText: line.shippingMarkText,
                goodsName: line.goodsName,
                packageCount: line.packageCount,
                packageUnit: line.packageUnit,
                grossWeightKg: line.grossWeightKg,
                weightUnit: line.weightUnit,
                lengthCm: line.lengthCm,
                widthCm: line.widthCm,
                heightCm: line.heightCm,
                volumeCai: line.volumeCai,
                reportedVolumeCai: line.reportedVolumeCai,
                categoryCode: line.categoryCode,
                unitPriceAmount: line.unitPriceAmount,
                pricingBasis: line.pricingBasis,
                freightAmountCny: line.freightAmountCny,
                codHandlingAmountCny: line.codHandlingAmountCny,
                surchargeAmountCny: line.surchargeAmountCny,
                payableAmountCny: line.payableAmountCny,
                codAmountTwd: line.codAmountTwd,
                ntdSurchargeAmountTwd: line.ntdSurchargeAmountTwd,
                recipientInfoRaw: line.recipientInfoRaw,
                remark: line.remark,
                sourceSheetName: line.sourceSheetName,
                sourceRowNumber: line.sourceRowNumber,
                sourceData: line.sourceData,
                charges: { create: line.charges.map(charge => ({ chargeType: charge.chargeType, currencyCode: charge.currencyCode, amount: charge.amount, sourceRemarkText: charge.sourceRemarkText })) },
              })),
            },
          },
          include: slhBillRateInclude,
        })
        if (superseded) {
          await tx.slhBill.update({
            where: { id: superseded.id },
            data: { supersededById: created.id, supersededAt: new Date(), version: { increment: 1 }, updatedById: context.actorUserId },
          })
        }
        await this.audit.record(tx, {
          eventType: 'SLH_BILL_IMPORTED', outcome: 'SUCCESS', actorType: 'USER', actorUserId: context.actorUserId,
          requestId: context.requestId, targetType: 'SLH_BILL', targetId: created.id,
          metadata: { slhBillNo: created.slhBillNo, lineCount: created.lineCount, rateSource: created.rateSource, supersededBillNo: superseded?.slhBillNo ?? null },
        })
        return serializeSlhBill(created)
      }, { timeout: 60_000 })
    }
    catch (error) { return mapError(error) }
  }

  /** 详情页与下载共用：确认账单存在并返回其原件引用。 */
  async sourceFile(id: string) {
    const bill = await this.prisma.slhBill.findUnique({
      where: { id: slhBillUuid(id) },
      select: { sourceFile: { select: { objectKey: true, originalFilename: true, sizeBytes: true } } },
    })
    if (!bill) slhBillFailure('SLH_BILL_NOT_FOUND', '账单不存在', 404)
    return bill.sourceFile
  }
}
