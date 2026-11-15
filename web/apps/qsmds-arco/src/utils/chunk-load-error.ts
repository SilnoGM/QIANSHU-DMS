/**
 * 部署新版本后，旧页面里尚未加载的懒加载 chunk 已被新镜像替换，
 * 导航时会抛出动态 import 失败。这类错误无法靠重试修复，只能提示用户刷新。
 *
 * 不同浏览器的错误文案不同（Chrome/Vite、Firefox、旧 webpack），这里统一识别；
 * 其他路由错误保持原样，不能误判成需要刷新。
 */
const CHUNK_LOAD_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/iu,
  /Importing a module script failed/iu,
  /error loading dynamically imported module/iu,
  /Loading (?:CSS )?chunk .* failed/iu,
]

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const record = error as { name?: unknown, message?: unknown }
  if (record.name === 'ChunkLoadError') {
    return true
  }
  const message = typeof record.message === 'string' ? record.message : ''
  return CHUNK_LOAD_ERROR_PATTERNS.some(pattern => pattern.test(message))
}
