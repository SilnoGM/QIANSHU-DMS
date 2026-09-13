import type { SalesReceiptRequestCreateDto } from '@/api/generated/types.gen'

export interface ReceiptSubmission {
  readonly idempotencyKey: string
  readonly payload: SalesReceiptRequestCreateDto
}

/** 未知结果重放使用首次提交的快照，即使表单对象随后变化也不改变请求。 */
export function freezeReceiptSubmission(payload: SalesReceiptRequestCreateDto, key: string): ReceiptSubmission {
  const snapshot = structuredClone(payload)
  Object.freeze(snapshot.voucher)
  return Object.freeze({ idempotencyKey: key, payload: Object.freeze(snapshot) })
}

export function isReceiptResultUnknown(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return true
  }
  const failure = error as { status?: unknown, kind?: unknown }
  return failure.kind === 'network' || typeof failure.status !== 'number' || failure.status >= 500
}
