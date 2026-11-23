import type { Ref } from 'vue'
import type { PriceQuotationSheetRequestDto } from '../../../api/generated/types.gen'

import { getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'

import purchaseOrdersApi from '../../../api/modules/purchase-orders'
import { copyPurchaseOrderImageToClipboard, PurchaseOrderImageClipboardError } from './purchase-order-image-copy.logic'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'

interface PriceQuotationSheetApi {
  generatePriceQuotationSheet: (
    data: PriceQuotationSheetRequestDto,
    signal: AbortSignal,
  ) => Promise<{ data: Blob }>
}

interface PriceQuotationSheetOptions {
  readonly epoch: Readonly<Ref<number>>
  readonly copy?: (blob: Blob) => Promise<void>
}

/**
 * 核价单是第二步的临时预览，不持久化：关闭、重新生成或表单变化后都立即释放
 * Blob URL，避免用户把上一次的价格图片当作当前版本发给供应商。
 */
export function usePriceQuotationSheet(
  options: PriceQuotationSheetOptions,
  api: PriceQuotationSheetApi = purchaseOrdersApi,
) {
  const visible = ref(false)
  const generating = ref(false)
  const previewUrl = ref<string | null>(null)
  const previewBlob = shallowRef<Blob | null>(null)
  const imageLoaded = ref(false)
  const imageFailed = ref(false)
  const error = ref('')
  const filename = ref('price-quotation-sheet.png')
  let controller: AbortController | null = null
  let sequence = 0

  function clearPreview(): void {
    if (previewUrl.value !== null) {
      URL.revokeObjectURL(previewUrl.value)
    }
    previewUrl.value = null
    previewBlob.value = null
    imageLoaded.value = false
    imageFailed.value = false
  }

  function reset(): void {
    controller?.abort()
    controller = null
    sequence += 1
    generating.value = false
    visible.value = false
    error.value = ''
    clearPreview()
  }

  async function open(request: PriceQuotationSheetRequestDto): Promise<void> {
    controller?.abort()
    clearPreview()
    const current = new AbortController()
    controller = current
    const run = ++sequence
    const epoch = options.epoch.value
    filename.value = `price-quotation-sheet-${request.orderDate.replaceAll('-', '')}.png`
    visible.value = true
    generating.value = true
    error.value = ''
    const isCurrent = () => (
      run === sequence
      && !current.signal.aborted
      && epoch === options.epoch.value
    )
    try {
      const response = await api.generatePriceQuotationSheet(request, current.signal)
      if (!isCurrent()) {
        return
      }
      previewBlob.value = response.data
      previewUrl.value = URL.createObjectURL(response.data)
    }
    catch (failure) {
      if (!isCurrent() || isPurchaseOrderAbortError(failure)) {
        return
      }
      error.value = getPurchaseOrderApiFailure(failure).message
    }
    finally {
      if (run === sequence) {
        generating.value = false
        controller = null
      }
    }
  }

  function close(): void {
    reset()
  }

  /** 表单任何影响核价单内容的修改都必须作废旧预览。 */
  function invalidate(): void {
    reset()
  }

  function markLoaded(url: string): void {
    if (previewUrl.value !== url) {
      return
    }
    imageLoaded.value = true
    imageFailed.value = false
  }

  function markFailed(url: string): void {
    if (previewUrl.value !== url) {
      return
    }
    imageFailed.value = true
    imageLoaded.value = false
  }

  async function copy(): Promise<void> {
    const blob = previewBlob.value
    if (blob === null) {
      throw new PurchaseOrderImageClipboardError('UNAVAILABLE')
    }
    await (options.copy ?? copyPurchaseOrderImageToClipboard)(blob)
  }

  function download(): void {
    const url = previewUrl.value
    if (url === null) {
      return
    }
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = filename.value
    anchor.click()
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      controller?.abort()
      clearPreview()
    })
  }

  return {
    visible,
    generating,
    previewUrl,
    previewBlob,
    imageLoaded,
    imageFailed,
    error,
    open,
    close,
    invalidate,
    markLoaded,
    markFailed,
    copy,
    download,
  }
}
