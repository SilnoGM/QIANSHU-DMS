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
  if (environment === 'test') {
    return 'warning'
  }
  if (environment === 'dev') {
    return 'info'
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
