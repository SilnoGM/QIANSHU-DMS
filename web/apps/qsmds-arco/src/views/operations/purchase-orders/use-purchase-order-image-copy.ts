import type { Ref, ShallowRef } from 'vue'
import type { PurchaseOrderDetailDto, PurchaseOrderImageDraftDto } from '@/api/generated/types.gen'
import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import { copyPurchaseOrderImageToClipboard, PurchaseOrderImageClipboardError } from './purchase-order-image-copy.logic'

export type PurchaseOrderImageCopyErrorKey = 'purchaseReview.copy.imageClipboardUnavailable' | 'purchaseReview.copy.imageFailed'

interface ImageCopyOptions {
  busy: Readonly<Ref<boolean>>
  canReview: Readonly<Ref<boolean>>
  copyInfoVisible: Readonly<Ref<boolean>>
  detail: ShallowRef<PurchaseOrderDetailDto | null>
  draft: Readonly<Ref<PurchaseOrderImageDraftDto | null>>
  epoch: Readonly<Ref<number>>
  imageReady: Readonly<Ref<boolean>>
  loading: Readonly<Ref<boolean>>
  orderId: Readonly<Ref<string | null>>
  previewBlob: Readonly<Ref<Blob | null>>
  previewUrl: Readonly<Ref<string | null>>
  visible: Readonly<Ref<boolean>>
}

interface ImageCopyDependencies {
  copy?: (blob: Blob) => Promise<void>
  onFailure?: (key: PurchaseOrderImageCopyErrorKey) => void
  onSuccess?: () => void
}

export function purchaseOrderImageCopyErrorKey(failure: unknown): PurchaseOrderImageCopyErrorKey {
  return failure instanceof PurchaseOrderImageClipboardError && failure.code === 'UNAVAILABLE'
    ? 'purchaseReview.copy.imageClipboardUnavailable'
    : 'purchaseReview.copy.imageFailed'
}

/** 复制图片只使用当前弹窗已展示的草稿；关闭、换单或重新生成后，迟到结果不得回写提示。 */
export function usePurchaseOrderImageCopy(
  options: ImageCopyOptions,
  dependencies: ImageCopyDependencies = {},
) {
  const copying = ref(false)
  let sequence = 0
  const canCopy = computed(() => options.copyInfoVisible.value
    && options.visible.value
    && options.canReview.value
    && !options.loading.value
    && !options.busy.value
    && options.detail.value?.id === options.orderId.value
    && options.imageReady.value
    && options.previewBlob.value !== null
    && !copying.value)

  async function copy(): Promise<void> {
    const blob = options.previewBlob.value
    const url = options.previewUrl.value
    const current = options.detail.value
    const draftId = options.draft.value?.id
    if (!canCopy.value || blob === null || url === null || current === null) {
      return
    }
    const run = ++sequence
    const epoch = options.epoch.value
    const isCurrent = () => run === sequence
      && epoch === options.epoch.value
      && options.visible.value
      && options.canReview.value
      && options.copyInfoVisible.value
      && options.orderId.value === current.id
      && options.previewUrl.value === url
      && options.draft.value?.id === draftId
    copying.value = true
    try {
      await (dependencies.copy ?? copyPurchaseOrderImageToClipboard)(blob)
      if (isCurrent()) {
        dependencies.onSuccess?.()
      }
    }
    catch (failure) {
      if (isCurrent()) {
        dependencies.onFailure?.(purchaseOrderImageCopyErrorKey(failure))
      }
    }
    finally {
      if (run === sequence) {
        copying.value = false
      }
    }
  }

  function reset(): void {
    sequence += 1
    copying.value = false
  }

  if (getCurrentScope()) {
    onScopeDispose(reset)
  }
  return { canCopy, copy, copying, reset }
}
