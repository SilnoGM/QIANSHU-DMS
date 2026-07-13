import type { ApiError } from './api-error'

import { isApiError } from './api-error'

/** Blob 错误 body 的硬上限，避免将大文件读入内存并当作 JSON 处理。 */
export const MAX_API_ERROR_BLOB_BYTES = 1024 * 1024

function isJsonMediaType(contentType: string | undefined): boolean {
  // 逗号表示代理或适配器合并了多个冲突值，此时不能猜测哪个值可信。
  if (contentType === undefined || contentType.includes(',')) {
    return false
  }

  const [rawMediaType] = contentType.split(';', 1)
  const mediaType = rawMediaType?.trim().toLowerCase()

  return mediaType === 'application/json'
    || /^application\/[^/;\s]+\+json$/.test(mediaType ?? '')
}

/**
 * 仅在响应头明确声明 JSON 且 body 足够小时，才尝试从 Blob 恢复 ApiError。
 *
 * Blob.type 可能由调用方或浏览器推断，不能代替真实 HTTP Content-Type；所有解析失败都静默收敛，
 * 上层会统一转换为不可解析错误，不泄露原始 body。
 */
export async function parseBlobApiError(
  value: unknown,
  contentType: string | undefined,
): Promise<ApiError | undefined> {
  try {
    if (
      !(value instanceof Blob)
      || !isJsonMediaType(contentType)
      || value.size > MAX_API_ERROR_BLOB_BYTES
    ) {
      return undefined
    }

    const parsed: unknown = JSON.parse(await value.text())
    return isApiError(parsed) ? parsed : undefined
  }
  catch {
    return undefined
  }
}
