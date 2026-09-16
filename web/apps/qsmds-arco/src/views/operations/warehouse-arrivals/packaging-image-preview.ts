import type { PackagingImageError } from './packaging-cost.logic'
import { PACKAGING_IMAGE_LIMIT, validatePackagingImage } from './packaging-cost.logic'

interface PreviewResponse { url: string }

/** 每次打开弹窗创建独立会话；关闭后旧上传回调不能向新表单加入图片。 */
export function createPackagingImagePreview(options: {
  createObjectURL: (file: File) => string
  revokeObjectURL: (url: string) => void
  onError: (error: PackagingImageError | null) => void
}) {
  const entries = new Map<string, File>()
  let visibleUrls: string[] = []
  let disposed = false

  function beforeUpload(file: File): boolean {
    if (disposed) {
      return false
    }
    const error = validatePackagingImage(file)
      ?? (entries.size >= PACKAGING_IMAGE_LIMIT ? 'tooManyImages' : null)
    options.onError(error)
    return error === null
  }

  // FaImageUpload 不捕获上传钩子的异常；本地失败返回空结果并显示字段错误，避免未处理 rejection。
  function httpRequest({ file }: { file: File }): PreviewResponse | null {
    if (!beforeUpload(file)) {
      return null
    }
    try {
      const url = options.createObjectURL(file)
      entries.set(url, file)
      return { url }
    }
    catch {
      options.onError('previewFailed')
      return null
    }
  }

  function afterUpload(response: PreviewResponse | null): string {
    return !disposed && response && entries.has(response.url) ? response.url : ''
  }

  function revoke(url: string) {
    entries.delete(url)
    options.revokeObjectURL(url)
  }

  function sync(urls: readonly string[]) {
    // 只释放曾经进入模型又被删除的 URL，避免并发上传还未写回模型时误释放。
    visibleUrls.filter(url => !urls.includes(url) && entries.has(url)).forEach(revoke)
    visibleUrls = [...urls]
  }

  function files(urls: readonly string[]): File[] {
    return urls.flatMap(url => entries.has(url) ? [entries.get(url)!] : [])
  }

  function dispose() {
    disposed = true
    Array.from(entries.keys()).forEach(revoke)
    visibleUrls = []
  }

  return { beforeUpload, httpRequest, afterUpload, sync, files, dispose }
}
