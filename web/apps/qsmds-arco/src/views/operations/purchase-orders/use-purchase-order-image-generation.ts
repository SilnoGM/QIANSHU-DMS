import type { Ref, ShallowRef } from 'vue'
import type { PurchaseOrderDetailDto, PurchaseOrderImageDraftDto } from '@/api/generated/types.gen'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import purchaseOrdersApi from '../../../api/modules/purchase-orders'
import { isPurchaseOrderAbortError } from './purchase-order-list.logic'

interface ImageGenerationOptions {
  detail: ShallowRef<PurchaseOrderDetailDto | null>
  orderId: Readonly<Ref<string | null>>
  enabled: Readonly<Ref<boolean>>
  epoch: Readonly<Ref<number>>
}
interface ImageGenerationStep {
  text: string
  action: () => Promise<void>
}
interface GenerationRun {
  controller: AbortController
  orderId: string
  epoch: number
  sequence: number
}

type ImageGenerationApi = Pick<typeof purchaseOrdersApi, 'getById' | 'orderImageDraft' | 'prepareReviewShippingMarks' | 'generateOrderImageDraft' | 'getOrderImageDraftContent'>

/** 图片是服务端持久草稿；前端只维护本次会话的受控预览，不在关闭时回收编号或删除草稿。 */
export function usePurchaseOrderImageGeneration(options: ImageGenerationOptions, api: ImageGenerationApi = purchaseOrdersApi) {
  const draft = shallowRef<PurchaseOrderImageDraftDto | null>(null)
  const previewUrl = ref<string | null>(null)
  const previewBlob = shallowRef<Blob | null>(null)
  const imageLoaded = ref(false)
  const imageFailed = ref(false)
  const generating = ref(false)
  const steps = shallowRef<ImageGenerationStep[]>([])
  const sequence = ref(0)
  let run: GenerationRun | null = null
  const ready = computed(() => options.enabled.value
    && !generating.value
    && imageLoaded.value
    && previewUrl.value !== null
    && draft.value?.isCurrent === true
    && draft.value.purchaseOrderId === options.detail.value?.id
    && draft.value.purchaseOrderId === options.orderId.value
    && draft.value.orderVersion === options.detail.value.version)

  function clearPreview(): void {
    if (previewUrl.value) {
      URL.revokeObjectURL(previewUrl.value)
    }
    previewUrl.value = null
    previewBlob.value = null
    imageLoaded.value = false
    imageFailed.value = false
  }
  function reset(): void {
    run?.controller.abort()
    run = null
    sequence.value += 1
    generating.value = false
    draft.value = null
    clearPreview()
  }
  function assertCurrent(current: GenerationRun): void {
    if (current.controller.signal.aborted || current.sequence !== sequence.value || current.orderId !== options.orderId.value || current.epoch !== options.epoch.value || !options.enabled.value) {
      throw new DOMException('Purchase order image operation aborted', 'AbortError')
    }
  }
  async function showDraft(value: PurchaseOrderImageDraftDto | null, current: GenerationRun): Promise<void> {
    assertCurrent(current)
    draft.value = value
    clearPreview()
    if (!value) {
      return
    }
    // 使用唯一 API Client 读取权限保护的 PNG，401/403 与 Blob 错误沿用统一会话治理。
    const response = await api.getOrderImageDraftContent(current.orderId, value.id, current.controller.signal)
    assertCurrent(current)
    previewBlob.value = response.data
    previewUrl.value = URL.createObjectURL(response.data)
  }
  async function restore(detail: PurchaseOrderDetailDto, signal: AbortSignal): Promise<void> {
    const current = { controller: new AbortController(), orderId: detail.id, epoch: options.epoch.value, sequence: sequence.value }
    const abort = () => current.controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (signal.aborted) {
        current.controller.abort()
      }
      assertCurrent(current)
      const response = await api.orderImageDraft(detail.id, current.controller.signal)
      assertCurrent(current)
      await showDraft(response.data.draft, current)
    }
    finally {
      signal.removeEventListener('abort', abort)
    }
  }
  function start(regenerate: boolean, labels: readonly string[]): void {
    const orderId = options.orderId.value
    if (!options.enabled.value || !orderId || generating.value || options.detail.value?.orderStatus !== 'PENDING_REVIEW') {
      return
    }
    reset()
    const current = { controller: new AbortController(), orderId, epoch: options.epoch.value, sequence: sequence.value }
    run = current
    // 步骤内先后均校验会话；FaMultiStepLoader 自己推进步骤，不能让旧步骤继续向新订单派号。
    const guarded = (action: () => Promise<void>) => async () => {
      assertCurrent(current)
      try {
        await action()
        assertCurrent(current)
      }
      catch (failure) {
        assertCurrent(current)
        throw failure
      }
    }
    const currentDetail = (): PurchaseOrderDetailDto => {
      assertCurrent(current)
      const detail = options.detail.value
      if (detail?.id !== current.orderId || detail.orderStatus !== 'PENDING_REVIEW') {
        throw new Error('采购订单已不处于审核中，请重新加载详情')
      }
      return detail
    }
    steps.value = [
      { text: labels[0] ?? '', action: guarded(async () => {
        const response = await api.getById(current.orderId, current.controller.signal)
        assertCurrent(current)
        options.detail.value = response.data
        currentDetail()
      }) },
      { text: labels[1] ?? '', action: guarded(async () => {
        const detail = currentDetail()
        const response = await api.prepareReviewShippingMarks(current.orderId, { expectedVersion: detail.version }, current.controller.signal)
        assertCurrent(current)
        options.detail.value = response.data
      }) },
      { text: labels[2] ?? '', action: guarded(async () => {
        const detail = currentDetail()
        const response = await api.generateOrderImageDraft(current.orderId, { expectedVersion: detail.version, regenerate }, current.controller.signal)
        await showDraft(response.data, current)
      }) },
    ]
    generating.value = true
  }
  function complete(): void {
    if (run) {
      assertCurrent(run)
      run = null
      generating.value = false
    }
  }
  function fail(failure: unknown): boolean {
    if (isPurchaseOrderAbortError(failure) || !run) {
      return false
    }
    run.controller.abort()
    run = null
    generating.value = false
    return true
  }
  function markLoaded(url: string): void {
    if (previewUrl.value === url) {
      imageLoaded.value = true
      imageFailed.value = false
    }
  }
  function markFailed(url: string): void {
    if (previewUrl.value === url) {
      imageLoaded.value = false
      imageFailed.value = true
    }
  }
  onScopeDispose(reset)
  return { draft, previewUrl, previewBlob, imageLoaded, imageFailed, ready, generating, steps, sequence, restore, start, complete, fail, reset, markLoaded, markFailed }
}
