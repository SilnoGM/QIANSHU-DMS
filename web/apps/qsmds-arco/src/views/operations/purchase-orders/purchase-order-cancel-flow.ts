import type { ComputedRef, Ref } from 'vue'
import type {
  PurchaseOrderDetailDto,
  PurchaseOrderStatusRequestDto,
} from '../../../api/generated/types.gen'

import type { PurchaseOrderCancelBlockedReason } from './purchase-order-cancel.logic'

import { computed, ref, shallowRef } from 'vue'
import {
  buildPurchaseCancellationText,
  buildPurchaseOrderCancelRequest,
  getPurchaseOrderCancelBlockedReason,
  purchaseOrderCancelBlockedMessage,
} from './purchase-order-cancel.logic'

type Translate = (key: string, values?: Record<string, string | number>) => string

export interface PurchaseOrderCancelApi {
  getById: (id: string, signal: AbortSignal) => Promise<{ data: PurchaseOrderDetailDto }>
  updateOrderStatus: (
    id: string,
    body: PurchaseOrderStatusRequestDto,
    signal: AbortSignal,
  ) => Promise<{ data: PurchaseOrderDetailDto }>
}

export interface PurchaseOrderCancelFlowOptions {
  readonly visible: Ref<boolean>
  readonly orderId: Ref<string | null>
  readonly authEpoch: Ref<number>
  readonly canCancel: Ref<boolean>
  readonly translate: Translate
  readonly api: PurchaseOrderCancelApi
  readonly clipboard: { writeText: (text: string) => Promise<void> }
  readonly toast: {
    success: (text: string) => void
    warning: (text: string) => void
  }
  readonly failure: (error: unknown) => { message: string }
  readonly isAbortError: (error: unknown) => boolean
  readonly onCancelled: (detail: PurchaseOrderDetailDto) => void
  readonly onClose: () => void
}

export interface PurchaseOrderCancelFlow {
  readonly detail: Ref<PurchaseOrderDetailDto | null>
  readonly loading: Ref<boolean>
  readonly submitting: Ref<boolean>
  readonly copying: Ref<boolean>
  readonly completed: Ref<boolean>
  readonly loadError: Ref<string>
  readonly actionError: Ref<string>
  readonly reason: Ref<string>
  readonly reasonError: Ref<string>
  readonly busy: ComputedRef<boolean>
  readonly blockedMessage: ComputedRef<string>
  readonly copyText: ComputedRef<string>
  readonly canConfirm: ComputedRef<boolean>
  reset: () => void
  loadDetail: () => Promise<void>
  copyCancelledInfo: () => Promise<void>
  submit: () => Promise<void>
}

/**
 * 运营采购取消的异步流程：详情加载、原因校验、取消提交与通知复制。
 * 与工作台弹窗保持相同的复制语义：只有取消成功后才复制，复制失败只重试剪贴板。
 */
export function createPurchaseOrderCancelFlow(
  options: PurchaseOrderCancelFlowOptions,
): PurchaseOrderCancelFlow {
  const detail = shallowRef<PurchaseOrderDetailDto | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const copying = ref(false)
  const completed = ref(false)
  const loadError = ref('')
  const actionError = ref('')
  const reason = ref('')
  const reasonError = ref('')
  let controller: AbortController | null = null
  let sequence = 0
  const busy = computed(() => submitting.value || copying.value)
  const blockedReason = computed<PurchaseOrderCancelBlockedReason | null>(() => (
    detail.value === null
      ? null
      : getPurchaseOrderCancelBlockedReason(detail.value, { allowPendingReview: true })
  ))
  const blockedMessage = computed(() => (
    blockedReason.value === null ? '' : purchaseOrderCancelBlockedMessage(blockedReason.value)
  ))
  const copyText = computed(() => (
    detail.value === null ? '' : buildPurchaseCancellationText(detail.value, options.translate)
  ))
  const canConfirm = computed(() => (
    options.visible.value
    && options.canCancel.value
    && !loading.value
    && !busy.value
    && !completed.value
    && detail.value?.id === options.orderId.value
    && detail.value !== null
    && blockedReason.value === null
  ))

  function reset(): void {
    sequence++
    controller?.abort()
    controller = null
    detail.value = null
    loading.value = false
    submitting.value = false
    copying.value = false
    completed.value = false
    loadError.value = ''
    actionError.value = ''
    reason.value = ''
    reasonError.value = ''
  }

  async function loadDetail(): Promise<void> {
    reset()
    if (!options.visible.value || !options.orderId.value) {
      return
    }
    if (!options.canCancel.value) {
      options.onClose()
      return
    }
    const request = new AbortController()
    controller = request
    const id = options.orderId.value
    const epoch = options.authEpoch.value
    loading.value = true
    try {
      const response = await options.api.getById(id, request.signal)
      if (!request.signal.aborted && epoch === options.authEpoch.value && options.canCancel.value && options.visible.value && options.orderId.value === id) {
        detail.value = response.data
      }
    }
    catch (failure) {
      if (!request.signal.aborted && epoch === options.authEpoch.value && !options.isAbortError(failure)) {
        loadError.value = options.failure(failure).message
      }
    }
    finally {
      if (controller === request) {
        controller = null
        loading.value = false
      }
    }
  }

  async function copyCancelledInfo(): Promise<void> {
    if (!options.visible.value || !completed.value || detail.value === null || detail.value.id !== options.orderId.value || !options.canCancel.value || copying.value) {
      return
    }
    const attempt = sequence
    const epoch = options.authEpoch.value
    const id = options.orderId.value
    const current = () => attempt === sequence && epoch === options.authEpoch.value && options.orderId.value === id && options.visible.value && options.canCancel.value
    copying.value = true
    try {
      await options.clipboard.writeText(copyText.value)
      if (current()) {
        options.toast.success('采购单已取消，取消信息已复制')
        copying.value = false
        options.onClose()
      }
    }
    catch {
      if (current()) {
        // 已取消与复制失败是两个独立结果；重试只写剪贴板，不能再次取消订单。
        actionError.value = '采购单已取消，但复制失败。请点击“复制取消信息”重试。'
        options.toast.warning(actionError.value)
      }
    }
    finally {
      if (attempt === sequence) {
        copying.value = false
      }
    }
  }

  async function submit(): Promise<void> {
    if (!canConfirm.value || detail.value === null) {
      return
    }
    const result = buildPurchaseOrderCancelRequest(reason.value)
    if (!result.valid) {
      reasonError.value = result.fieldError
      return
    }
    reasonError.value = ''
    const id = detail.value.id
    const epoch = options.authEpoch.value
    const attempt = sequence
    const request = new AbortController()
    controller = request
    const current = () => !request.signal.aborted && attempt === sequence && epoch === options.authEpoch.value && options.visible.value && options.orderId.value === id && options.canCancel.value
    submitting.value = true
    actionError.value = ''
    try {
      const response = await options.api.updateOrderStatus(id, result.request, request.signal)
      if (!current()) {
        return
      }
      detail.value = response.data
      completed.value = true
      options.onCancelled(response.data)
      submitting.value = false
      await copyCancelledInfo()
    }
    catch (failure) {
      if (current() && !options.isAbortError(failure)) {
        actionError.value = options.failure(failure).message
      }
    }
    finally {
      if (controller === request) {
        controller = null
        submitting.value = false
      }
    }
  }

  return {
    detail,
    loading,
    submitting,
    copying,
    completed,
    loadError,
    actionError,
    reason,
    reasonError,
    busy,
    blockedMessage,
    copyText,
    canConfirm,
    reset,
    loadDetail,
    copyCancelledInfo,
    submit,
  }
}
