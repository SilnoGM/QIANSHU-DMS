export interface SalesOrderDocumentPreviewDependencies {
  readonly createObjectURL: (file: File) => string
  readonly revokeObjectURL: (url: string) => void
}

export interface SalesOrderDocumentPreviewRegistry {
  readonly size: number
  clear: () => void
  get: (documentKey: string) => null | string
  register: (documentKey: string, file: File) => string
  release: (documentKey: string) => void
  snapshot: () => Readonly<Record<string, string>>
}

function safelyRevoke(
  revokeObjectURL: (url: string) => void,
  previewUrl: string,
): void {
  try {
    revokeObjectURL(previewUrl)
  }
  catch {
    // 单个浏览器资源回收失败不能阻止其余 URL 被释放，也不能恢复已经清除的引用。
  }
}

/**
 * 新增销售订单页面持有的本地附件预览注册表。
 *
 * Object URL 只属于当前未保存表单，不进入表单模型、API DTO 或 Pinia。页面在移除
 * 单项附件、放弃/保存后重置以及卸载时调用统一释放入口，避免 Blob 强引用泄漏。
 */
export function createSalesOrderDocumentPreviewRegistry(
  dependencies: SalesOrderDocumentPreviewDependencies = {
    createObjectURL: file => URL.createObjectURL(file),
    revokeObjectURL: url => URL.revokeObjectURL(url),
  },
): SalesOrderDocumentPreviewRegistry {
  const previews = new Map<string, string>()

  return {
    get size() {
      return previews.size
    },
    clear() {
      const currentUrls = [...previews.values()]
      // 先删除全部强引用；即使某个浏览器 revoke 抛错，重复 clear 也不会二次回收。
      previews.clear()
      currentUrls.forEach(url => safelyRevoke(dependencies.revokeObjectURL, url))
    },
    get(documentKey) {
      return previews.get(documentKey) ?? null
    },
    register(documentKey, file) {
      if (documentKey.trim() === '' || previews.has(documentKey)) {
        throw new TypeError('documentKey 必须是唯一非空 stable key')
      }

      const previewUrl = dependencies.createObjectURL(file)
      if (typeof previewUrl !== 'string' || previewUrl.trim() === '') {
        throw new TypeError('createObjectURL 必须返回非空地址')
      }
      previews.set(documentKey, previewUrl)
      return previewUrl
    },
    release(documentKey) {
      const previewUrl = previews.get(documentKey)
      // 删除先于副作用，保证 release 在 revoke 抛错或被重复调用时仍保持幂等。
      previews.delete(documentKey)
      if (previewUrl !== undefined) {
        safelyRevoke(dependencies.revokeObjectURL, previewUrl)
      }
    },
    snapshot() {
      return Object.freeze(Object.fromEntries(previews.entries()))
    },
  }
}
