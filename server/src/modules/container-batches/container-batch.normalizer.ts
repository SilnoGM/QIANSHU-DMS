import { ApiException } from '../../infrastructure/http/api.exception'

export interface ContainerCommandContext { actorUserId: string, requestId: string }
export function containerFailure(code: string, message: string, status = 422): never {
  throw new ApiException(status, code, message)
}
export function containerUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) return containerFailure('VALIDATION_FAILED', '标识必须是规范的小写 UUID v4')
  return value
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) return containerFailure('VALIDATION_FAILED', '提交内容包含无效字段')
  return value as Record<string, unknown>
}
function text(value: unknown, maximum: number, required = false): string | null {
  if (value == null && !required) return null
  if (typeof value !== 'string' || /[\p{Cc}\p{Cs}]/u.test(value) || [...value.trim()].length > maximum || (required && !value.trim())) return containerFailure('VALIDATION_FAILED', '文字内容为空、含无效字符或超出长度限制')
  return value.trim() || null
}
export function normalizeContainerCreate(raw: unknown) {
  const input = record(raw, ['containerBatchName', 'warehouseValue', 'sourceFileId', 'remark'])
  const containerBatchName = text(input.containerBatchName, 32, true)!
  if (!/^\d{4}(?:-\d{2})?柜(?:子)?$/u.test(containerBatchName)) return containerFailure('VALIDATION_FAILED', '柜次名称应为 0917柜 或 0918-01柜')
  const warehouseValue = text(input.warehouseValue, 64, true)!
  return { containerBatchName, warehouseValue, sourceFileId: input.sourceFileId == null ? null : containerUuid(input.sourceFileId), remark: text(input.remark, 500) }
}
/** 创建时推断一次并持久化；请求指纹不含当前年份，使跨年重试仍返回原柜次。 */
export function deriveContainerDate(name: string, now: Date) {
  const match = /^(\d{2})(\d{2})(?:-(\d{2}))?柜(?:子)?$/u.exec(name)
  if (!match) return containerFailure('VALIDATION_FAILED', '柜次名称无法推断装柜日期')
  const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(now))
  const month = Number(match[1]), day = Number(match[2]), sequenceInDay = Number(match[3] ?? 1)
  const loadingDate = new Date(Date.UTC(year, month - 1, day))
  if (loadingDate.getUTCFullYear() !== year || loadingDate.getUTCMonth() !== month - 1 || loadingDate.getUTCDate() !== day || sequenceInDay < 1) return containerFailure('VALIDATION_FAILED', '柜次名称中的日期或序号无效')
  return { loadingDate, sequenceInDay }
}
export function normalizeLoadingItemCreate(raw: unknown) {
  const input = record(raw, ['shipmentId', 'oceanShippingMarkText', 'warehouseReceiptReference', 'goodsName', 'packageCount', 'packageUnit', 'remark', 'expectedVersion'])
  if (!Number.isSafeInteger(input.packageCount) || Number(input.packageCount) < 1 || Number(input.packageCount) > 1_000_000) return containerFailure('VALIDATION_FAILED', '包装件数必须为有效正整数')
  return {
    shipmentId: input.shipmentId == null ? null : containerUuid(input.shipmentId),
    oceanShippingMarkText: text(input.oceanShippingMarkText, 128),
    warehouseReceiptReference: text(input.warehouseReceiptReference, 500),
    goodsName: text(input.goodsName, 255, true)!, packageCount: Number(input.packageCount),
    packageUnit: text(input.packageUnit, 32), remark: text(input.remark, 500),
  }
}
export function requireContainerVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) return containerFailure('VALIDATION_FAILED', '版本号无效')
  return Number(value)
}
