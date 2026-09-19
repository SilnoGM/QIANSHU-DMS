import { createHash } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { OceanFreightBillCreateDto, OceanFreightBillLineCreateDto } from './ocean-freight-bill.dto'

export function billFailure(code: string, message: string, status = 422): never { throw new ApiException(status, code, message) }
const invalid = () => billFailure('VALIDATION_FAILED', '海运账单参数无效')
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
export function parseCreationKey(input: unknown): string {
  if (typeof input !== 'string' || !uuidPattern.test(input)) return invalid()
  return input.toLowerCase()
}
export function fingerprint(input: unknown): string { return createHash('sha256').update(JSON.stringify(input)).digest('hex') }
function onlyKeys(input: object, keys: string[]) { if (Object.keys(input).some(key => !keys.includes(key))) invalid() }
function text(value: unknown, max: number, required = false): string | null {
  if (value == null) { if (required) invalid(); return null }
  if (typeof value !== 'string') return invalid()
  const result = value.trim()
  if (result.length > max || (required && !result) || [...result].some(character => { const code = character.codePointAt(0)!; return code < 32 && code !== 9 && code !== 10 && code !== 13 || code === 127 })) return invalid()
  return result || null
}
function decimal(value: unknown, digits: number, scale: number, positive = false): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || !new RegExp(`^(0|[1-9]\\d{0,${digits - 1}})(\\.\\d{1,${scale}})?$`, 'u').test(value)) return invalid()
  const result = new Prisma.Decimal(value)
  if (positive && !result.gt(0)) return invalid()
  return result.toFixed()
}
function date(value: unknown): Date | null {
  if (value == null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return invalid()
  const result = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) return invalid()
  return result
}
function uuid(value: unknown): string | null { return value == null ? null : parseCreationKey(value) }
export function normalizeBill(input: OceanFreightBillCreateDto) {
  onlyKeys(input, ['billName', 'twdPerCny', 'billDate', 'sourceFileId', 'remark'])
  const twdPerCny = decimal(input.twdPerCny, 18, 12, true)
  if (!twdPerCny) return invalid()
  return { billName: text(input.billName, 128, true)!, twdPerCny, billDate: date(input.billDate), sourceFileId: uuid(input.sourceFileId), remark: text(input.remark, 2000) }
}
export function normalizeBillLine(input: OceanFreightBillLineCreateDto) {
  onlyKeys(input, ['lineType', 'goodsName', 'loadingItemId', 'adjustsBillLineId', 'containerBatchName', 'loadingDate', 'packageCount', 'warehouseReceiptReference', 'oceanShippingMarkText', 'packageUnit', 'recipientName', 'recipientPhone', 'recipientAddress', 'recipientInfoRaw', 'cargoCategoryCode', 'remark', 'grossWeightKg', 'lengthCm', 'widthCm', 'heightCm', 'reportedVolumeCai', 'codAmountTwd'])
  if (!['NORMAL', 'ADJUSTMENT'].includes(input.lineType)) return invalid()
  if (input.packageCount != null && (!Number.isInteger(input.packageCount) || input.packageCount < 1 || input.packageCount > 1000000)) return invalid()
  if (input.lineType === 'NORMAL' && input.adjustsBillLineId) return invalid()
  return {
    lineType: input.lineType, goodsName: text(input.goodsName, 500, true)!,
    loadingItemId: uuid(input.loadingItemId), adjustsBillLineId: uuid(input.adjustsBillLineId),
    containerBatchName: text(input.containerBatchName, 128), loadingDate: date(input.loadingDate),
    packageCount: input.packageCount ?? null, warehouseReceiptReference: text(input.warehouseReceiptReference, 1000),
    oceanShippingMarkText: text(input.oceanShippingMarkText, 500), packageUnit: text(input.packageUnit, 32),
    recipientName: text(input.recipientName, 128), recipientPhone: text(input.recipientPhone, 100), recipientAddress: text(input.recipientAddress, 2000),
    recipientInfoRaw: text(input.recipientInfoRaw, 2000), cargoCategoryCode: text(input.cargoCategoryCode, 32), remark: text(input.remark, 2000),
    grossWeightKg: decimal(input.grossWeightKg, 15, 3, true), lengthCm: decimal(input.lengthCm, 15, 3, true), widthCm: decimal(input.widthCm, 15, 3, true), heightCm: decimal(input.heightCm, 15, 3, true),
    reportedVolumeCai: decimal(input.reportedVolumeCai, 16, 8), codAmountTwd: decimal(input.codAmountTwd, 28, 2),
  }
}
