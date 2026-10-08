/**
 * 派生呈现变体只改变交付字节，不改变鉴权与路由：服务端在同一条 content 路由上
 * 按 `variant` 渲染缩略图（图片）或封面帧（视频），并给出长期私有缓存。
 *
 * 因此 Web 侧只做一件事：在**已由服务端返回、且同源**的内容路径上追加固定参数。
 * 任何非 `/api/` 开头的值都拒绝拼接，避免把外部地址或畸形字符串交给 DOM。
 */
export type MediaVariantName = 'thumb' | 'poster'

export function withMediaVariant(
  contentUrl: string | null | undefined,
  variant: MediaVariantName,
): string | undefined {
  if (typeof contentUrl !== 'string' || !contentUrl.startsWith('/api/')) {
    return undefined
  }
  const separator = contentUrl.includes('?') ? '&' : '?'
  return `${contentUrl}${separator}variant=${variant}`
}

/** 列表与图板的缩略位使用；详情与预览继续使用原件。 */
export function mediaThumbnailUrl(
  contentUrl: string | null | undefined,
): string | undefined {
  return withMediaVariant(contentUrl, 'thumb')
}

/** 视频卡片的封面帧；视频本体保持 preload="none"，点击后才加载。 */
export function mediaPosterUrl(
  contentUrl: string | null | undefined,
): string | undefined {
  return withMediaVariant(contentUrl, 'poster')
}
