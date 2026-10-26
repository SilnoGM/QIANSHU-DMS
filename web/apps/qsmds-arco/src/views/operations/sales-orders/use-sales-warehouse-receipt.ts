import type { Ref } from 'vue'
import type {
  SalesOrderWarehouseReceiptContextDto,
  SalesOrderWarehouseReceiptRequestDto,
  SalesOrderWarehouseReceiptResultDto,
} from '../../../api/generated/types.gen'
import type { SalesWarehouseReceiptIntent } from './sales-order-warehouse-receipt.logic'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import salesOrdersApi from '../../../api/modules/sales-orders'
import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'
import { toWarehouseReceiptRequest } from './sales-order-warehouse-receipt.logic'

interface SalesWarehouseReceiptApi {
  warehouseReceiptContext: (id: string, signal: AbortSignal) => Promise<{ data: SalesOrderWarehouseReceiptContextDto }>
  warehouseReceipt: (id: string, body: SalesOrderWarehouseReceiptRequestDto, signal: AbortSignal) => Promise<{ data: SalesOrderWarehouseReceiptResultDto }>
}

/**
 * 销售级入仓弹窗的读取与写入生命周期。
 * 写入结果未知时必须先重读上下文，避免把可能已经成功的入仓再提交一次。
 */
export function useSalesWarehouseReceipt(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  onSuccess: (result: SalesOrderWarehouseReceiptResultDto) => void,
  api: SalesWarehouseReceiptApi = salesOrdersApi,
) {
  const visible = ref(false)
  const context = shallowRef<SalesOrderWarehouseReceiptContextDto | null>(null)
  const orderId = ref<string | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const needsReload = ref(false)
  let controller: AbortController | null = null

  function reset(): void {
    controller?.abort()
    controller = null
    visible.value = false
    context.value = null
    orderId.value = null
    loading.value = false
    submitting.value = false
    error.value = null
    needsReload.value = false
  }

  function isCurrent(request: AbortController, requestEpoch: number): boolean {
    return controller === request
      && !request.signal.aborted
      && enabled.value
      && epoch.value === requestEpoch
      && visible.value
  }

  function reportFailure(failure: unknown): void {
    const result = getSalesOrderApiFailure(failure)
    error.value = result.requestId === undefined
      ? result.message
      : `${result.message}（requestId: ${result.requestId}）`
  }

  async function loadContext(): Promise<void> {
    if (!enabled.value || orderId.value === null || submitting.value) {
      return
    }
    controller?.abort()
    const request = new AbortController()
    controller = request
    const requestEpoch = epoch.value
    const requestOrderId = orderId.value
    loading.value = true
    error.value = null
    needsReload.value = false
    context.value = null
    try {
      const response = await api.warehouseReceiptContext(requestOrderId, request.signal)
      if (isCurrent(request, requestEpoch) && orderId.value === requestOrderId) {
        context.value = response.data
      }
    }
    catch (failure) {
      if (isCurrent(request, requestEpoch) && !isSalesOrderAbortError(failure)) {
        reportFailure(failure)
      }
    }
    finally {
      if (controller === request) {
        controller = null
        loading.value = false
      }
    }
  }

  async function open(id: string): Promise<void> {
    if (!enabled.value || submitting.value) {
      return
    }
    reset()
    orderId.value = id
    visible.value = true
    await loadContext()
  }

  async function submit(intent: SalesWarehouseReceiptIntent): Promise<void> {
    if (
      !enabled.value
      || orderId.value === null
      || context.value === null
      || !visible.value
      || submitting.value
      || loading.value
      || needsReload.value
      || error.value !== null
    ) {
      return
    }
    const requestOrderId = orderId.value
    const request = new AbortController()
    controller = request
    const requestEpoch = epoch.value
    submitting.value = true
    error.value = null
    try {
      const response = await api.warehouseReceipt(
        requestOrderId,
        toWarehouseReceiptRequest(intent),
        request.signal,
      )
      if (isCurrent(request, requestEpoch) && orderId.value === requestOrderId) {
        // 先解除提交锁，再关闭受控弹窗，避免通用弹窗关闭守卫将可见状态回弹。
        submitting.value = false
        visible.value = false
        onSuccess(response.data)
      }
    }
    catch (failure) {
      if (isCurrent(request, requestEpoch) && !isSalesOrderAbortError(failure)) {
        reportFailure(failure)
        // 未知结果也必须读取最新状态，不自动重放可能已经成功的入仓操作。
        needsReload.value = true
      }
    }
    finally {
      if (controller === request) {
        controller = null
        submitting.value = false
      }
    }
  }

  function setVisible(value: boolean): void {
    if (!value && !submitting.value) {
      reset()
    }
  }

  watch([enabled, epoch], reset)
  onScopeDispose(reset)
  return {
    visible,
    context,
    loading,
    submitting,
    error,
    needsReload,
    open,
    reload: loadContext,
    submit,
    reset,
    setVisible,
  }
}
