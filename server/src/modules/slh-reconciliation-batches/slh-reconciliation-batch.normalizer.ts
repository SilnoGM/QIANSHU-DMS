import { slhReconciliationBatchFailure } from './slh-reconciliation-batch.errors'

export interface SlhReconciliationBatchCommandContext { actorUserId: string, requestId: string }

export function slhReconciliationBatchUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    return slhReconciliationBatchFailure('VALIDATION_FAILED', '标识必须是规范的小写 UUID v4')
  }
  return value
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    return slhReconciliationBatchFailure('VALIDATION_FAILED', '提交内容包含无效字段')
  }
  return value as Record<string, unknown>
}

export interface SlhReconciliationBatchCreateInput { billId: string, previewLineIds: string[] | null }
export interface SlhReconciliationBatchReconcileInput { lineIds: string[] }

/**
 * 创建批次只接受账单标识；可核对的行集合由服务端重跑匹配决定，不接受前端传入行号。
 * `previewLineIds` 仅用于比对用户在预览里看到的范围，不作为创建依据。
 */
export function normalizeSlhReconciliationBatchCreate(raw: unknown): SlhReconciliationBatchCreateInput {
  const input = record(raw, ['billId', 'previewLineIds'])
  return { billId: slhReconciliationBatchUuid(input.billId), previewLineIds: normalizeOptionalLineIds(input.previewLineIds) }
}

/** 核对提交必须是非空、去重、规范 UUID 的行集合，重复提交同一行没有意义。 */
export function normalizeSlhReconciliationBatchReconcile(raw: unknown): SlhReconciliationBatchReconcileInput {
  const input = record(raw, ['lineIds'])
  if (!Array.isArray(input.lineIds) || input.lineIds.length === 0) {
    return slhReconciliationBatchFailure('VALIDATION_FAILED', '请选择要核对的行')
  }
  const lineIds = input.lineIds.map(slhReconciliationBatchUuid)
  if (new Set(lineIds).size !== lineIds.length) {
    return slhReconciliationBatchFailure('VALIDATION_FAILED', '提交的行存在重复')
  }
  return { lineIds }
}

function normalizeOptionalLineIds(value: unknown): string[] | null {
  if (value === null || value === undefined) {
    return null
  }
  if (!Array.isArray(value)) {
    return slhReconciliationBatchFailure('VALIDATION_FAILED', '预览行标识必须是数组')
  }
  const lineIds = value.map(slhReconciliationBatchUuid)
  if (new Set(lineIds).size !== lineIds.length) {
    return slhReconciliationBatchFailure('VALIDATION_FAILED', '预览行标识存在重复')
  }
  return lineIds
}
