import { createHash } from 'node:crypto'

import { OceanCalculationError, normalizeOceanDecimal } from '../ocean-freight-calculation/ocean-freight-calculation'
import { containerFailure, containerUuid } from './container-batch.normalizer'

const SWAP_LINE_LIMIT = 1_000

export interface NormalizedContainerSwapLine {
  readonly loadingItemId: string
  readonly expectedVersion: number
  readonly codAmountTwd: string | null
}

export interface NormalizedContainerSwapRequest {
  readonly leftShipmentId: string
  readonly rightShipmentId: string
  readonly leftLines: readonly NormalizedContainerSwapLine[]
  readonly rightLines: readonly NormalizedContainerSwapLine[]
  readonly note: string | null
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return containerFailure('VALIDATION_FAILED', '提交内容无效')
  }
  if (Object.keys(value).some(key => !keys.includes(key))) {
    return containerFailure('VALIDATION_FAILED', '提交内容包含无效字段')
  }
  return value as Record<string, unknown>
}

function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    return containerFailure('VALIDATION_FAILED', '版本号无效')
  }
  return Number(value)
}

function lineList(value: unknown, side: '左' | '右'): NormalizedContainerSwapLine[] {
  if (!Array.isArray(value) || value.length > SWAP_LINE_LIMIT) {
    return containerFailure('VALIDATION_FAILED', `${side}侧装柜明细格式无效`)
  }
  const seen = new Set<string>()
  return value.map((entry) => {
    const input = record(entry, ['loadingItemId', 'expectedVersion', 'codAmountTwd'])
    const loadingItemId = containerUuid(input.loadingItemId)
    if (seen.has(loadingItemId)) {
      return containerFailure('VALIDATION_FAILED', '同一装柜明细不能重复提交')
    }
    seen.add(loadingItemId)
    return {
      loadingItemId,
      expectedVersion: version(input.expectedVersion),
      codAmountTwd: normalizeSwapCod(input.codAmountTwd),
    }
  })
}

/**
 * 收件人/地址/备注的合并口径：按来源行号顺序取非空值去重，再用分隔符连接。
 * 姓名/电话用顿号；地址/备注保留换行。合并后仍按数据库字段上限校验。
 */
export function normalizeSwapText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    return containerFailure('CONTAINER_SWAP_RECIPIENT_INVALID', '收件信息或备注格式无效')
  }
  const normalized = value.trim().replace(/\r\n?/gu, '\n')
  if (
    /[\p{Cc}\p{Cs}]/u.test(normalized.replace(/[\n\r\t]/gu, ''))
    || [...normalized].length > maximum
  ) {
    return containerFailure('CONTAINER_SWAP_RECIPIENT_INVALID', '收件信息或备注含无效字符或超出长度限制')
  }
  return normalized || null
}

export function mergeSwapText(
  values: readonly (string | null | undefined)[],
  maximum: number,
  separator: string,
): string | null {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeSwapText(value, maximum)
    if (normalized === null || seen.has(normalized)) continue
    seen.add(normalized)
    merged.push(normalized)
  }
  if (merged.length === 0) return null
  const result = merged.join(separator)
  if ([...result].length > maximum) {
    return containerFailure('CONTAINER_SWAP_RECIPIENT_INVALID', '合并后的收件信息或备注超出长度限制')
  }
  return result
}

export function normalizeSwapCod(value: unknown): string | null {
  try {
    return normalizeOceanDecimal(value ?? null, 30, 2, 'codAmountTwd')
  }
  catch (error) {
    if (error instanceof OceanCalculationError) {
      return containerFailure('VALIDATION_FAILED', '代收金额须为非负金额，最多 28 位整数和 2 位小数；无代收请明确留空')
    }
    throw error
  }
}

export function normalizeContainerSwapRequest(raw: unknown): NormalizedContainerSwapRequest {
  const input = record(raw, ['leftShipmentId', 'rightShipmentId', 'leftLines', 'rightLines', 'note'])
  const leftShipmentId = containerUuid(input.leftShipmentId)
  const rightShipmentId = containerUuid(input.rightShipmentId)
  if (leftShipmentId === rightShipmentId) {
    return containerFailure('VALIDATION_FAILED', '两件货件不能相同')
  }
  const leftLines = lineList(input.leftLines, '左')
  const rightLines = lineList(input.rightLines, '右')
  const overlap = leftLines.find(line => rightLines.some(other => other.loadingItemId === line.loadingItemId))
  if (overlap !== undefined) {
    return containerFailure('VALIDATION_FAILED', '两件货件的装柜明细不能重复')
  }
  return {
    leftShipmentId,
    rightShipmentId,
    leftLines,
    rightLines,
    note: normalizeSwapText(input.note, 500),
  }
}

/** 用互换幂等键派生稳定的 UUID，避免两条归属事件/多条明细变更共用同一 requestKey。 */
export function deriveSwapUuid(swapRequestKey: string, suffix: string): string {
  const digest = createHash('sha256').update(`${swapRequestKey}:${suffix}`, 'utf8').digest()
  digest[6] = (digest[6] & 0x0f) | 0x40
  digest[8] = (digest[8] & 0x3f) | 0x80
  const hex = digest.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function hashSwapPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
}
