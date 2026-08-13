import type { Readable, Writable } from 'node:stream'

export type MediaStorageErrorCode =
  | 'MEDIA_STORAGE_CONFLICT'
  | 'MEDIA_STORAGE_FILESYSTEM_MISMATCH'
  | 'MEDIA_STORAGE_INSUFFICIENT_SPACE'
  | 'MEDIA_STORAGE_INVALID_ASSET_ID'
  | 'MEDIA_STORAGE_INVALID_KEY'
  | 'MEDIA_STORAGE_INVALID_RANGE'
  | 'MEDIA_STORAGE_NOT_FOUND'
  | 'MEDIA_STORAGE_PATH_UNSAFE'
  | 'MEDIA_STORAGE_ROOT_UNSAFE'
  | 'MEDIA_STORAGE_UNAVAILABLE'

const MEDIA_STORAGE_ERROR_MESSAGES: Readonly<Record<MediaStorageErrorCode, string>> = {
  MEDIA_STORAGE_CONFLICT: 'Media storage target already exists',
  MEDIA_STORAGE_FILESYSTEM_MISMATCH: 'Media storage filesystem mismatch',
  MEDIA_STORAGE_INSUFFICIENT_SPACE: 'Media storage capacity is insufficient',
  MEDIA_STORAGE_INVALID_ASSET_ID: 'Media storage asset identifier is invalid',
  MEDIA_STORAGE_INVALID_KEY: 'Media storage object key is invalid',
  MEDIA_STORAGE_INVALID_RANGE: 'Media storage byte range is invalid',
  MEDIA_STORAGE_NOT_FOUND: 'Media storage object was not found',
  MEDIA_STORAGE_PATH_UNSAFE: 'Media storage path is unsafe',
  MEDIA_STORAGE_ROOT_UNSAFE: 'Media storage root is unsafe',
  MEDIA_STORAGE_UNAVAILABLE: 'Media storage is unavailable',
}

/**
 * Storage 边界只暴露固定错误码和固定消息。
 *
 * 不保留底层 cause，避免上层日志或异常序列化意外泄露绝对路径、文件名和操作系统详情。
 */
export class MediaStorageError extends Error {
  readonly code: MediaStorageErrorCode

  constructor(code: MediaStorageErrorCode) {
    super(MEDIA_STORAGE_ERROR_MESSAGES[code])
    this.name = 'MediaStorageError'
    this.code = code
  }
}

export interface MediaByteRange {
  readonly start: number
  readonly end: number
}

export interface MediaStorageHealthResult {
  readonly status: 'up' | 'down'
  readonly code:
    | 'MEDIA_STORAGE_FILESYSTEM_MISMATCH'
    | 'MEDIA_STORAGE_INSUFFICIENT_SPACE'
    | 'MEDIA_STORAGE_READY'
    | 'MEDIA_STORAGE_ROOT_UNSAFE'
    | 'MEDIA_STORAGE_UNAVAILABLE'
}

export interface StoredObjectStat {
  readonly modifiedAt: Date
  readonly sizeBytes: bigint
}

export interface ReadableStoredObject extends StoredObjectStat {
  readonly contentLength: bigint
  readonly stream: Readable
}

export interface StagingWrite {
  readonly key: string
  readonly stream: Writable
  cancel(): Promise<void>
}

export interface MediaStorage {
  checkHealth(minimumFreeBytes?: bigint): Promise<MediaStorageHealthResult>
  createStagingWrite(assetId: string): Promise<StagingWrite>
  finalize(stagingKey: string, objectKey: string): Promise<void>
  open(objectKey: string, range?: MediaByteRange): Promise<ReadableStoredObject>
  moveToTrash(objectKey: string, trashKey: string): Promise<void>
  restoreFromTrash(trashKey: string, objectKey: string): Promise<void>
  purge(key: string): Promise<void>
  stat(key: string): Promise<StoredObjectStat | null>
}

const OBJECT_KEY_PATTERN = /^[A-Za-z0-9._/-]+$/u
const MAX_OBJECT_KEY_LENGTH = 512

/**
 * Object key 使用 POSIX `/`，且必须已经是 canonical 相对标识。
 *
 * 这里选择“拒绝后再返回原值”而不是静默修正，避免 `a/../b` 等攻击输入在不同层被解释成同一对象。
 */
export function normalizeMediaObjectKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_OBJECT_KEY_LENGTH ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    !OBJECT_KEY_PATTERN.test(value)
  ) {
    throw new MediaStorageError('MEDIA_STORAGE_INVALID_KEY')
  }

  const segments = value.split('/')
  if (
    segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new MediaStorageError('MEDIA_STORAGE_INVALID_KEY')
  }

  return value
}

export function requireMediaObjectKeyNamespace(
  value: unknown,
  namespace: 'assets' | 'staging' | 'trash',
): string {
  const normalized = normalizeMediaObjectKey(value)
  if (!normalized.startsWith(`${namespace}/`)) {
    throw new MediaStorageError('MEDIA_STORAGE_INVALID_KEY')
  }
  return normalized
}
