import type { ProductMediaSessionState } from './product-media.logic'

import { createEmptyProductMediaSessionState } from './product-media.logic'

export interface ProductMediaResourceDependencies {
  readonly createObjectURL: (file: File) => string
  readonly revokeObjectURL: (url: string) => void
}

export interface ProductMediaResourceRegistry {
  readonly fileCount: number
  readonly requestCount: number
  beginRequest: (requestId: string) => AbortSignal
  clear: () => void
  completeRequest: (requestId: string, signal: AbortSignal) => void
  getFile: (queueId: string) => File | undefined
  registerFile: (queueId: string, file: File) => string
  releaseFile: (queueId: string) => void
}

interface RegisteredFile {
  readonly file: File
  readonly previewUrl: string
}

function safelyAbort(controller: AbortController | undefined): void {
  try {
    controller?.abort()
  }
  catch {
    // 身份清理必须 best effort 继续处理其余请求和 Object URL。
  }
}

function safelyRevoke(
  revokeObjectURL: (url: string) => void,
  previewUrl: string,
): void {
  try {
    revokeObjectURL(previewUrl)
  }
  catch {
    // 浏览器资源清理失败不能阻止 File 引用和其他身份状态被清空。
  }
}

/**
 * File、Object URL 与 AbortController 都属于当前身份的敏感瞬时资源，不进入
 * Pinia 持久化。注册表使成功、取消、撤权和 authEpoch 变化共享同一清理路径。
 */
export function createProductMediaResourceRegistry(
  dependencies: ProductMediaResourceDependencies = {
    createObjectURL: file => URL.createObjectURL(file),
    revokeObjectURL: url => URL.revokeObjectURL(url),
  },
): ProductMediaResourceRegistry {
  const files = new Map<string, RegisteredFile>()
  const requests = new Map<string, AbortController>()

  return {
    get fileCount() {
      return files.size
    },
    get requestCount() {
      return requests.size
    },
    beginRequest(requestId) {
      if (requestId.trim() === '') {
        throw new TypeError('requestId 不能为空')
      }
      safelyAbort(requests.get(requestId))
      const controller = new AbortController()
      requests.set(requestId, controller)
      return controller.signal
    },
    clear() {
      const currentRequests = [...requests.values()]
      const currentFiles = [...files.values()]
      // 先清空所有强引用，后续单项 abort/revoke 即使失败也不能恢复旧身份资源。
      requests.clear()
      files.clear()
      currentRequests.forEach(safelyAbort)
      currentFiles.forEach(entry =>
        safelyRevoke(dependencies.revokeObjectURL, entry.previewUrl))
    },
    completeRequest(requestId, signal) {
      const current = requests.get(requestId)
      if (current?.signal === signal) {
        requests.delete(requestId)
      }
    },
    getFile(queueId) {
      return files.get(queueId)?.file
    },
    registerFile(queueId, file) {
      if (queueId.trim() === '' || files.has(queueId)) {
        throw new TypeError('queueId 必须是唯一非空 stable ID')
      }
      const previewUrl = dependencies.createObjectURL(file)
      if (previewUrl.trim() === '') {
        throw new TypeError('createObjectURL 必须返回非空地址')
      }
      files.set(queueId, { file, previewUrl })
      return previewUrl
    },
    releaseFile(queueId) {
      const entry = files.get(queueId)
      files.delete(queueId)
      const controller = requests.get(queueId)
      requests.delete(queueId)
      safelyAbort(controller)
      if (entry !== undefined) {
        safelyRevoke(dependencies.revokeObjectURL, entry.previewUrl)
      }
    },
  }
}

/** authEpoch、用户或维护权限变化均调用此边界；旧 state 不得被复用。 */
export function resetProductMediaSessionBoundary(
  state: ProductMediaSessionState,
  resources: ProductMediaResourceRegistry,
) {
  void state
  resources.clear()
  return createEmptyProductMediaSessionState()
}
