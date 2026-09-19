import type { OceanFreightBill, OceanFreightBillLine } from '../../generated/prisma/client'
import type { OceanFreightBillDto, OceanFreightBillLineDto } from './ocean-freight-bill.dto'

export function serializeBill(row: OceanFreightBill): OceanFreightBillDto {
  return {
    id: row.id, billNo: row.billNo, billName: row.billName, billDate: row.billDate?.toISOString().slice(0, 10) ?? null,
    twdPerCny: row.twdPerCny.toString(), sourceFileId: row.sourceFileId, remark: row.remark, version: row.version,
    codTotalAmountTwd: row.codTotalAmountTwd?.toFixed(2) ?? null, chargeTotalAmountTwd: row.chargeTotalAmountTwd?.toFixed(2) ?? null,
    payableAmountCny: row.payableAmountCny?.toFixed(2) ?? null, returnAmountCny: row.returnAmountCny?.toFixed(2) ?? null,
    netReturnAmountCny: row.netReturnAmountCny?.toFixed(2) ?? null, reportedPayableAmountCny: row.reportedPayableAmountCny?.toFixed(2) ?? null,
    reportedReturnAmountCny: row.reportedReturnAmountCny?.toFixed(2) ?? null, reportedNetReturnAmountCny: row.reportedNetReturnAmountCny?.toFixed(2) ?? null,
    roundingDifferenceCny: row.roundingDifferenceCny?.toFixed(2) ?? null, createdById: row.createdById, updatedById: row.updatedById,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }
}
export function serializeBillLine(row: OceanFreightBillLine): OceanFreightBillLineDto {
  return {
    id: row.id, billId: row.billId, lineNumber: row.lineNumber, lineType: row.lineType, loadingItemId: row.loadingItemId,
    adjustsBillLineId: row.adjustsBillLineId, containerBatchName: row.containerBatchName, loadingDate: row.loadingDate?.toISOString().slice(0, 10) ?? null,
    goodsName: row.goodsName, warehouseReceiptReference: row.warehouseReceiptReference, oceanShippingMarkText: row.oceanShippingMarkText,
    packageCount: row.packageCount, packageUnit: row.packageUnit, grossWeightKg: row.grossWeightKg?.toString() ?? null,
    lengthCm: row.lengthCm?.toString() ?? null, widthCm: row.widthCm?.toString() ?? null, heightCm: row.heightCm?.toString() ?? null,
    volumeCai: row.volumeCai?.toString() ?? null, chargeableVolumeCai: row.chargeableVolumeCai, reportedVolumeCai: row.reportedVolumeCai?.toString() ?? null,
    recipientName: row.recipientName, recipientPhone: row.recipientPhone, recipientAddress: row.recipientAddress, recipientInfoRaw: row.recipientInfoRaw,
    cargoCategoryCode: row.cargoCategoryCode, codAmountTwd: row.codAmountTwd?.toFixed(2) ?? null, remark: row.remark,
    chargeTotalAmountTwd: row.chargeTotalAmountTwd?.toFixed(2) ?? null, payableAmountCny: row.payableAmountCny?.toFixed(2) ?? null,
    returnAmountCny: row.returnAmountCny?.toFixed(2) ?? null, netReturnAmountCny: row.netReturnAmountCny?.toFixed(2) ?? null,
    reconciliationStatus: row.reconciliationStatus, reconciliationRemark: row.reconciliationRemark, reconciledById: row.reconciledById,
    reconciledAt: row.reconciledAt?.toISOString() ?? null, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }
}
