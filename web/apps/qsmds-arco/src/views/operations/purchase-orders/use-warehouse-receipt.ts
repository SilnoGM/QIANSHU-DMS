import type { Ref } from 'vue'
import type { PurchaseOrderDetailDto, PurchaseOrderWarehouseReceiptRequestDto } from '@/api/generated/types.gen'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import purchaseOrdersApi from '../../../api/modules/purchase-orders'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'

interface WarehouseApi {
  getById: (id: string, signal: AbortSignal) => Promise<{ data: PurchaseOrderDetailDto }>
  recordWarehouseReceipt: (id: string, body: PurchaseOrderWarehouseReceiptRequestDto, signal: AbortSignal) => Promise<{ data: PurchaseOrderDetailDto }>
}

/** 两个业务入口共用目标读取与写入生命周期；失败后必须重读，避免不确定结果重复写入。 */
export function useWarehouseReceipt(enabled: Readonly<Ref<boolean>>, epoch: Readonly<Ref<number>>, onSuccess: (detail: PurchaseOrderDetailDto) => void, api: WarehouseApi = purchaseOrdersApi) {
  const visible = ref(false)
  const detail = shallowRef<PurchaseOrderDetailDto | null>(null)
  const scopeIds = ref<string[]>()
  const loadingOrderId = ref<string | null>(null)
  const orderId = ref<string | null>(null)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const needsReload = ref(false)
  let controller: AbortController | null = null

  function reset(): void {
    controller?.abort()
    controller = null
    submitting.value = false
    loadingOrderId.value = null
    visible.value = false
    detail.value = null
    orderId.value = null
    error.value = null
    needsReload.value = false
  }
  function isCurrent(request: AbortController, requestEpoch: number): boolean {
    return controller === request && !request.signal.aborted && enabled.value && epoch.value === requestEpoch && visible.value
  }
  function reportFailure(failure: unknown): void {
    const result = getPurchaseOrderApiFailure(failure)
    error.value = result.requestId ? `${result.message}（requestId: ${result.requestId}）` : result.message
  }
  async function reload(): Promise<void> {
    if (!enabled.value || !orderId.value || submitting.value) {
      return
    }
    controller?.abort()
    const request = new AbortController()
    controller = request
    const requestEpoch = epoch.value
    loadingOrderId.value = orderId.value
    detail.value = null
    error.value = null
    needsReload.value = true
    try {
      const response = await api.getById(orderId.value, request.signal)
      if (isCurrent(request, requestEpoch)) {
        detail.value = response.data
        needsReload.value = false
      }
    }
    catch (failure) {
      if (isCurrent(request, requestEpoch) && !isPurchaseOrderAbortError(failure)) {
        reportFailure(failure)
      }
    }
    finally {
      if (controller === request) {
        loadingOrderId.value = null
        controller = null
      }
    }
  }
  async function open(id: string, partIds?: readonly string[]): Promise<void> {
    if (!enabled.value || submitting.value || loadingOrderId.value) {
      return
    }
    reset()
    orderId.value = id
    scopeIds.value = partIds ? [...partIds] : undefined
    visible.value = true
    await reload()
  }
  async function submit(payload: PurchaseOrderWarehouseReceiptRequestDto): Promise<void> {
    if (!enabled.value || !detail.value || !visible.value || submitting.value || needsReload.value || loadingOrderId.value) {
      return
    }
    const request = new AbortController()
    controller = request
    const requestEpoch = epoch.value
    submitting.value = true
    error.value = null
    try {
      const response = await api.recordWarehouseReceipt(detail.value.id, payload, request.signal)
      if (isCurrent(request, requestEpoch)) {
        // 先解除提交锁，再关闭受控弹窗，避免通用弹窗关闭守卫将可见状态回弹。
        submitting.value = false
        visible.value = false
        onSuccess(response.data)
      }
    }
    catch (failure) {
      if (isCurrent(request, requestEpoch) && !isPurchaseOrderAbortError(failure)) {
        reportFailure(failure)
        // 未知结果也必须读取最新状态，不自动重放可能已经成功的入仓操作。
        needsReload.value = true
      }
    }
    finally {
      if (controller === request) {
        submitting.value = false
        controller = null
      }
    }
  }

  watch([enabled, epoch], reset)
  onScopeDispose(reset)
  return { visible, detail, scopeIds, loadingOrderId, submitting, error, needsReload, open, reload, submit, reset }
}
