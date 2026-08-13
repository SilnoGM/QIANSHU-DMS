import { isAbsolute, parse, resolve } from 'node:path'

import { registerAs } from '@nestjs/config'

export const DEFAULT_MEDIA_STORAGE_ROOT = '/var/lib/qianshu-dms/media'
const DEFAULT_MEDIA_STAGING_TTL_HOURS = 24
const DEFAULT_MEDIA_TRASH_RETENTION_DAYS = 7
const MIN_MEDIA_STAGING_TTL_HOURS = 1
const MAX_MEDIA_STAGING_TTL_HOURS = 168
const MIN_MEDIA_TRASH_RETENTION_DAYS = 7
const MAX_MEDIA_TRASH_RETENTION_DAYS = 3_650

export interface MediaConfiguration {
  readonly driver: 'local'
  readonly storageRoot: string
  readonly stagingTtlHours: number
  readonly trashRetentionDays: number
}

export interface NormalizedMediaEnvironment {
  readonly MEDIA_STORAGE_DRIVER: 'local'
  readonly MEDIA_STORAGE_ROOT: string
  readonly MEDIA_STAGING_TTL_HOURS: number
  readonly MEDIA_TRASH_RETENTION_DAYS: number
}

function mediaConfigurationError(key: string, constraint: string): Error {
  // 路径可能暴露部署拓扑和用户名；配置错误只包含稳定键名与固定约束，不拼接原始值。
  return new Error(`Environment validation failed: ${key} ${constraint}`)
}

function normalizeDriver(value: unknown): 'local' {
  if (value === undefined || value === '') return 'local'
  if (value !== 'local') {
    throw mediaConfigurationError('MEDIA_STORAGE_DRIVER', 'must be local')
  }
  return value
}

function normalizeStorageRoot(value: unknown): string {
  const rawValue = value === undefined || value === ''
    ? DEFAULT_MEDIA_STORAGE_ROOT
    : value

  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    throw mediaConfigurationError(
      'MEDIA_STORAGE_ROOT',
      'must be an absolute non-root path',
    )
  }

  const candidate = rawValue.trim()
  if (!isAbsolute(candidate)) {
    throw mediaConfigurationError(
      'MEDIA_STORAGE_ROOT',
      'must be an absolute non-root path',
    )
  }

  const normalized = resolve(candidate)
  if (normalized === parse(normalized).root) {
    throw mediaConfigurationError(
      'MEDIA_STORAGE_ROOT',
      'must be an absolute non-root path',
    )
  }

  return normalized
}

function normalizeBoundedInteger(
  key: 'MEDIA_STAGING_TTL_HOURS' | 'MEDIA_TRASH_RETENTION_DAYS',
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === '') return fallback
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw mediaConfigurationError(
      key,
      `must be an integer between ${minimum} and ${maximum}`,
    )
  }

  const normalized = Number(value)
  if (
    !Number.isInteger(normalized) ||
    normalized < minimum ||
    normalized > maximum
  ) {
    throw mediaConfigurationError(
      key,
      `must be an integer between ${minimum} and ${maximum}`,
    )
  }
  return normalized
}

/**
 * 规范化 Media 配置的扁平环境变量。
 *
 * 这里只验证无副作用的值合同；realpath、目录权限、symlink、设备号和磁盘空间必须由
 * LocalMediaStorage 在实际文件系统上验证，不能在同步 ConfigModule 校验中伪造结论。
 */
export function normalizeMediaEnvironment(
  environment: Record<string, unknown>,
): NormalizedMediaEnvironment {
  return {
    MEDIA_STORAGE_DRIVER: normalizeDriver(environment.MEDIA_STORAGE_DRIVER),
    MEDIA_STORAGE_ROOT: normalizeStorageRoot(environment.MEDIA_STORAGE_ROOT),
    MEDIA_STAGING_TTL_HOURS: normalizeBoundedInteger(
      'MEDIA_STAGING_TTL_HOURS',
      environment.MEDIA_STAGING_TTL_HOURS,
      DEFAULT_MEDIA_STAGING_TTL_HOURS,
      MIN_MEDIA_STAGING_TTL_HOURS,
      MAX_MEDIA_STAGING_TTL_HOURS,
    ),
    MEDIA_TRASH_RETENTION_DAYS: normalizeBoundedInteger(
      'MEDIA_TRASH_RETENTION_DAYS',
      environment.MEDIA_TRASH_RETENTION_DAYS,
      DEFAULT_MEDIA_TRASH_RETENTION_DAYS,
      MIN_MEDIA_TRASH_RETENTION_DAYS,
      MAX_MEDIA_TRASH_RETENTION_DAYS,
    ),
  }
}

export function createMediaConfiguration(
  environment: Record<string, unknown> = process.env,
): MediaConfiguration {
  const normalized = normalizeMediaEnvironment(environment)
  return Object.freeze({
    driver: normalized.MEDIA_STORAGE_DRIVER,
    storageRoot: normalized.MEDIA_STORAGE_ROOT,
    stagingTtlHours: normalized.MEDIA_STAGING_TTL_HOURS,
    trashRetentionDays: normalized.MEDIA_TRASH_RETENTION_DAYS,
  })
}

export default registerAs('media', () => createMediaConfiguration())
