import { createHash } from 'node:crypto'
import type { ContainerBatch } from '../../generated/prisma/client'
import { ApiException } from '../../infrastructure/http/api.exception'
import { calculateOceanVolume, OceanCalculationError } from '../ocean-freight-calculation/ocean-freight-calculation'
import { containerFailure, containerUuid, deriveContainerDate, normalizeLoadingItemCreate, requireContainerVersion } from './container-batch.normalizer'
import type { ContainerImportConfirmDto } from './container-import.dto'
import type { ParsedContainerRow } from './import-parser'

export const importHash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
export function importRowIdentity(sourceHash: string, row: ParsedContainerRow) {
  return `source:${importHash([sourceHash, row.sourceSheetName, row.sourceRowNumber])}`
}
export function normalizeContainerImport(raw: unknown): ContainerImportConfirmDto {
  const allowed = ['expectedVersion', 'sourceFileId', 'sourceHash', 'allowUnmatched', 'rows']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !allowed.includes(key))) return containerFailure('VALIDATION_FAILED', '导入请求包含无效字段')
  const input = raw as Record<string, unknown>
  if (typeof input.sourceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(input.sourceHash) || typeof input.allowUnmatched !== 'boolean'
    || !Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 2000) return containerFailure('VALIDATION_FAILED', '导入请求内容无效')
  const rows = input.rows.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['rowKey', 'shipmentId'].includes(key))) return containerFailure('VALIDATION_FAILED', '导入选择包含无效字段')
    const row = raw as Record<string, unknown>
    if (typeof row.rowKey !== 'string' || !/^[1-9]\d*:[1-9]\d*$/u.test(row.rowKey) || row.rowKey.length > 64) return containerFailure('VALIDATION_FAILED', '来源行标识无效')
    return { rowKey: row.rowKey, shipmentId: row.shipmentId === null ? null : containerUuid(row.shipmentId) }
  }).sort((left, right) => left.rowKey.localeCompare(right.rowKey))
  if (new Set(rows.map(row => row.rowKey)).size !== rows.length) return containerFailure('CONTAINER_IMPORT_ROWS_INVALID', '来源行不可重复')
  return { expectedVersion: requireContainerVersion(input.expectedVersion), sourceFileId: containerUuid(input.sourceFileId), sourceHash: input.sourceHash, allowUnmatched: input.allowUnmatched, rows }
}
export function normalizeParsedFields(row: ParsedContainerRow) {
  return normalizeLoadingItemCreate({
    goodsName: row.goodsName, packageCount: row.packageCount, packageUnit: row.packageUnit,
    warehouseReceiptReference: row.warehouseReceiptReference, oceanShippingMarkText: row.oceanShippingMarkText,
    grossWeightKg: row.grossWeightKg, lengthCm: row.lengthCm, widthCm: row.widthCm, heightCm: row.heightCm, reportedVolumeCai: row.reportedVolumeCai,
    recipientName: row.recipientName, recipientPhone: row.recipientPhone, recipientAddress: row.recipientAddress, codAmountTwd: row.codAmountTwd, remark: row.remark,
  })
}
export function validateParsedRows(rows: ParsedContainerRow[], batch: ContainerBatch) {
  const marks = new Map<string, number>()
  for (const row of rows) if (row.oceanShippingMarkText) marks.set(row.oceanShippingMarkText, (marks.get(row.oceanShippingMarkText) ?? 0) + 1)
  return rows.map(row => {
    const errors = [...row.errors]
    let volumeCai: string | null = null, chargeableVolumeCai: number | null = null
    try {
      const volume = calculateOceanVolume(normalizeParsedFields(row))
      volumeCai = volume.volumeCai; chargeableVolumeCai = volume.chargeableVolumeCai
      if (row.containerBatchName) {
        const date = deriveContainerDate(row.containerBatchName, batch.createdAt)
        if (date.loadingDate.getTime() !== batch.loadingDate.getTime() || date.sequenceInDay !== batch.sequenceInDay) errors.push('表格中的柜次名称与当前柜次不一致，请核对柜次基础资料')
      }
    } catch (error) {
      if (error instanceof ApiException) errors.push(error.message)
      else if (error instanceof OceanCalculationError) errors.push('尺寸、件数或材积超出允许范围，请修正来源表格')
      else throw error
    }
    if (row.oceanShippingMarkText && marks.get(row.oceanShippingMarkText)! > 1) errors.push('来源表格包含重复海运唛头，请核对后再导入')
    return { ...row, errors: [...new Set(errors)], volumeCai, chargeableVolumeCai }
  })
}
