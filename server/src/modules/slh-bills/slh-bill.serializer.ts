import { Prisma } from '../../generated/prisma/client'
import {
  SlhBillChargeTypeDto, SlhBillFindingKindDto, SlhBillFindingSeverityDto, SlhBillPricingBasisDto, SlhBillRateSourceDto,
  type SlhBillDto, type SlhBillFindingDto, type SlhBillLineDto, type SlhBillListItemDto, type SlhBillPreviewLineDto,
} from './slh-bill.dto'
import type { ParsedSlhBillLine, SlhBillFinding } from './slh-bill-parser.types'

export function toFindingDto(finding: SlhBillFinding): SlhBillFindingDto {
  return {
    kind: finding.kind as SlhBillFindingKindDto,
    severity: finding.severity as SlhBillFindingSeverityDto,
    lineNumber: finding.lineNumber,
    sourceRowNumber: finding.sourceRowNumber,
    message: finding.message,
  }
}

/** 落库的快照是 JSONB，读回来时按字段收敛，避免历史形状漂移直接漏到接口。 */
export function serializeStoredFindings(value: Prisma.JsonValue): SlhBillFindingDto[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const kind = typeof record.kind === 'string' ? record.kind : null
    const severity = record.severity === 'difference' || record.severity === 'warning' ? record.severity : null
    const message = typeof record.message === 'string' ? record.message : null
    const lineNumber = typeof record.lineNumber === 'number' ? record.lineNumber : null
    const sourceRowNumber = typeof record.sourceRowNumber === 'number' ? record.sourceRowNumber : null
    if (kind === null || severity === null || message === null) return []
    return [{ kind: kind as SlhBillFindingKindDto, severity: severity as SlhBillFindingSeverityDto, lineNumber, sourceRowNumber, message }]
  })
}

export const slhBillRateInclude = {
  exchangeRate: { select: { id: true, foreignUnitsPerCny: true, version: true } },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.SlhBillInclude

export const slhBillListInclude = {
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.SlhBillInclude

export type SlhBillRow = Prisma.SlhBillGetPayload<{ include: typeof slhBillRateInclude }>
export type SlhBillListRow = Prisma.SlhBillGetPayload<{ include: typeof slhBillListInclude }>

/** 账单原值的逐行差异在入库后不再重算：账单已冻结，明细只读出已落库的事实。 */
export function serializeSlhBillLine(row: Prisma.SlhBillLineGetPayload<{ include: { charges: true } }>): SlhBillLineDto {
  const volumeDifference = row.volumeCai !== null && row.reportedVolumeCai !== null
    ? row.volumeCai.minus(row.reportedVolumeCai).toFixed(2)
    : null
  return {
    lineNumber: row.lineNumber,
    sourceRowNumber: row.sourceRowNumber,
    loadingDate: row.loadingDate.toISOString().slice(0, 10),
    containerBatchNameText: row.containerBatchNameText,
    containerBatchId: row.containerBatchId,
    warehouseReceiptReference: row.warehouseReceiptReference,
    shippingMarkText: row.shippingMarkText,
    goodsName: row.goodsName,
    packageCount: row.packageCount,
    packageUnit: row.packageUnit,
    grossWeightKg: row.grossWeightKg?.toFixed(3) ?? null,
    weightUnit: row.weightUnit,
    lengthCm: row.lengthCm?.toFixed(2) ?? null,
    widthCm: row.widthCm?.toFixed(2) ?? null,
    heightCm: row.heightCm?.toFixed(2) ?? null,
    volumeCai: row.volumeCai?.toFixed(2) ?? null,
    reportedVolumeCai: row.reportedVolumeCai?.toFixed(2) ?? null,
    volumeDifferenceCai: volumeDifference,
    categoryCode: row.categoryCode,
    unitPriceAmount: row.unitPriceAmount?.toFixed(2) ?? null,
    pricingBasis: row.pricingBasis === null ? null : row.pricingBasis as SlhBillPricingBasisDto,
    freightAmountCny: row.freightAmountCny.toFixed(2),
    codHandlingAmountCny: row.codHandlingAmountCny.toFixed(2),
    surchargeAmountCny: row.surchargeAmountCny.toFixed(2),
    payableAmountCny: row.payableAmountCny.toFixed(2),
    codAmountTwd: row.codAmountTwd.toFixed(2),
    ntdSurchargeAmountTwd: row.ntdSurchargeAmountTwd.toFixed(2),
    recipientInfoRaw: row.recipientInfoRaw,
    remark: row.remark,
    charges: row.charges.map(charge => ({
      chargeType: charge.chargeType as SlhBillChargeTypeDto,
      currencyCode: charge.currencyCode,
      amount: charge.amount.toFixed(2),
      sourceRemarkText: charge.sourceRemarkText,
    })),
  }
}

export function serializeSlhBillPreviewLine(line: ParsedSlhBillLine, findings: readonly SlhBillFinding[]): SlhBillPreviewLineDto {
  return {
    lineNumber: line.lineNumber,
    sourceRowNumber: line.sourceRowNumber,
    loadingDate: line.loadingDate,
    containerBatchNameText: line.containerBatchName,
    containerBatchId: null,
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
    volumeDifferenceCai: null,
    categoryCode: line.categoryCode,
    unitPriceAmount: line.unitPriceAmount,
    pricingBasis: line.pricingBasis as SlhBillPricingBasisDto | null,
    freightAmountCny: line.freightAmountCny,
    codHandlingAmountCny: line.codHandlingAmountCny,
    surchargeAmountCny: line.surchargeAmountCny,
    payableAmountCny: line.payableAmountCny,
    codAmountTwd: line.codAmountTwd,
    ntdSurchargeAmountTwd: line.ntdSurchargeAmountTwd,
    recipientInfoRaw: line.recipientInfoRaw,
    remark: line.remark,
    charges: line.charges.map(charge => ({
      chargeType: charge.chargeType as SlhBillChargeTypeDto,
      currencyCode: charge.currencyCode,
      amount: charge.amount,
      sourceRemarkText: charge.sourceRemarkText,
    })),
    // 行内提示只取本行的出入项；账单级视图用的是完整快照。
    findings: findings.filter(finding => finding.lineNumber === line.lineNumber).map(toFindingDto),
    errors: line.errors,
  }
}

function rate(row: SlhBillRow): SlhBillDto['rate'] {
  if (row.rateSource === null || row.foreignUnitsPerCnySnapshot === null || row.rateCapturedAt === null) return null
  return {
    source: row.rateSource as SlhBillRateSourceDto,
    foreignUnitsPerCny: row.foreignUnitsPerCnySnapshot.toFixed(12),
    embeddedForeignUnitsPerCny: row.embeddedForeignUnitsPerCny?.toFixed(12) ?? null,
    exchangeRateId: row.exchangeRateId,
    capturedAt: row.rateCapturedAt.toISOString(),
  }
}

export function serializeSlhBill(row: SlhBillRow): SlhBillDto {
  return {
    id: row.id,
    slhBillNo: row.slhBillNo,
    periodStart: row.periodStart.toISOString().slice(0, 10),
    periodEnd: row.periodEnd.toISOString().slice(0, 10),
    lineCount: row.lineCount,
    containerBatchCount: row.containerBatchCount,
    containerBatchNames: row.containerBatchNames.split(',').filter(Boolean),
    freightTotalAmountCny: row.freightTotalAmountCny.toFixed(2),
    codHandlingTotalAmountCny: row.codHandlingTotalAmountCny.toFixed(2),
    surchargeTotalAmountCny: row.surchargeTotalAmountCny.toFixed(2),
    payableTotalAmountCny: row.payableTotalAmountCny.toFixed(2),
    codTotalAmountTwd: row.codTotalAmountTwd.toFixed(2),
    ntdSurchargeTotalAmountTwd: row.ntdSurchargeTotalAmountTwd.toFixed(2),
    reportedNetAmountTwd: row.reportedNetAmountTwd.toFixed(2),
    rate: rate(row),
    // 账单自报值与公式原文原样留痕，详情页据此与明细累加逐项对比。
    reported: {
      subtotalPayableAmountCny: row.reportedSubtotalPayableAmountCny?.toFixed(2) ?? null,
      subtotalCodAmountTwd: row.reportedSubtotalCodAmountTwd?.toFixed(2) ?? null,
      subtotalNtdSurchargeAmountTwd: row.reportedSubtotalNtdSurchargeAmountTwd?.toFixed(2) ?? null,
      payableAmountCny: row.reportedPayableAmountCny?.toFixed(2) ?? null,
      netAmountTwd: row.reportedNetAmountCell,
      netAmountFormula: row.reportedNetAmountFormula,
      embeddedForeignUnitsPerCny: row.embeddedForeignUnitsPerCny?.toFixed(12) ?? null,
      reportedNetAmountTwd: row.reportedNetAmountTwd.toFixed(2),
    },
    findings: serializeStoredFindings(row.importFindings),
    sourceFileName: row.sourceFileName,
    sourceFileSha256: row.sourceFileSha256,
    supersededById: row.supersededById,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    createdByDisplayName: row.createdBy.displayName,
  }
}

export function serializeSlhBillListItem(row: SlhBillListRow): SlhBillListItemDto {
  return {
    id: row.id,
    slhBillNo: row.slhBillNo,
    periodStart: row.periodStart.toISOString().slice(0, 10),
    periodEnd: row.periodEnd.toISOString().slice(0, 10),
    lineCount: row.lineCount,
    containerBatchCount: row.containerBatchCount,
    payableTotalAmountCny: row.payableTotalAmountCny.toFixed(2),
    codTotalAmountTwd: row.codTotalAmountTwd.toFixed(2),
    ntdSurchargeTotalAmountTwd: row.ntdSurchargeTotalAmountTwd.toFixed(2),
    reportedNetAmountTwd: row.reportedNetAmountTwd.toFixed(2),
    rateSource: row.rateSource === null ? null : row.rateSource as SlhBillRateSourceDto,
    supersededById: row.supersededById,
    sourceFileName: row.sourceFileName,
    createdAt: row.createdAt.toISOString(),
    createdByDisplayName: row.createdBy.displayName,
  }
}
