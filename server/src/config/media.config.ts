import { isAbsolute, parse, resolve } from 'node:path'

import { registerAs } from '@nestjs/config'

export const DEFAULT_MEDIA_STORAGE_ROOT = '/var/lib/qianshu-dms/media'
export const DEFAULT_MEDIA_FFPROBE_PATH = '/usr/bin/ffprobe'
export const DEFAULT_MEDIA_QPDF_PATH = '/usr/bin/qpdf'
const DEFAULT_MEDIA_STAGING_TTL_HOURS = 24
const DEFAULT_MEDIA_TRASH_RETENTION_DAYS = 7
const MIN_MEDIA_STAGING_TTL_HOURS = 1
const MAX_MEDIA_STAGING_TTL_HOURS = 168
const MIN_MEDIA_TRASH_RETENTION_DAYS = 7
const MAX_MEDIA_TRASH_RETENTION_DAYS = 3_650
// COS 只接受小写地域标识；桶名必须带 APPID 后缀，凭据不做字符集假设，只要求非空且不含空白。
const COS_REGION_PATTERN = /^[a-z]{2,4}-[a-z0-9-]{2,32}$/u
const COS_BUCKET_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?-\d{6,}$/u
const COS_CREDENTIAL_PATTERN = /^\S{8,256}$/u
const DEFAULT_MEDIA_STORAGE_ENVIRONMENT: MediaStorageEnvironment = 'dev'

export type MediaContentDeliveryMode = 'application' | 'internal_redirect'

/**
 * 支持的媒体存储驱动，是代码侧的唯一清单。
 *
 * 数据库 `media_assets_storage_driver_check` 允许的枚举必须与这里一致——两边不一致时，
 * 运行期要么写不进库（数据库更严）、要么守卫形同虚设（代码更严），
 * `media-schema.spec.ts` 会据此断言。
 */
export const MEDIA_STORAGE_DRIVERS = ['local', 'cos'] as const

export type MediaStorageDriver = (typeof MEDIA_STORAGE_DRIVERS)[number]

/**
 * 对象键环境段的取值清单，是代码侧的唯一真相源。
 *
 * 同一桶承载多个环境时，环境段把 `assets/` 与 `trash/` 隔成互不可见的前缀，让 CAM 子账号策略、
 * 桶生命周期规则与对账都能按环境收敛。`NODE_ENV` 不能承担这个职责——测试构建同样可能使用
 * `production`，把部署期环境当成存储维度会产生错误前缀。`staging/` 永远在本地磁盘，不参与隔离。
 *
 * 取值禁止形如四位数字：对象键的布局判别以「环境段/业务池段不是年份」为前提（见
 * `media-object-key.ts` 的键形态判别）。
 */
export const MEDIA_STORAGE_ENVIRONMENTS = ['dev', 'test', 'prod'] as const

export type MediaStorageEnvironment = (typeof MEDIA_STORAGE_ENVIRONMENTS)[number]

/**
 * 配置对象只携带非敏感的定位信息。
 *
 * SecretId/SecretKey 只在装配 COS 客户端时从环境读取一次，绝不进入这个会被注入多个领域服务的
 * 冻结对象，避免任何日志、异常序列化或配置转储意外泄露长期密钥。
 */
export interface MediaCosTarget {
  readonly bucket: string
  readonly region: string
}

interface SharedMediaConfiguration {
  readonly contentDeliveryMode: MediaContentDeliveryMode
  readonly ffprobePath: string
  readonly qpdfPath: string
  readonly stagingTtlHours: number
  readonly storageEnvironment: MediaStorageEnvironment
  readonly storageRoot: string
  readonly trashRetentionDays: number
}

export interface LocalMediaConfiguration extends SharedMediaConfiguration {
  readonly driver: 'local'
}

export interface CosMediaConfiguration extends SharedMediaConfiguration {
  readonly cos: MediaCosTarget
  readonly driver: 'cos'
}

export type MediaConfiguration = CosMediaConfiguration | LocalMediaConfiguration

interface SharedNormalizedMediaEnvironment {
  readonly MEDIA_CONTENT_DELIVERY_MODE: MediaContentDeliveryMode
  readonly MEDIA_FFPROBE_PATH: string
  readonly MEDIA_QPDF_PATH: string
  readonly MEDIA_STAGING_TTL_HOURS: number
  readonly MEDIA_STORAGE_ENV: MediaStorageEnvironment
  readonly MEDIA_STORAGE_ROOT: string
  readonly MEDIA_TRASH_RETENTION_DAYS: number
}

export type NormalizedMediaEnvironment = SharedNormalizedMediaEnvironment & (
  | {
    readonly MEDIA_COS_BUCKET: null
    readonly MEDIA_COS_REGION: null
    readonly MEDIA_STORAGE_DRIVER: 'local'
  }
  | {
    readonly MEDIA_COS_BUCKET: string
    readonly MEDIA_COS_REGION: string
    readonly MEDIA_STORAGE_DRIVER: 'cos'
  }
)

function normalizeContentDeliveryMode(
  value: unknown,
  nodeEnvironment: unknown,
  driver: MediaStorageDriver,
): MediaContentDeliveryMode {
  if (value === undefined || value === '') {
    // COS 模式下不存在可供 Nginx internal 直读的本地文件，投递只能由应用流式返回。
    if (driver === 'cos') return 'application'
    // 开发和测试环境通常没有 Nginx internal location，因此默认由应用鉴权后流式读取；
    // production 延续已部署的 X-Accel-Redirect 路径，单机直出可显式切换为 application。
    return nodeEnvironment === 'production'
      ? 'internal_redirect'
      : 'application'
  }
  if (value !== 'application' && value !== 'internal_redirect') {
    throw mediaConfigurationError(
      'MEDIA_CONTENT_DELIVERY_MODE',
      'must be one of application, internal_redirect',
    )
  }
  // 显式配置的 internal_redirect 与 COS 驱动并存时必须失败关闭：否则生产会在启动后才发现
  // Nginx alias 指向的本地目录永远不存在。
  if (driver === 'cos' && value === 'internal_redirect') {
    throw mediaConfigurationError(
      'MEDIA_CONTENT_DELIVERY_MODE',
      'must be application when MEDIA_STORAGE_DRIVER is cos',
    )
  }
  return value
}

function normalizeExecutablePath(
  key: 'MEDIA_FFPROBE_PATH' | 'MEDIA_QPDF_PATH',
  value: unknown,
  fallback: string,
): string {
  const rawValue = value === undefined || value === '' ? fallback : value
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    throw mediaConfigurationError(key, 'must be an absolute executable path')
  }
  const normalized = resolve(rawValue.trim())
  if (!isAbsolute(rawValue.trim()) || normalized === parse(normalized).root) {
    throw mediaConfigurationError(key, 'must be an absolute executable path')
  }
  return normalized
}

function mediaConfigurationError(key: string, constraint: string): Error {
  // 路径可能暴露部署拓扑和用户名；配置错误只包含稳定键名与固定约束，不拼接原始值。
  return new Error(`Environment validation failed: ${key} ${constraint}`)
}

function normalizeDriver(value: unknown): MediaStorageDriver {
  if (value === undefined || value === '') return 'local'
  if (!(MEDIA_STORAGE_DRIVERS as readonly unknown[]).includes(value)) {
    throw mediaConfigurationError(
      'MEDIA_STORAGE_DRIVER',
      `must be one of ${MEDIA_STORAGE_DRIVERS.join(', ')}`,
    )
  }
  return value as MediaStorageDriver
}

function normalizeCosRegion(value: unknown): string {
  if (typeof value !== 'string' || !COS_REGION_PATTERN.test(value.trim())) {
    throw mediaConfigurationError('MEDIA_COS_REGION', 'must be a COS region identifier')
  }
  return value.trim()
}

function normalizeCosBucket(value: unknown): string {
  if (typeof value !== 'string' || !COS_BUCKET_PATTERN.test(value.trim())) {
    throw mediaConfigurationError(
      'MEDIA_COS_BUCKET',
      'must be a COS bucket name with appid suffix',
    )
  }
  return value.trim()
}

function requireCosCredential(
  key: 'MEDIA_COS_SECRET_ID' | 'MEDIA_COS_SECRET_KEY',
  value: unknown,
): void {
  if (typeof value !== 'string' || !COS_CREDENTIAL_PATTERN.test(value.trim())) {
    throw mediaConfigurationError(key, 'must be a COS credential')
  }
}

function normalizeStorageEnvironment(
  value: unknown,
  driver: MediaStorageDriver,
): MediaStorageEnvironment {
  if (value === undefined || value === '') {
    // cos 下没有默认值：回落到 dev 会把生产存量写成 dev 前缀，属于静默数据污染，必须失败关闭。
    if (driver === 'cos') {
      throw mediaConfigurationError(
        'MEDIA_STORAGE_ENV',
        'must be one of dev, test, prod when MEDIA_STORAGE_DRIVER is cos',
      )
    }
    return DEFAULT_MEDIA_STORAGE_ENVIRONMENT
  }
  if (
    typeof value !== 'string' ||
    !(MEDIA_STORAGE_ENVIRONMENTS as readonly unknown[]).includes(value.trim())
  ) {
    throw mediaConfigurationError(
      'MEDIA_STORAGE_ENV',
      'must be one of dev, test, prod',
    )
  }
  return value.trim() as MediaStorageEnvironment
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
  const driver = normalizeDriver(environment.MEDIA_STORAGE_DRIVER)
  const shared: SharedNormalizedMediaEnvironment = {
    MEDIA_CONTENT_DELIVERY_MODE: normalizeContentDeliveryMode(
      environment.MEDIA_CONTENT_DELIVERY_MODE,
      environment.NODE_ENV,
      driver,
    ),
    MEDIA_FFPROBE_PATH: normalizeExecutablePath(
      'MEDIA_FFPROBE_PATH',
      environment.MEDIA_FFPROBE_PATH,
      DEFAULT_MEDIA_FFPROBE_PATH,
    ),
    MEDIA_QPDF_PATH: normalizeExecutablePath(
      'MEDIA_QPDF_PATH',
      environment.MEDIA_QPDF_PATH,
      DEFAULT_MEDIA_QPDF_PATH,
    ),
    MEDIA_STAGING_TTL_HOURS: normalizeBoundedInteger(
      'MEDIA_STAGING_TTL_HOURS',
      environment.MEDIA_STAGING_TTL_HOURS,
      DEFAULT_MEDIA_STAGING_TTL_HOURS,
      MIN_MEDIA_STAGING_TTL_HOURS,
      MAX_MEDIA_STAGING_TTL_HOURS,
    ),
    MEDIA_STORAGE_ENV: normalizeStorageEnvironment(
      environment.MEDIA_STORAGE_ENV,
      driver,
    ),
    MEDIA_STORAGE_ROOT: normalizeStorageRoot(environment.MEDIA_STORAGE_ROOT),
    MEDIA_TRASH_RETENTION_DAYS: normalizeBoundedInteger(
      'MEDIA_TRASH_RETENTION_DAYS',
      environment.MEDIA_TRASH_RETENTION_DAYS,
      DEFAULT_MEDIA_TRASH_RETENTION_DAYS,
      MIN_MEDIA_TRASH_RETENTION_DAYS,
      MAX_MEDIA_TRASH_RETENTION_DAYS,
    ),
  }

  if (driver === 'local') {
    return {
      ...shared,
      MEDIA_COS_BUCKET: null,
      MEDIA_COS_REGION: null,
      MEDIA_STORAGE_DRIVER: 'local',
    }
  }

  const region = normalizeCosRegion(environment.MEDIA_COS_REGION)
  const bucket = normalizeCosBucket(environment.MEDIA_COS_BUCKET)
  // 凭据只验证存在性与形状，值本身既不返回也不进入任何错误信息。
  requireCosCredential('MEDIA_COS_SECRET_ID', environment.MEDIA_COS_SECRET_ID)
  requireCosCredential('MEDIA_COS_SECRET_KEY', environment.MEDIA_COS_SECRET_KEY)
  return {
    ...shared,
    MEDIA_COS_BUCKET: bucket,
    MEDIA_COS_REGION: region,
    MEDIA_STORAGE_DRIVER: 'cos',
  }
}

export function createMediaConfiguration(
  environment: Record<string, unknown> = process.env,
): MediaConfiguration {
  const normalized = normalizeMediaEnvironment(environment)
  const shared = {
    contentDeliveryMode: normalized.MEDIA_CONTENT_DELIVERY_MODE,
    ffprobePath: normalized.MEDIA_FFPROBE_PATH,
    qpdfPath: normalized.MEDIA_QPDF_PATH,
    stagingTtlHours: normalized.MEDIA_STAGING_TTL_HOURS,
    storageEnvironment: normalized.MEDIA_STORAGE_ENV,
    storageRoot: normalized.MEDIA_STORAGE_ROOT,
    trashRetentionDays: normalized.MEDIA_TRASH_RETENTION_DAYS,
  }

  if (normalized.MEDIA_STORAGE_DRIVER === 'cos') {
    return Object.freeze({
      ...shared,
      cos: Object.freeze({
        bucket: normalized.MEDIA_COS_BUCKET,
        region: normalized.MEDIA_COS_REGION,
      }),
      driver: 'cos',
    })
  }

  return Object.freeze({ ...shared, driver: 'local' })
}

export default registerAs('media', () => createMediaConfiguration())
