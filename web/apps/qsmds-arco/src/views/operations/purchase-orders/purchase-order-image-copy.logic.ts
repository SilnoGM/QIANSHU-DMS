export type PurchaseOrderImageClipboardErrorCode = 'FAILED' | 'UNAVAILABLE'

export class PurchaseOrderImageClipboardError extends Error {
  constructor(readonly code: PurchaseOrderImageClipboardErrorCode) {
    super(code)
    this.name = 'PurchaseOrderImageClipboardError'
  }
}

export interface PurchaseOrderImageClipboardItemLike {
  readonly types: readonly string[]
}

export interface PurchaseOrderImageClipboardLike {
  write?: (items: PurchaseOrderImageClipboardItemLike[]) => Promise<void>
}

export interface PurchaseOrderImageClipboardDependencies {
  clipboard?: PurchaseOrderImageClipboardLike
  createClipboardItem?: (items: Record<string, Blob | Promise<Blob>>) => PurchaseOrderImageClipboardItemLike
}

function browserClipboard(): PurchaseOrderImageClipboardLike | undefined {
  // 浏览器 Clipboard.write 接受真实 ClipboardItem；本项目只在 factory 中构造该类型。
  return typeof navigator === 'undefined' ? undefined : navigator.clipboard as unknown as PurchaseOrderImageClipboardLike
}

function browserClipboardItem(): PurchaseOrderImageClipboardDependencies['createClipboardItem'] {
  if (typeof ClipboardItem === 'undefined') {
    return undefined
  }
  return items => new ClipboardItem(items)
}

/**
 * 采购单图片必须在点击手势内交给剪贴板，不能先等待网络或重新渲染，
 * 否则 Safari 等浏览器会丢失用户激活。调用方应保留已生成的 PNG Blob。
 */
export function copyPurchaseOrderImageToClipboard(
  blob: Blob,
  dependencies: PurchaseOrderImageClipboardDependencies = {},
): Promise<void> {
  const clipboard = dependencies.clipboard ?? browserClipboard()
  const createClipboardItem = dependencies.createClipboardItem ?? browserClipboardItem()
  if (!clipboard?.write || !createClipboardItem) {
    return Promise.reject(new PurchaseOrderImageClipboardError('UNAVAILABLE'))
  }
  if (!blob.size) {
    return Promise.reject(new PurchaseOrderImageClipboardError('FAILED'))
  }
  try {
    const png = blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' })
    return clipboard.write([createClipboardItem({ 'image/png': png })]).catch(() => {
      throw new PurchaseOrderImageClipboardError('FAILED')
    })
  }
  catch {
    return Promise.reject(new PurchaseOrderImageClipboardError('FAILED'))
  }
}
