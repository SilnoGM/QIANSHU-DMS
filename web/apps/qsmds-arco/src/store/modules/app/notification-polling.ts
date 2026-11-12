export const NOTIFICATION_UNREAD_BASE_DELAY_MS = 30_000
export const NOTIFICATION_UNREAD_JITTER_MS = 6_000
export const NOTIFICATION_UNREAD_JITTER_OFFSET_MS = 3_000
export const NOTIFICATION_UNREAD_MAX_BACKOFF_MS = 300_000
export const NOTIFICATION_DESKTOP_MAX_PAGES = 3

export interface NotificationNewPage<T> {
  readonly items: readonly T[]
  readonly nextCursor: string | undefined
  readonly hasMore: boolean
  readonly unreadTotal: number
}

export interface CollectedNotificationNewPages<T> {
  readonly cursor: string
  readonly items: readonly T[]
  readonly hasMore: boolean
  readonly unreadTotal: number
}

/** 正常轮询保持 30 秒基线并加入 ±3 秒抖动，避免所有客户端同时打点。 */
export function unreadPollDelay(randomValue: number): number {
  const jitter = Math.abs(Math.trunc(randomValue)) % NOTIFICATION_UNREAD_JITTER_MS
  return NOTIFICATION_UNREAD_BASE_DELAY_MS + jitter - NOTIFICATION_UNREAD_JITTER_OFFSET_MS
}

/** 失败后按 60、120、240、300 秒退避；成功响应负责把计数清零。 */
export function unreadRetryDelay(failureCount: number): number {
  const attempts = Math.max(1, Math.trunc(failureCount))
  return Math.min(
    NOTIFICATION_UNREAD_BASE_DELAY_MS * 2 ** attempts,
    NOTIFICATION_UNREAD_MAX_BACKOFF_MS,
  )
}

/** 桌面轮询初始化失败时复用同一组退避间隔，避免网络抖动后永久停摆。 */
export function desktopRetryDelay(failureCount: number): number {
  return unreadRetryDelay(failureCount)
}

/** 无桌面提醒时，隐藏页不应继续持锁；交给可见标签继续拉未读数。 */
export function shouldYieldLeadership(visibilityState: DocumentVisibilityState, desktopEnabled: boolean): boolean {
  return visibilityState === 'hidden' && !desktopEnabled
}

/**
 * 单轮桌面增量最多拉三页。服务端按 (createdAt,id) 游标稳定分页，
 * 合并结果后只广播一次未读数，避免批量事件触发多轮通知。
 */
export async function collectNotificationPages<T>(
  initialCursor: string,
  fetchPage: (cursor: string) => Promise<NotificationNewPage<T>>,
  maxPages = NOTIFICATION_DESKTOP_MAX_PAGES,
): Promise<CollectedNotificationNewPages<T>> {
  const pageLimit = Math.max(1, Math.trunc(maxPages))
  let cursor = initialCursor
  let unreadTotal = 0
  let hasMore = false
  const items: T[] = []

  for (let pageIndex = 0; pageIndex < pageLimit; pageIndex += 1) {
    const page = await fetchPage(cursor)
    items.push(...page.items)
    unreadTotal = page.unreadTotal
    hasMore = page.hasMore
    if (page.nextCursor !== undefined) {
      cursor = page.nextCursor
    }
    if (!page.hasMore || page.items.length === 0 || page.nextCursor === undefined) {
      break
    }
  }

  return { cursor, hasMore, items, unreadTotal }
}
