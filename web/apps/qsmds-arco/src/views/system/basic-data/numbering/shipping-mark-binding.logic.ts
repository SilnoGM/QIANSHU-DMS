import type { ShippingMarkRuleSummaryDto } from '@/api/generated/types.gen'
/** 请求代次与身份纪元同时校验，不能仅依赖 abort 成功来防止跨身份回填。 */
export function canApplyBindingResponse(input: {
  aborted: boolean
  authorized: boolean
  epoch: number
  currentEpoch: number
  version: number
  currentVersion: number
}): boolean {
  return !input.aborted && input.authorized && input.epoch === input.currentEpoch && input.version === input.currentVersion
}
export function classifyBindingSaveFailure(error: unknown): 'editable' | 'refresh' | 'unknown' {
  if (typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'http' && 'status' in error && typeof error.status === 'number') {
    if (error.status === 409) {
      return 'refresh'
    }
    if (error.status < 500) {
      return 'editable'
    }
  }
  return 'unknown'
}
export function isBindableRule(rule: ShippingMarkRuleSummaryDto | null | undefined): boolean {
  return rule?.purpose === 'SHIPPING_MARK' && rule.status === 'ENABLED' && typeof rule.activeRevision === 'number' && rule.activeRevision > 0
}
export function bindingErrorMessage(error: unknown, fallback: string): string {
  // 只读取已归一化 ApiClientError 的公共 body，不透传原始网络异常 message。
  if (typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'http' && 'body' in error
    && typeof error.body === 'object' && error.body !== null && 'message' in error.body && typeof error.body.message === 'string') {
    return error.body.message
  }
  return fallback
}
