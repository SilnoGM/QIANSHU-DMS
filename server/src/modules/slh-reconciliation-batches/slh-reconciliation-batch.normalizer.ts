import { slhReconciliationBatchFailure } from './slh-reconciliation-batch.errors'

/** 批次域内的标识一律要求规范的小写 UUID v4：路径参数、幂等键与账单标识都走这里。 */
export function slhReconciliationBatchUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    return slhReconciliationBatchFailure('VALIDATION_FAILED', '标识必须是规范的小写 UUID v4')
  }
  return value
}
