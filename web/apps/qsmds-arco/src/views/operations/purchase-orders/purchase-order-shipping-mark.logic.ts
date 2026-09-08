import type { PurchaseOrderShippingMarkResolutionDto } from '../../../api/generated/types.gen'
import type { PurchaseOrderShippingMarkResolutionQuery } from '../../../api/modules/purchase-orders'
import { formatNumberingRuleStructure } from '../../system/basic-data/numbering/numbering-list.logic'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'

export const PURCHASE_SHIPPING_MARK_DISPATCH_HINT = 'purchaseOrderParts.dispatchHint'

/** 旧单已保存的独立货件码也是派发事实，不能仅因订单基础码为空就承诺重新生成。 */
export function hasPurchaseOrderShippingMarks(order: {
  shippingMarkText: string | null
  parts: readonly { shippingMarkText: string | null }[]
}): boolean {
  return order.shippingMarkText !== null || order.parts.some(part => part.shippingMarkText !== null)
}

export interface PurchaseOrderShippingMarkState {
  readonly error: string
  readonly loading: boolean
  readonly resolution: PurchaseOrderShippingMarkResolutionDto | null
}

export function isPurchaseOrderShippingMarkAvailable(
  resolution: PurchaseOrderShippingMarkResolutionDto | null,
): boolean {
  return resolution?.availability === 'AVAILABLE'
    && typeof resolution.resolutionToken === 'string'
    && /^[a-f0-9]{64}$/u.test(resolution.resolutionToken)
}

/** 同一摘要用于第三步、详情核对与提交确认，避免候选号被误认为正式唛头。 */
export function formatPurchaseOrderShippingMarkSummary(
  resolution: PurchaseOrderShippingMarkResolutionDto | null,
  t: (key: string) => string,
): string {
  if (resolution === null) {
    return t('purchaseOrderParts.unmatchedSummary')
  }
  const rule = [resolution.ruleCode, resolution.name].filter(Boolean).join(' · ') || '未匹配规则'
  const revision = resolution.activeRevision === null ? '无生效版本' : `第 ${resolution.activeRevision} 版`
  const source = resolution.matchSource === 'CUSTOM_RULE' ? '自定义采购固定规则' : '供应商绑定规则'
  const status = isPurchaseOrderShippingMarkAvailable(resolution) ? '可用' : '不可用'
  return [
    `${source}：${rule} · ${revision} · ${status}`,
    resolution.activeConfig ? formatNumberingRuleStructure(resolution.activeConfig) : null,
    isPurchaseOrderShippingMarkAvailable(resolution) ? null : resolution.message,
    t(PURCHASE_SHIPPING_MARK_DISPATCH_HINT),
  ].filter(Boolean).join('\n')
}

/**
 * 匹配是独立只读生命周期：换供应商先清空摘要，取消请求之外还核对版本和身份。
 * 最终提交或结果未知时禁止刷新，确保原请求摘要及幂等键的恢复语义不被破坏。
 */
export function createPurchaseOrderShippingMarkResolver(options: {
  readonly canRefresh: () => boolean
  readonly getAuthEpoch: () => number
  readonly load: (query: PurchaseOrderShippingMarkResolutionQuery, signal: AbortSignal) => Promise<PurchaseOrderShippingMarkResolutionDto>
  readonly onChange: (state: PurchaseOrderShippingMarkState) => void
}) {
  let controller: AbortController | null = null
  let requestVersion = 0
  const empty = (): PurchaseOrderShippingMarkState => ({ error: '', loading: false, resolution: null })

  function reset(): void {
    requestVersion += 1
    controller?.abort()
    controller = null
    options.onChange(empty())
  }

  async function refresh(query: PurchaseOrderShippingMarkResolutionQuery): Promise<void> {
    if (!options.canRefresh()) {
      return
    }
    reset()
    const requestController = new AbortController()
    controller = requestController
    const version = requestVersion
    const authEpoch = options.getAuthEpoch()
    const isCurrent = () => !requestController.signal.aborted
      && requestVersion === version
      && options.getAuthEpoch() === authEpoch
      && options.canRefresh()
    options.onChange({ ...empty(), loading: true })
    try {
      const resolution = await options.load(query, requestController.signal)
      if (isCurrent()) {
        options.onChange({ error: '', loading: false, resolution })
      }
    }
    catch (error) {
      if (isCurrent() && !isPurchaseOrderAbortError(error)) {
        options.onChange({ ...empty(), error: getPurchaseOrderApiFailure(error).message })
      }
    }
    finally {
      if (controller === requestController) {
        controller = null
      }
    }
  }

  return { refresh, reset }
}
