import type { MediaStorageEnvironment } from '../../config/media.config'
import { MediaAssetStatus } from '../../generated/prisma/enums'
import {
  belongsToMediaStorageEnvironment,
  isMediaAssetId,
  parseStoredMediaObjectKey,
} from './media-object-key'
import type {
  MediaStorage,
  MediaStorageInventoryPage,
  MediaStorageNamespace,
} from './media-storage'
import type {
  MediaReconciliationPersistence,
  ObjectKeyMigrationPair,
  ReconciliationAssetRecord,
} from './media-reconciliation.persistence'
import { trashKeyFor } from './media-retention.service'

const DEFAULT_DRY_RUN_MAX_BATCHES = 100

export interface MediaReconciliationDryRunOptions {
  readonly batchSize?: number
  readonly maxBatches?: number
  readonly timeBudgetMs?: number
}

export interface MediaReconciliationIssueCounts {
  readonly checksumMismatch: number
  readonly duplicateLocation: number
  readonly missing: number
  readonly orphanObject: number
  readonly sizeMismatch: number
  readonly unexpectedLocation: number
  readonly unmappableObject: number
}

export interface MediaReconciliationDryRunResult {
  readonly complete: boolean
  readonly databaseScanned: number
  readonly issues: MediaReconciliationIssueCounts
  readonly matched: number
  readonly storageScanned: number
}

interface MutableIssueCounts {
  checksumMismatch: number
  duplicateLocation: number
  missing: number
  orphanObject: number
  sizeMismatch: number
  unexpectedLocation: number
  unmappableObject: number
}

interface DryRunExecutionOptions {
  readonly batchSize: number
  readonly maxBatches?: number
  readonly monotonicNow: () => number
  /** 当前环境的对象键前缀归属；其它环境的对象被整体跳过，不计入任何计数。 */
  readonly storageEnvironment: MediaStorageEnvironment
  readonly timeBudgetMs: number
}

function requireMaximumBatches(value: number | undefined): number {
  const normalized = value ?? DEFAULT_DRY_RUN_MAX_BATCHES
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > 10_000) {
    throw new Error('Media reconciliation maximum batches is invalid')
  }
  return normalized
}

/**
 * staging 键形如 `staging/<assetId>.<randomUuid>.part`，永远在本地磁盘，不含环境段。
 * 按分隔符切分而不使用捕获组：这里只需要「两段都是合法资产标识」这一个事实。
 */
function stagingAssetIdFromKey(key: string): string | null {
  const prefix = 'staging/'
  const suffix = '.part'
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return null

  const parts = key.slice(prefix.length, key.length - suffix.length).split('.')
  if (parts.length !== 2) return null
  const [assetId, randomPart] = parts
  if (!isMediaAssetId(assetId) || !isMediaAssetId(randomPart)) return null
  return (assetId ?? '').toLowerCase()
}

/**
 * 把存储对象映射回资产标识，并区分「属于其它环境」与「无法映射」。
 *
 * 共桶后同一前缀下会出现其它环境的对象：它们必须被整体跳过，既不能计成 orphanObject（数据库里
 * 本就没有它们），也不能计成 unmappableObject（键本身完全合法），否则每个环境的对账都会被邻居
 * 的存量污染。旧布局没有环境段，它产生于共桶之前、只属于本环境。
 */
function classifyStorageObject(
  key: string,
  storageEnvironment: MediaStorageEnvironment,
): 'foreign' | 'unmappable' | { readonly assetId: string } {
  const stagingAssetId = stagingAssetIdFromKey(key)
  if (stagingAssetId !== null) return { assetId: stagingAssetId }

  const parsed = parseStoredMediaObjectKey(key)
  if (parsed === null) return 'unmappable'
  if (!belongsToMediaStorageEnvironment(parsed, storageEnvironment)) return 'foreign'
  return { assetId: parsed.assetId }
}

async function inspectDatabaseRecord(
  storage: MediaStorage,
  record: ReconciliationAssetRecord,
  issues: MutableIssueCounts,
): Promise<'MATCHED' | 'SKIPPED'> {
  if (
    (record.status !== MediaAssetStatus.READY &&
      record.status !== MediaAssetStatus.TRASHED) ||
    record.objectKey === null ||
    record.sizeBytes === null
  ) {
    return 'SKIPPED'
  }
  const trashKey = trashKeyFor(record.objectKey)
  const expectedKey = record.status === MediaAssetStatus.READY
    ? record.objectKey
    : trashKey
  const alternateKey = record.status === MediaAssetStatus.READY
    ? trashKey
    : record.objectKey
  const [expected, alternate] = await Promise.all([
    storage.stat(expectedKey),
    storage.stat(alternateKey),
  ])
  if (expected !== null && alternate !== null) {
    issues.duplicateLocation += 1
    return 'SKIPPED'
  }
  if (expected === null && alternate === null) {
    issues.missing += 1
    return 'SKIPPED'
  }
  const present = expected ?? alternate
  if (present?.sizeBytes !== record.sizeBytes) {
    issues.sizeMismatch += 1
    return 'SKIPPED'
  }
  if (expected === null) {
    issues.unexpectedLocation += 1
    return 'SKIPPED'
  }
  if (
    record.checksumSha256 === null ||
    !/^[0-9a-f]{64}$/u.test(record.checksumSha256)
  ) {
    issues.checksumMismatch += 1
    return 'SKIPPED'
  }
  try {
    const checksum = await storage.checksumSha256(expectedKey)
    if (checksum !== record.checksumSha256) {
      issues.checksumMismatch += 1
      return 'SKIPPED'
    }
  }
  catch {
    // dry run 不输出底层路径或异常；无法完整读取也归入 checksum 不一致计数，且绝不执行修复。
    issues.checksumMismatch += 1
    return 'SKIPPED'
  }
  return 'MATCHED'
}

/**
 * 对象键重命名迁移期：登记过的「对端键」同样算合法位置。
 *
 * 复制阶段完成后旧键与新键会同时存在，改键之后又反过来；只认数据库里当前那一个键，会把同一份内容的
 * 另一半判成 `unexpectedLocation`，让迁移窗口内的告警全部变成噪声。登记表就是这段窗口期的白名单，
 * 阶段 7 删除旧键、回收迁移删表之后，这条放宽自然消失。
 */
/** 把登记键对折成「资产 → 合法键集合」，键与资产标识统一小写后比较。 */
function toAssetMigrationMap(
  pairs: readonly ObjectKeyMigrationPair[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const byAsset = new Map<string, Set<string>>()
  for (const pair of pairs) {
    const assetId = pair.assetId.toLowerCase()
    const keys = byAsset.get(assetId) ?? new Set<string>()
    keys.add(pair.oldKey)
    keys.add(pair.newKey)
    byAsset.set(assetId, keys)
  }
  return byAsset
}

function isRegisteredMigrationLocation(
  assetMigrations: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assetId: string,
  key: string,
): boolean {
  return assetMigrations?.get(assetId.toLowerCase())?.has(key) === true
}

function isExpectedStorageObject(
  namespace: MediaStorageNamespace,
  key: string,
  record: ReconciliationAssetRecord,
  assetMigrations?: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (namespace === 'staging') {
    return record.status === MediaAssetStatus.UPLOADING ||
      record.status === MediaAssetStatus.FAILED
  }
  if (record.objectKey === null) return false
  if (isRegisteredMigrationLocation(assetMigrations, record.id, key)) return true
  if (namespace === 'assets') {
    return key === record.objectKey && (
      record.status === MediaAssetStatus.READY ||
      record.status === MediaAssetStatus.UPLOADING ||
      record.status === MediaAssetStatus.FAILED
    )
  }
  return key === trashKeyFor(record.objectKey) &&
    record.status === MediaAssetStatus.TRASHED
}

async function inspectStoragePage(
  persistence: MediaReconciliationPersistence,
  namespace: MediaStorageNamespace,
  page: MediaStorageInventoryPage,
  issues: MutableIssueCounts,
  storageEnvironment: MediaStorageEnvironment,
  assetMigrations: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<number> {
  const keyedObjects = page.objects.map(object => ({
    classification: classifyStorageObject(object.key, storageEnvironment),
    object,
  }))
  const mappedIds = [...new Set(keyedObjects
    .map(item => (typeof item.classification === 'object' ? item.classification.assetId : null))
    .filter((value): value is string => value !== null))]
  const records = await persistence.readAssetsByIds(mappedIds)
  const recordById = new Map(records.map(record => [record.id.toLowerCase(), record]))
  let matched = 0

  for (const item of keyedObjects) {
    const { classification } = item
    // 其它环境的对象整体跳过：既不是 orphan（本库本就没有它们），也不是 unmappable（键完全合法）。
    if (classification === 'foreign') continue
    if (classification === 'unmappable') {
      issues.unmappableObject += 1
      continue
    }
    const record = recordById.get(classification.assetId)
    if (!record) {
      issues.orphanObject += 1
      continue
    }
    if (isExpectedStorageObject(namespace, item.object.key, record, assetMigrations)) {
      matched += 1
    }
    else {
      issues.unexpectedLocation += 1
    }
  }
  return matched
}

/** dry run 只读数据库和存储，并且只返回低基数计数，不暴露任何资产标识或路径。 */
export async function runMediaReconciliationDryRun(
  persistence: MediaReconciliationPersistence,
  storage: MediaStorage,
  options: DryRunExecutionOptions,
): Promise<MediaReconciliationDryRunResult> {
  const maxBatches = requireMaximumBatches(options.maxBatches)
  const startedAt = options.monotonicNow()
  const issues: MutableIssueCounts = {
    checksumMismatch: 0,
    duplicateLocation: 0,
    missing: 0,
    orphanObject: 0,
    sizeMismatch: 0,
    unexpectedLocation: 0,
    unmappableObject: 0,
  }
  const assetMigrations = toAssetMigrationMap(
    await persistence.readObjectKeyMigrations(),
  )
  let databaseScanned = 0
  let storageScanned = 0
  let matched = 0
  let batches = 0
  let complete = true
  let cursor: string | undefined

  do {
    if (
      batches >= maxBatches ||
      options.monotonicNow() - startedAt >= options.timeBudgetMs
    ) {
      complete = false
      break
    }
    const page = await persistence.listAssets(cursor, options.batchSize)
    batches += 1
    for (const record of page.records) {
      databaseScanned += 1
      const outcome = await inspectDatabaseRecord(storage, record, issues)
      if (outcome === 'MATCHED') matched += 1
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor !== undefined)

  for (const namespace of ['staging', 'assets', 'trash'] as const) {
    let storageCursor: string | undefined
    do {
      if (
        batches >= maxBatches ||
        options.monotonicNow() - startedAt >= options.timeBudgetMs
      ) {
        complete = false
        storageCursor = undefined
        break
      }
      const page = await storage.inventory({
        ...(storageCursor === undefined ? {} : { cursor: storageCursor }),
        limit: options.batchSize,
        namespace,
      })
      batches += 1
      storageScanned += page.objects.length
      matched += await inspectStoragePage(
        persistence,
        namespace,
        page,
        issues,
        options.storageEnvironment,
        assetMigrations,
      )
      storageCursor = page.nextCursor ?? undefined
    } while (storageCursor !== undefined)
    if (!complete) break
  }

  return Object.freeze({
    complete,
    databaseScanned,
    issues: Object.freeze({ ...issues }),
    matched,
    storageScanned,
  })
}
