export const PROXY_NODE_STATUSES = [
  'ACTIVE',
  'EXPIRING_SOON',
  'EXPIRING_CRITICAL',
  'EXPIRED',
] as const

export type ProxyNodeStatus = (typeof PROXY_NODE_STATUSES)[number]

const DAY_MS = 86_400_000
const EXPIRING_WINDOW_MS = 7 * DAY_MS
const CRITICAL_WINDOW_MS = DAY_MS

/**
 * 与服务端时区无关的绝对时间分档：
 * > 7 天正常；> 1 天且 ≤ 7 天即将到期；> 0 且 ≤ 1 天紧急；≤ 0 已过期。
 *
 * 前端倒计时使用同一组阈值，服务端状态只用于首次筛选和排序。
 */
export function resolveProxyNodeStatus(
  expiresAt: Date,
  now: Date,
): ProxyNodeStatus {
  const remainingMs = expiresAt.getTime() - now.getTime()

  if (remainingMs <= 0) {
    return 'EXPIRED'
  }
  if (remainingMs <= CRITICAL_WINDOW_MS) {
    return 'EXPIRING_CRITICAL'
  }
  if (remainingMs <= EXPIRING_WINDOW_MS) {
    return 'EXPIRING_SOON'
  }
  return 'ACTIVE'
}

export function isProxyNodeAssignable(
  expiresAt: Date,
  vendorMissing: boolean,
  now: Date,
): boolean {
  return !vendorMissing && expiresAt.getTime() > now.getTime()
}
