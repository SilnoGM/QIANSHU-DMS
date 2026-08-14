import { MediaAssetStatus } from '../../generated/prisma/enums'
import type {
  MediaStorage,
  MediaStorageInventoryPage,
  MediaStorageNamespace,
} from './media-storage'
import type {
  MediaReconciliationPersistence,
  ReconciliationAssetRecord,
} from './media-reconciliation.persistence'
import { trashKeyFor } from './media-retention.service'

const DEFAULT_DRY_RUN_MAX_BATCHES = 100
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const STAGING_ASSET_PATTERN = new RegExp(
  `^staging/(${UUID_PATTERN})\\.${UUID_PATTERN}\\.part$`,
  'iu',
)
const STORED_ASSET_PATTERN = new RegExp(
  `^(?:assets|trash)/[0-9]{4}/[0-9]{2}/(${UUID_PATTERN})\\.[a-z0-9]+$`,
  'iu',
)

export interface MediaReconciliationDryRunOptions {
  readonly batchSize?: number
  readonly maxBatches?: number
  readonly timeBudgetMs?: number
}

export interface MediaReconciliationIssueCounts {
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
  readonly timeBudgetMs: number
}

function requireMaximumBatches(value: number | undefined): number {
  const normalized = value ?? DEFAULT_DRY_RUN_MAX_BATCHES
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > 10_000) {
    throw new Error('Media reconciliation maximum batches is invalid')
  }
  return normalized
}

function assetIdFromKey(key: string): string | null {
  return STAGING_ASSET_PATTERN.exec(key)?.[1]?.toLowerCase() ??
    STORED_ASSET_PATTERN.exec(key)?.[1]?.toLowerCase() ??
    null
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
  return 'MATCHED'
}

function isExpectedStorageObject(
  namespace: MediaStorageNamespace,
  key: string,
  record: ReconciliationAssetRecord,
): boolean {
  if (namespace === 'staging') {
    return record.status === MediaAssetStatus.UPLOADING ||
      record.status === MediaAssetStatus.FAILED
  }
  if (record.objectKey === null) return false
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
): Promise<number> {
  const keyedObjects = page.objects.map(object => ({
    assetId: assetIdFromKey(object.key),
    object,
  }))
  const mappedIds = [...new Set(keyedObjects
    .map(item => item.assetId)
    .filter((value): value is string => value !== null))]
  const records = await persistence.readAssetsByIds(mappedIds)
  const recordById = new Map(records.map(record => [record.id.toLowerCase(), record]))
  let matched = 0

  for (const item of keyedObjects) {
    if (item.assetId === null) {
      issues.unmappableObject += 1
      continue
    }
    const record = recordById.get(item.assetId)
    if (!record) {
      issues.orphanObject += 1
      continue
    }
    if (isExpectedStorageObject(namespace, item.object.key, record)) {
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
    duplicateLocation: 0,
    missing: 0,
    orphanObject: 0,
    sizeMismatch: 0,
    unexpectedLocation: 0,
    unmappableObject: 0,
  }
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
      matched += await inspectStoragePage(persistence, namespace, page, issues)
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
