import type { OceanFreightBill, OceanFreightBillLine } from '../../generated/prisma/client'
import type { OceanFreightBillDto, OceanFreightBillLineDto } from './ocean-freight-bill.dto'
import { formatDecimal, parseDecimal } from '../ocean-freight-calculation/ocean-decimal'
import { effectiveOceanCodAmount, readOceanCodSource } from './ocean-freight-cod-source'

export function serializeBill(row: OceanFreightBill): OceanFreightBillDto {
  return {
    id: row.id, billNo: row.billNo, billName: row.billName, billDate: row.billDate?.toISOString().slice(0, 10) ?? null,
    twdPerCny: row.twdPerCny.toFixed(12), sourceFileId: row.sourceFileId, remark: row.remark, version: row.version,
    codTotalAmountTwd: row.codTotalAmountTwd?.toFixed(2) ?? null, chargeTotalAmountTwd: row.chargeTotalAmountTwd?.toFixed(2) ?? null,
    payableAmountCny: row.payableAmountCny?.toFixed(2) ?? null, returnAmountCny: row.returnAmountCny?.toFixed(2) ?? null,
    netReturnAmountCny: row.netReturnAmountCny?.toFixed(2) ?? null, reportedPayableAmountCny: row.reportedPayableAmountCny?.toFixed(2) ?? null,
    reportedReturnAmountCny: row.reportedReturnAmountCny?.toFixed(2) ?? null, reportedNetReturnAmountCny: row.reportedNetReturnAmountCny?.toFixed(2) ?? null,
    roundingDifferenceCny: row.roundingDifferenceCny?.toFixed(2) ?? null, createdById: row.createdById, updatedById: row.updatedById,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }
}
export function serializeBillLine(row: OceanFreightBillLine): OceanFreightBillLineDto {
  const codAmount = row.codAmountTwd?.toFixed(2) ?? null
  return {
    id: row.id, billId: row.billId, lineNumber: row.lineNumber, lineType: row.lineType, loadingItemId: row.loadingItemId,
    adjustsBillLineId: row.adjustsBillLineId, containerBatchName: row.containerBatchName, loadingDate: row.loadingDate?.toISOString().slice(0, 10) ?? null,
    goodsName: row.goodsName, warehouseReceiptReference: row.warehouseReceiptReference, oceanShippingMarkText: row.oceanShippingMarkText,
    packageCount: row.packageCount, packageUnit: row.packageUnit, grossWeightKg: row.grossWeightKg?.toFixed(3) ?? null,
    lengthCm: row.lengthCm?.toFixed(3) ?? null, widthCm: row.widthCm?.toFixed(3) ?? null, heightCm: row.heightCm?.toFixed(3) ?? null,
    volumeCai: row.volumeCai?.toFixed(8) ?? null, chargeableVolumeCai: row.chargeableVolumeCai, reportedVolumeCai: row.reportedVolumeCai?.toFixed(8) ?? null,
    recipientName: row.recipientName, recipientPhone: row.recipientPhone, recipientAddress: row.recipientAddress, recipientInfoRaw: row.recipientInfoRaw,
    cargoCategoryCode: row.cargoCategoryCode, codAmountTwd: effectiveOceanCodAmount(row.sourceData, codAmount, row.lineType), remark: row.remark,
    ...readOceanCodSource(row.sourceData, codAmount, row.lineType),
    volumeDifferenceCai: row.volumeCai == null || row.reportedVolumeCai == null ? null
      : formatDecimal(parseDecimal(row.volumeCai.toFixed(), 24, 8, 'volumeCai') - parseDecimal(row.reportedVolumeCai.toFixed(), 24, 8, 'reportedVolumeCai'), 24, 8, 'volumeDifferenceCai'),
    chargeTotalAmountTwd: row.chargeTotalAmountTwd?.toFixed(2) ?? null, payableAmountCny: row.payableAmountCny?.toFixed(2) ?? null,
    returnAmountCny: row.returnAmountCny?.toFixed(2) ?? null, netReturnAmountCny: row.netReturnAmountCny?.toFixed(2) ?? null,
    reconciliationStatus: row.reconciliationStatus, reconciliationRemark: row.reconciliationRemark, reconciledById: row.reconciledById,
    reconciledAt: row.reconciledAt?.toISOString() ?? null, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }
}
