import type { QsStatusTagTone } from '@/utils/status-tag-tone'

export type SystemStatusLevel = 'ok' | 'warning' | 'critical' | 'unknown'
export type DeploymentEnvironment = 'dev' | 'test' | 'prod' | 'unknown'

export const SYSTEM_STATUS_LABELS: Readonly<Record<SystemStatusLevel, string>> = {
  ok: '正常',
  warning: '需关注',
  critical: '异常',
  unknown: '未知',
}

const STATUS_TONES: Readonly<Record<SystemStatusLevel, QsStatusTagTone>> = {
  ok: 'success',
  warning: 'warning',
  critical: 'danger',
  unknown: 'neutral',
}

export function statusTone(status: SystemStatusLevel): QsStatusTagTone {
  return STATUS_TONES[status]
}

export function environmentLabel(environment: DeploymentEnvironment): string {
  if (environment === 'dev') {
    return '开发环境'
  }
  if (environment === 'test') {
    return '测试环境'
  }
  if (environment === 'prod') {
    return '生产环境'
  }
  return '未知环境'
}

export function environmentTone(environment: DeploymentEnvironment): QsStatusTagTone {
  if (environment === 'prod') {
    return 'success'
  }
  if (environment === 'dev') {
    return 'success'
  }
  if (environment === 'test') {
    return 'warning'
  }
  return 'neutral'
}

export function capabilityLabel(status: 'up' | 'down' | 'unknown'): string {
  if (status === 'up') {
    return '正常'
  }
  if (status === 'down') {
    return '异常'
  }
  return '未知'
}

export function capacityLevelLabel(
  level: 'ok' | 'warning' | 'critical' | 'unknown' | null,
): string {
  if (level === 'ok') {
    return '正常'
  }
  if (level === 'warning') {
    return '偏低'
  }
  if (level === 'critical') {
    return '不足'
  }
  return '未知'
}

export function mediaDriverLabel(driver: string): string {
  if (driver === 'cos') {
    return '对象存储（COS）'
  }
  if (driver === 'local') {
    return '本地磁盘'
  }
  return driver
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const

export function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return '—'
  }
  let scaled = value
  let unitIndex = 0
  while (scaled >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    scaled /= 1024
    unitIndex += 1
  }
  const digits = unitIndex === 0 ? 0 : scaled >= 100 ? 0 : 1
  return `${scaled.toFixed(digits)} ${BYTE_UNITS[unitIndex]}`
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) {
    return '—'
  }
  return `${value.toFixed(digits)}%`
}

export function formatRate(bytesPerSecond: number | null): string {
  return bytesPerSecond === null ? '—' : `${formatBytes(bytesPerSecond)}/s`
}

export function formatMilliseconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '—'
  }
  return `${value.toFixed(1)} ms`
}

export function formatCores(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '—'
  }
  return `${value.toFixed(2)} 核`
}

export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '—'
  }
  return Math.round(value).toLocaleString('zh-CN')
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '—'
  }
  const total = Math.floor(seconds)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor(total % 86_400 / 3_600)
  const minutes = Math.floor(total % 3_600 / 60)
  if (days > 0) {
    return `${days} 天 ${hours} 小时`
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分`
  }
  if (minutes > 0) {
    return `${minutes} 分 ${total % 60} 秒`
  }
  return `${total} 秒`
}

export function formatLoadAverage(
  loadAverage: readonly number[] | null,
): string {
  if (loadAverage === null || loadAverage.length < 3) {
    return '—'
  }
  return loadAverage
    .slice(0, 3)
    .map(value => value.toFixed(2))
    .join(' / ')
}

export function isDeploymentMismatch(
  webVersion: string | null,
  serverVersion: string,
): boolean {
  return webVersion !== null
    && serverVersion !== 'unknown'
    && webVersion !== serverVersion
}

export function findCheckStatus(
  checks: readonly { key: string, status: SystemStatusLevel }[],
  key: string,
): SystemStatusLevel {
  return checks.find(check => check.key === key)?.status ?? 'unknown'
}

export interface SplitOperation {
  readonly method: string
  readonly route: string
}

/** 把 `GET /sales-orders/:id` 拆成方法徽标与路由模板。 */
export function splitOperation(operation: string): SplitOperation {
  const separator = operation.indexOf(' ')
  if (separator <= 0) {
    return { method: 'ANY', route: operation }
  }
  const method = operation.slice(0, separator)
  if (!/^[A-Z]+$/u.test(method)) {
    return { method: 'ANY', route: operation }
  }
  return { method, route: operation.slice(separator + 1).trim() }
}

export function methodTone(method: string): QsStatusTagTone {
  if (method === 'GET') {
    return 'info'
  }
  if (method === 'DELETE') {
    return 'danger'
  }
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    return 'warning'
  }
  return 'neutral'
}

export function statusCodeLabel(code: number): string {
  if (code >= 200 && code < 300) {
    return `${code} OK`
  }
  if (code >= 500) {
    return `${code} 异常`
  }
  if (code >= 400) {
    return `${code} 请求错误`
  }
  return String(code)
}

export function statusCodeTone(code: number): QsStatusTagTone {
  if (code >= 200 && code < 300) {
    return 'success'
  }
  if (code >= 500) {
    return 'danger'
  }
  if (code >= 400) {
    return 'warning'
  }
  return 'neutral'
}

export function capabilityMark(status: 'up' | 'down' | 'unknown'): string {
  if (status === 'up') {
    return '✓'
  }
  if (status === 'down') {
    return '✗'
  }
  return '—'
}

export function serviceShortLabel(key: string): string {
  if (key === 'backend') {
    return '后端'
  }
  if (key === 'database') {
    return '数据库'
  }
  if (key === 'media') {
    return '媒体存储'
  }
  return key
}

/** 从完整 PostgreSQL version() 中提取 `PostgreSQL 16.14`，供卡片标题使用。 */
export function databaseShortLabel(version: string | null): string {
  const match = version?.match(/PostgreSQL\s+(\d+(?:\.\d+)?)/iu)
  return match === null || match === undefined
    ? '数据库'
    : `PostgreSQL ${match[1]}`
}

export function versionWithPrefix(version: string | null): string {
  if (version === null || version.trim() === '') {
    return '—'
  }
  return version.startsWith('v') ? version : `v${version}`
}

export function diskLevelText(freePercent: number | null): string {
  if (freePercent === null) {
    return '未知'
  }
  if (freePercent < 10) {
    return '容量不足'
  }
  if (freePercent < 20) {
    return '容量偏低'
  }
  return '水位正常'
}

export function diskLevelTone(freePercent: number | null): QsStatusTagTone {
  if (freePercent === null) {
    return 'neutral'
  }
  if (freePercent < 10) {
    return 'danger'
  }
  return freePercent < 20 ? 'warning' : 'success'
}

export function hostMemoryLevelText(availablePercent: number | null): string {
  if (availablePercent === null) {
    return '未知'
  }
  if (availablePercent < 5) {
    return '宿主可用不足'
  }
  return availablePercent < 20 ? '宿主可用偏低' : '正常'
}

export function hostMemoryLevelTone(availablePercent: number | null): QsStatusTagTone {
  if (availablePercent === null) {
    return 'neutral'
  }
  if (availablePercent < 5) {
    return 'danger'
  }
  return availablePercent < 20 ? 'warning' : 'success'
}

export function overallTone(
  status: SystemStatusLevel,
): 'rose' | 'amber' | 'emerald' | 'neutral' {
  if (status === 'critical') {
    return 'rose'
  }
  if (status === 'warning') {
    return 'amber'
  }
  if (status === 'ok') {
    return 'emerald'
  }
  return 'neutral'
}

export interface OverallReasonInput {
  readonly checks: readonly {
    readonly category: 'service' | 'resource' | 'performance'
    readonly key: string
    readonly label: string
    readonly message: string | null
    readonly status: SystemStatusLevel
  }[]
  readonly overallStatus: SystemStatusLevel
  readonly performance: {
    readonly errorRatePercent: number | null
    readonly windowRequests: number
  } | null
}

export interface OverallReason {
  readonly text: string
  readonly tone: QsStatusTagTone
}

export function resolveOverallReason(
  input: OverallReasonInput,
): OverallReason {
  if (
    input.performance !== null
    && input.performance.windowRequests > 0
    && (input.performance.errorRatePercent ?? 0) >= 5
  ) {
    return {
      text: `触发原因：近 5 分钟 5xx 错误率 ${formatPercent(input.performance.errorRatePercent)}`,
      tone: 'danger',
    }
  }

  const critical = input.checks.find(
    check => check.status === 'critical' && check.key !== 'performance',
  )
  if (critical !== undefined) {
    return {
      text: `触发原因：${critical.label}${critical.message === null ? '' : ` · ${critical.message}`}`,
      tone: 'danger',
    }
  }

  const warning = input.checks.find(
    check => check.status === 'warning' && check.key !== 'performance',
  )
  if (warning !== undefined) {
    return {
      text: `关注原因：${warning.label}${warning.message === null ? '' : ` · ${warning.message}`}`,
      tone: 'warning',
    }
  }

  const unknown = input.checks.find(
    check => check.status === 'unknown' && check.category !== 'performance',
  )
  if (unknown !== undefined) {
    return {
      text: `数据待补：${unknown.label}暂未采集`,
      tone: 'warning',
    }
  }

  if (input.overallStatus === 'ok') {
    return { text: '全部检查通过', tone: 'success' }
  }
  return { text: '暂无异常', tone: 'neutral' }
}
