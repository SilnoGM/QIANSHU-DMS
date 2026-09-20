import { normalizeOceanDecimal, OceanCalculationError } from '../ocean-freight-calculation/ocean-freight-calculation'
import { containerFailure, containerUuid, requireContainerVersion } from './container-batch.normalizer'

export type OceanChangeKind = 'RECIPIENT' | 'COD'
export const recipientChangeFields = ['recipientName', 'recipientPhone', 'recipientAddress', 'remark'] as const

export function oceanChangeKind(value: unknown): OceanChangeKind {
  if (value !== 'RECIPIENT' && value !== 'COD') return containerFailure('VALIDATION_FAILED', '修改类型无效')
  return value
}
function text(value: unknown, maximum: number): string | null {
  if (value === null) return null
  // 允许备注及地址的正常换行，拒绝其他控制字符；空文本统一为数据库的 null。
  if (typeof value !== 'string' || /[\p{Cc}\p{Cs}]/u.test(value.replace(/[\n\r\t]/gu, '')) || [...value.trim()].length > maximum) return containerFailure('VALIDATION_FAILED', '收件信息格式或长度无效')
  return value.trim().replace(/\r\n?/gu, '\n') || null
}
function cod(value: unknown) {
  try { return normalizeOceanDecimal(value, 30, 2, 'codAmountTwd') }
  catch (error) {
    if (error instanceof OceanCalculationError) return containerFailure('VALIDATION_FAILED', '代收金额须为非负金额，最多 28 位整数和 2 位小数；无代收请明确选择空值')
    throw error
  }
}
export function normalizeOceanChange(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return containerFailure('VALIDATION_FAILED', '修改内容无效')
  const input = raw as Record<string, unknown>, kind = oceanChangeKind(input.kind)
  const fields = kind === 'COD' ? ['codAmountTwd'] : [...recipientChangeFields]
  // class-transformer 会保留 DTO 中未赋值的可选属性；只忽略 undefined，显式 null 仍参与分支校验。
  if (Object.keys(input).some(key => input[key] !== undefined && !['requestKey', 'expectedVersion', 'notificationConfirmed', 'kind', ...fields].includes(key))) return containerFailure('VALIDATION_FAILED', '提交内容包含其他修改类型的字段')
  if (input.notificationConfirmed !== true) return containerFailure('CONTAINER_CHANGE_NOTIFICATION_REQUIRED', '请先确认已将修改内容发送到顺联航群')
  const changes = kind === 'COD'
    ? { codAmountTwd: cod(input.codAmountTwd) }
    : { recipientName: text(input.recipientName, 128), recipientPhone: text(input.recipientPhone, 128), recipientAddress: text(input.recipientAddress, 2000), remark: text(input.remark, 2000) }
  return { kind, requestKey: containerUuid(input.requestKey), expectedVersion: requireContainerVersion(input.expectedVersion), changes }
}

export function normalizeOceanUndoChange(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return containerFailure('VALIDATION_FAILED', '撤销内容无效')
  const input = raw as Record<string, unknown>
  if (Object.keys(input).some(key => !['requestKey', 'expectedVersion'].includes(key))) return containerFailure('VALIDATION_FAILED', '撤销内容包含无效字段')
  return { requestKey: containerUuid(input.requestKey), expectedVersion: requireContainerVersion(input.expectedVersion) }
}
