import type { Ref } from 'vue'
import type { PurchasePayableOrderDto } from '../../../api/generated/types.gen'
import type { PurchasePaymentStatement, StatementImageLabels } from './purchase-payment-statement-image'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import purchaseOrderPayablesApi from '../../../api/modules/purchase-order-payables'
import { buildPurchasePaymentStatement, renderPurchasePaymentStatement } from './purchase-payment-statement-image'

interface Options {
  enabled: Readonly<Ref<boolean>>
  epoch: Readonly<Ref<number>>
  orders: Readonly<Ref<readonly PurchasePayableOrderDto[]>>
  supplierName: Readonly<Ref<string>>
}
interface Dependencies {
  readOrder: (id: string, signal: AbortSignal) => Promise<PurchasePayableOrderDto>
  render: typeof renderPurchasePaymentStatement
  createUrl: (blob: Blob) => string
  revokeUrl: (url: string) => void
  writeClipboard: (blob: Blob) => Promise<void>
}
function aborted() {
  return new DOMException('Statement generation aborted', 'AbortError')
}
const defaults: Dependencies = {
  readOrder: async (id, signal) => (await purchaseOrderPayablesApi.getByOrder(id, signal)).data,
  render: renderPurchasePaymentStatement,
  createUrl: blob => URL.createObjectURL(blob),
  revokeUrl: url => URL.revokeObjectURL(url),
  writeClipboard: (blob) => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('STATEMENT_CLIPBOARD_UNAVAILABLE')
    }
    // 直接在点击手势中写入已生成的 PNG，避免等待网络或渲染后丢失浏览器授权。
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  },
}

export function usePurchasePaymentStatement(options: Options, dependencies: Dependencies = defaults) {
  const visible = ref(false)
  const generating = ref(false)
  const copying = ref(false)
  const previewUrl = ref<string | null>(null)
  const imageLoaded = ref(false)
  const failure = shallowRef<unknown>(null)
  const steps = shallowRef<{ text: string, action: () => Promise<void> }[]>([])
  let controller: AbortController | null = null
  let blob: Blob | null = null
  let sequence = 0

  function clearPreview() {
    if (previewUrl.value) {
      dependencies.revokeUrl(previewUrl.value)
    }
    previewUrl.value = null
    imageLoaded.value = false
    blob = null
  }
  function reset() {
    controller?.abort()
    controller = null
    sequence++
    generating.value = false
    copying.value = false
    visible.value = false
    failure.value = null
    clearPreview()
  }
  function start(labels: readonly string[], imageLabels: StatementImageLabels, generatedAt: string) {
    if (!options.enabled.value || !options.orders.value.length || generating.value || copying.value) {
      return
    }
    reset()
    const request = new AbortController()
    const run = sequence
    const epoch = options.epoch.value
    const selectedIds = options.orders.value.map(order => order.id)
    const supplierName = options.supplierName.value
    controller = request
    const current = () => {
      if (request.signal.aborted || controller !== request || run !== sequence || epoch !== options.epoch.value || !options.enabled.value) {
        throw aborted()
      }
    }
    let details: PurchasePayableOrderDto[] = []
    let statement: PurchasePaymentStatement
    const step = (action: () => Promise<void>) => async () => {
      current()
      try {
        await action()
        current()
      }
      catch (error) {
        current()
        throw error
      }
    }
    steps.value = [
      { text: labels[0] ?? '', action: step(async () => {
        let cursor = 0
        details = []
        // 限制并行读取数量，既获取每个选中订单的最新金额，也避免全选时瞬间发出大量请求。
        await Promise.all(Array.from({ length: Math.min(4, selectedIds.length) }, async () => {
          while (cursor < selectedIds.length) {
            current()
            const index = cursor++
            const detail = await dependencies.readOrder(selectedIds[index]!, request.signal)
            current()
            if (detail.id !== selectedIds[index]) {
              throw new Error('INVALID_STATEMENT')
            }
            details[index] = detail
          }
        }))
      }) },
      { text: labels[1] ?? '', action: step(async () => {
        statement = buildPurchasePaymentStatement(details, supplierName, generatedAt)
      }) },
      { text: labels[2] ?? '', action: step(async () => {
        const image = await dependencies.render(statement, imageLabels)
        current()
        if (!image.size || image.type !== 'image/png') {
          throw new Error('STATEMENT_RENDER_FAILED')
        }
        blob = image
        previewUrl.value = dependencies.createUrl(image)
      }) },
    ]
    generating.value = true
  }
  function complete() {
    if (controller && !controller.signal.aborted && options.enabled.value && previewUrl.value) {
      generating.value = false
      visible.value = true
    }
  }
  function fail(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return false
    }
    if (!controller) {
      return false
    }
    reset()
    failure.value = error
    return true
  }
  function markLoaded(url: string) {
    if (url === previewUrl.value) {
      imageLoaded.value = true
    }
  }
  async function copy() {
    if (!options.enabled.value || !visible.value || !imageLoaded.value || !blob || generating.value || copying.value) {
      return false
    }
    const run = sequence
    copying.value = true
    failure.value = null
    try {
      await dependencies.writeClipboard(blob)
      return run === sequence && options.enabled.value && visible.value
    }
    catch (error) {
      if (run === sequence) {
        failure.value = error
      }
      return false
    }
    finally {
      if (run === sequence) {
        copying.value = false
      }
    }
  }
  watch([options.enabled, options.epoch, options.supplierName, () => options.orders.value], reset, { flush: 'sync' })
  watch(visible, (open) => {
    if (!open) {
      clearPreview()
    }
  }, { flush: 'sync' })
  onScopeDispose(reset)
  return { visible, generating, copying, previewUrl, imageLoaded, failure, steps, start, complete, fail, reset, markLoaded, copy }
}
