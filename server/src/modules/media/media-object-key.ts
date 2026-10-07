import type { MediaStorageEnvironment } from '../../config/media.config'
import type { ValidatedMediaContent } from './media-validation'

/**
 * 业务池：对象键里唯一承载业务语义的段。
 *
 * 池必须在「上传瞬间」就能确定，且此后不再变化——所以键里不放业务单据号（草稿上传时单据还不存在，
 * 单据号也可能被修正）。池只表达粗分类：生命周期、成本归集、运维可读性与敏感策略按池收敛，
 * 不按单据类型细分。
 *
 * `misc` 是存量遗留兜底（无引用、已终态或迁移期无法判定来源的对象），禁止业务模块主动选用。
 */
export const MEDIA_STORAGE_POOLS = [
  'product',
  'purchase',
  'sales',
  'packaging',
  'voucher',
  'payment-recipient',
  'bill',
  'container',
  'misc',
] as const

export type MediaStoragePool = (typeof MEDIA_STORAGE_POOLS)[number]

export type CanonicalMediaExtension = ValidatedMediaContent['canonicalExtension']

export type MediaObjectKeyLayout = 'legacy' | 'structured'

export type MediaObjectKeyNamespace = 'assets' | 'trash'

/**
 * 键段只允许小写字母数字与连字符，且必须以字母开头。
 *
 * 这条规则同时承担布局判别：环境段与池段都不能形如四位数字，否则会与旧布局的年份段混淆。
 */
const SEGMENT_PATTERN = /^[a-z][a-z0-9-]{1,30}$/u
const YEAR_PATTERN = /^[0-9]{4}$/u
const MONTH_PATTERN = /^[0-9]{2}$/u
// 键全量按小写生成；这里的解析容忍大写，与既有迁移/对账正则的大小写不敏感行为保持一致。
const EXTENSION_PATTERN = /^\.[a-z0-9]+$/iu
const ASSET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const NAMESPACES: readonly MediaObjectKeyNamespace[] = ['assets', 'trash']

export class MediaObjectKeyError extends Error {
  readonly code = 'MEDIA_OBJECT_KEY_INVALID'

  constructor() {
    super('Media object key is invalid')
    this.name = 'MediaObjectKeyError'
  }
}

export function isMediaStoragePool(value: unknown): value is MediaStoragePool {
  return (MEDIA_STORAGE_POOLS as readonly unknown[]).includes(value)
}

export function isMediaAssetId(value: unknown): value is string {
  return typeof value === 'string' && ASSET_ID_PATTERN.test(value)
}

export function isMediaStorageEnvironment(
  value: unknown,
): value is MediaStorageEnvironment {
  return value === 'dev' || value === 'test' || value === 'prod'
}

function isStorageSegment(value: unknown): value is string {
  return typeof value === 'string' && SEGMENT_PATTERN.test(value)
}

/**
 * 拆分 `<assetId><extension>`：扩展名只取最后一段，其余部分必须整体是 UUID。
 * 不使用捕获组，避免「正则解析用户输入」这类仅在工具层成立的告警噪声。
 */
function splitAssetFile(
  file: string,
): { readonly assetId: string, readonly extension: string } | null {
  const dotIndex = file.lastIndexOf('.')
  if (dotIndex <= 0) return null

  const assetId = file.slice(0, dotIndex)
  const extension = file.slice(dotIndex)
  if (!ASSET_ID_PATTERN.test(assetId) || !EXTENSION_PATTERN.test(extension)) {
    return null
  }
  return { assetId: assetId.toLowerCase(), extension: extension.toLowerCase() }
}

/**
 * 生成正式资产键：`assets/{env}/{pool}/{YYYY}/{MM}/{assetId}{ext}`。
 *
 * 年月使用 UTC，并且只作分片用途：它不等于业务口径的上传月份（东八区相差 8 小时），
 * 任何按业务时间的查询都必须读数据库列而不是解析键。
 */
export function buildMediaObjectKey(input: {
  readonly assetId: string
  readonly canonicalExtension: CanonicalMediaExtension
  readonly now: Date
  readonly pool: MediaStoragePool
  readonly storageEnvironment: MediaStorageEnvironment
}): string {
  if (!isStorageSegment(input.storageEnvironment)
    || !isMediaStorageEnvironment(input.storageEnvironment)
    || !isStorageSegment(input.pool)
    || !isMediaStoragePool(input.pool)
    || !Number.isFinite(input.now.getTime())
    || splitAssetFile(`${input.assetId}${input.canonicalExtension}`) === null
  ) {
    throw new MediaObjectKeyError()
  }

  const year = input.now.getUTCFullYear().toString().padStart(4, '0')
  const month = (input.now.getUTCMonth() + 1).toString().padStart(2, '0')
  return `assets/${input.storageEnvironment}/${input.pool}/${year}/${month}/${input.assetId}${input.canonicalExtension}`
}

export interface ParsedStoredMediaObjectKey {
  readonly assetId: string
  readonly extension: string
  readonly layout: MediaObjectKeyLayout
  readonly namespace: MediaObjectKeyNamespace
  /** 旧布局没有环境段与池段：解析结果为 null，由调用方按「共桶之前的本环境对象」处理。 */
  readonly pool: string | null
  readonly storageEnvironment: string | null
}

/**
 * 解析 assets/ 与 trash/ 下的对象键，同时接受新旧两种布局；无法映射时返回 null。
 *
 * 段数是唯一判别依据（4 = 旧布局，6 = 新布局）：不引入版本前缀，迁移期两种布局长期共存，
 * 迁移工具、对账与回收都依赖这一个解析器，避免各处正则随维护漂移。
 */
export function parseStoredMediaObjectKey(
  key: unknown,
): ParsedStoredMediaObjectKey | null {
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) return null
  if (key.startsWith('/') || key.includes('\\') || key.includes('\0')) return null

  const segments = key.split('/')
  const namespace = segments[0]
  if (!NAMESPACES.includes(namespace as MediaObjectKeyNamespace)) return null

  const structured = segments.length === 6
  const legacy = segments.length === 4
  if (!structured && !legacy) return null

  const year = structured ? segments[3] : segments[1]
  const month = structured ? segments[4] : segments[2]
  const file = structured ? segments[5] : segments[3]
  if (!YEAR_PATTERN.test(year ?? '') || !MONTH_PATTERN.test(month ?? '')) return null

  const split = splitAssetFile(file ?? '')
  if (split === null) return null

  if (legacy) {
    return Object.freeze({
      ...split,
      layout: 'legacy',
      namespace: namespace as MediaObjectKeyNamespace,
      pool: null,
      storageEnvironment: null,
    })
  }

  const environment = segments[1] ?? ''
  const pool = segments[2] ?? ''
  if (!isStorageSegment(environment) || !isStorageSegment(pool)) return null

  return Object.freeze({
    ...split,
    layout: 'structured',
    namespace: namespace as MediaObjectKeyNamespace,
    pool,
    storageEnvironment: environment,
  })
}

/**
 * 该对象是否落在当前环境的可见范围内。
 *
 * 共桶后同一前缀下会有其它环境的对象；旧布局没有环境段，它产生于共桶之前、只可能属于本环境
 * （存量迁移按环境逐个执行，不会把一个环境的旧对象留在另一个环境的库里）。
 */
export function belongsToMediaStorageEnvironment(
  parsed: ParsedStoredMediaObjectKey,
  storageEnvironment: MediaStorageEnvironment,
): boolean {
  return parsed.storageEnvironment === null
    || parsed.storageEnvironment === storageEnvironment
}
