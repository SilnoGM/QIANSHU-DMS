import type { ProxyNodeDto } from '../../../api/generated/types.gen'

export type ProxyNodeCardMode = 'operations' | 'management'
export type ProxyNodeCardStatus
  = | 'ACTIVE'
    | 'EXPIRING_SOON'
    | 'EXPIRING_CRITICAL'
    | 'EXPIRED'

export const PROXY_NODE_STATUS_FILTERS = [
  'ALL',
  'ACTIVE',
  'EXPIRING',
  'EXPIRING_2D',
  'EXPIRED',
  'UNASSIGNED',
] as const
export type ProxyNodeStatusFilter = (typeof PROXY_NODE_STATUS_FILTERS)[number]

const DAY_MS = 86_400_000
const EXPIRING_WINDOW_MS = 7 * DAY_MS
const CRITICAL_WINDOW_MS = DAY_MS
const TWO_DAY_WINDOW_MS = 2 * DAY_MS
const COUNTRY_OVERRIDES: Readonly<Record<string, string>> = {
  TW: '中国台湾',
  HK: '中国香港',
}

function expiryTimestamp(expiresAt: string): number | null {
  const timestamp = Date.parse(expiresAt)
  return Number.isFinite(timestamp) ? timestamp : null
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function resolveProxyNodeStatus(
  expiresAt: string,
  nowMs: number,
): ProxyNodeCardStatus {
  const expiresAtMs = expiryTimestamp(expiresAt)
  if (expiresAtMs === null) {
    return 'EXPIRED'
  }

  const remainingMs = expiresAtMs - nowMs
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

/**
 * 与服务端状态同口径的倒计时文案。
 *
 * 未过期时秒数向上取整，最后一秒仍显示 00:00:01；到 0 才切“已过期”。
 * 天数按你的口径不补前导零，时/分/秒固定两位。
 */
export function formatProxyNodeCountdown(
  expiresAt: string,
  nowMs: number,
): string {
  const expiresAtMs = expiryTimestamp(expiresAt)
  if (expiresAtMs === null) {
    return '—'
  }

  const remainingMs = expiresAtMs - nowMs
  const expired = remainingMs <= 0
  const totalSeconds = expired
    ? Math.floor(-remainingMs / 1000)
    : Math.ceil(remainingMs / 1000)

  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const time = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`

  return `${expired ? '已过期' : '剩余'} ${days} 天 ${time}`
}

export function resolveProxyNodeStatusLabel(
  status: ProxyNodeCardStatus,
): string {
  if (status === 'ACTIVE') {
    return '正常'
  }
  if (status === 'EXPIRED') {
    return '已过期'
  }
  return '即将到期'
}

export function resolveProxyNodeStatusClass(
  status: ProxyNodeCardStatus,
): string {
  if (status === 'ACTIVE') {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  if (status === 'EXPIRING_SOON') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400'
  }
  return 'border-destructive/30 bg-destructive/10 text-destructive dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-400'
}

export function resolveProxyNodeCountdownClass(
  status: ProxyNodeCardStatus,
): string {
  if (status === 'ACTIVE') {
    return 'bg-primary/10 text-primary'
  }
  if (status === 'EXPIRING_SOON') {
    return 'bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-400'
  }
  return 'bg-destructive/10 text-destructive dark:bg-red-400/10 dark:text-red-400'
}

export function resolveProxyNodeWarning(
  status: ProxyNodeCardStatus,
  mode: ProxyNodeCardMode,
): string | null {
  if (status === 'ACTIVE') {
    return null
  }
  if (status === 'EXPIRED') {
    return '节点已过期，复制后的配置可能不可用'
  }
  if (status === 'EXPIRING_CRITICAL') {
    return mode === 'management' ? '请立即处理' : '请立即联系管理员续费'
  }
  return mode === 'management' ? '请安排续费' : '请联系管理员续费'
}

export function resolveProxyNodeWarningClass(
  status: ProxyNodeCardStatus,
): string {
  return status === 'EXPIRING_SOON'
    ? 'text-amber-700 dark:text-amber-400'
    : 'text-destructive'
}

export function resolveProxyNodeCountryLabel(node: ProxyNodeDto): string {
  const code = node.countryCode?.trim().toUpperCase() ?? ''
  const name = COUNTRY_OVERRIDES[code]
    ?? node.countryName?.trim()
    ?? ''

  if (code !== '' && name !== '') {
    return `${code}-${name}`
  }
  if (code !== '') {
    return code
  }
  if (name !== '') {
    return name
  }
  return '—'
}

export function resolveProxyNodeTypeLabel(ipType: ProxyNodeDto['ipType']): string {
  if (ipType === 'STATIC_DATACENTER') {
    return '静态数据中心'
  }
  if (ipType === 'STATIC_ISP') {
    return '静态住宅'
  }
  return '静态住宅 Pro'
}

export function resolveProxyNodeProtocolLabel(
  protocol: ProxyNodeDto['protocol'],
): string {
  return protocol
}

export function resolveProxyNodePublicIpLabel(node: ProxyNodeDto): string | null {
  const publicIp = node.publicIp?.trim() ?? ''
  if (publicIp === '' || publicIp === node.host) {
    return null
  }
  return `出口 IP ${publicIp}`
}

export function buildProxyNodeCopyText(node: ProxyNodeDto): string {
  return `${node.protocol.toLowerCase()}://${node.host}:${node.port}:${node.username}:${node.password}`
}

export function isProxyNodeCredentialAvailable(node: ProxyNodeDto): boolean {
  return !node.credentialUnavailable && node.password.length > 0
}

/**
 * 页面动作的禁用原因。过期与供应商侧缺失在服务端也会拒绝，这里提前给出可读提示。
 * 凭证解密失败只影响复制，不影响绑定/解绑。
 */
export function resolveProxyNodeActionDisabledReason(
  node: ProxyNodeDto,
): string | null {
  if (node.vendorMissing) {
    return '供应商侧已不可见，请先同步'
  }
  if (node.status === 'EXPIRED') {
    return '节点已过期，不能绑定'
  }
  return null
}

function matchesKeyword(node: ProxyNodeDto, keyword: string): boolean {
  const normalized = keyword.trim().toLowerCase()
  if (normalized === '') {
    return true
  }

  const assignee = node.assignedUser
  return [
    node.host,
    node.providerProxyId,
    node.username,
    node.countryCode ?? '',
    node.countryName ?? '',
    assignee?.displayName ?? '',
    assignee?.username ?? '',
  ].some(value => value.toLowerCase().includes(normalized))
}

export function filterProxyNodes(
  rows: readonly ProxyNodeDto[],
  filter: ProxyNodeStatusFilter,
  keyword: string,
  nowMs: number,
): ProxyNodeDto[] {
  return rows.filter((node) => {
    if (!matchesKeyword(node, keyword)) {
      return false
    }

    const status = resolveProxyNodeStatus(node.expiresAt, nowMs)
    if (filter === 'ALL') {
      return true
    }
    if (filter === 'ACTIVE') {
      return status === 'ACTIVE'
    }
    if (filter === 'EXPIRING') {
      return status === 'EXPIRING_SOON' || status === 'EXPIRING_CRITICAL'
    }
    if (filter === 'EXPIRING_2D') {
      const expiresAtMs = expiryTimestamp(node.expiresAt)
      if (expiresAtMs === null) {
        return false
      }
      const remainingMs = expiresAtMs - nowMs
      return remainingMs > 0 && remainingMs <= TWO_DAY_WINDOW_MS
    }
    if (filter === 'EXPIRED') {
      return status === 'EXPIRED'
    }
    return node.assignedUser === null
  })
}

export interface ProxyNodeCounts {
  readonly total: number
  readonly active: number
  readonly assigned: number
  readonly unassigned: number
  readonly expiring: number
  readonly expiring2d: number
  readonly expired: number
}

export function countProxyNodes(
  rows: readonly ProxyNodeDto[],
  nowMs: number,
): ProxyNodeCounts {
  let active = 0
  let assigned = 0
  let expiring = 0
  let expiring2d = 0
  let expired = 0

  for (const node of rows) {
    if (node.assignedUser !== null) {
      assigned += 1
    }
    const status = resolveProxyNodeStatus(node.expiresAt, nowMs)
    if (status === 'ACTIVE') {
      active += 1
    }
    if (status === 'EXPIRING_SOON' || status === 'EXPIRING_CRITICAL') {
      expiring += 1
    }
    const expiresAtMs = expiryTimestamp(node.expiresAt)
    if (expiresAtMs !== null) {
      const remainingMs = expiresAtMs - nowMs
      if (remainingMs > 0 && remainingMs <= TWO_DAY_WINDOW_MS) {
        expiring2d += 1
      }
    }
    if (status === 'EXPIRED') {
      expired += 1
    }
  }

  return {
    total: rows.length,
    active,
    assigned,
    unassigned: rows.length - assigned,
    expiring,
    expiring2d,
    expired,
  }
}
