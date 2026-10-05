import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import { CosObjectClientError, type CosObjectClient } from './cos-object-client'
import {
  MediaMigrationService,
  type MediaMigrationAssetRecord,
} from './media-migration.service'
import {
  type MediaStorage,
  MediaStorageError,
  type MediaStorageHealthResult,
  type MediaStorageInventoryPage,
  type MediaStorageInventoryRequest,
  type ReadableStoredObject,
  type StagingWrite,
  type StoredObjectExpectation,
  type StoredObjectStat,
} from './media-storage'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'
const TRASHED_ASSET_ID = '00000000-0000-4000-8000-000000000322'
const ASSET_KEY = `assets/2026/08/${ASSET_ID}.webp`
const TRASH_KEY = `trash/2026/08/${TRASHED_ASSET_ID}.webp`

function digestOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

class FakeObjectStorage implements MediaStorage {
  readonly files = new Map<string, Buffer>()
  readonly inventoryRequests: MediaStorageInventoryRequest[] = []
  readonly operations: string[] = []
  verifyResult: boolean | undefined

  seed(key: string, contents: string): Buffer {
    const bytes = Buffer.from(contents)
    this.files.set(key, bytes)
    return bytes
  }

  inventory(request: MediaStorageInventoryRequest): Promise<MediaStorageInventoryPage> {
    this.inventoryRequests.push(request)
    const prefix = request.prefix ?? `${request.namespace}/`
    const keys = [...this.files.keys()].filter(key => key.startsWith(prefix)).sort()
    const start = request.cursor === undefined ? 0 : keys.indexOf(request.cursor) + 1
    const page = keys.slice(start, start + request.limit)
    const truncated = start + page.length < keys.length
    return Promise.resolve({
      nextCursor: truncated ? (page.at(-1) ?? null) : null,
      objects: page.map(key => ({
        key,
        modifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        sizeBytes: BigInt(this.files.get(key)!.length),
      })),
    })
  }

  openManagedObject(objectKey: string): Promise<ReadableStoredObject> {
    this.operations.push(`open:${objectKey}`)
    const bytes = this.files.get(objectKey)
    if (bytes === undefined) {
      return Promise.reject(new MediaStorageError('MEDIA_STORAGE_NOT_FOUND'))
    }
    return Promise.resolve({
      contentLength: BigInt(bytes.length),
      modifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      sizeBytes: BigInt(bytes.length),
      stream: Readable.from([bytes]),
    })
  }

  checksumSha256(objectKey: string): Promise<string> {
    this.operations.push(`checksum:${objectKey}`)
    const bytes = this.files.get(objectKey)
    if (bytes === undefined) {
      return Promise.reject(new MediaStorageError('MEDIA_STORAGE_NOT_FOUND'))
    }
    return Promise.resolve(digestOf(bytes))
  }

  verifyStoredObject(
    objectKey: string,
    expected: StoredObjectExpectation,
  ): Promise<boolean> {
    this.operations.push(`verify:${objectKey}`)
    if (this.verifyResult !== undefined) {
      return Promise.resolve(this.verifyResult)
    }
    const bytes = this.files.get(objectKey)
    if (bytes === undefined) return Promise.resolve(false)
    return Promise.resolve(
      BigInt(bytes.length) === expected.sizeBytes &&
        digestOf(bytes) === expected.checksumSha256,
    )
  }

  checkHealth(): Promise<MediaStorageHealthResult> {
    return Promise.resolve({ code: 'MEDIA_STORAGE_READY', status: 'up' })
  }

  createStagingWrite(): Promise<StagingWrite> {
    return Promise.reject(new Error('fake: createStagingWrite is not used'))
  }

  finalize(): Promise<void> {
    return Promise.reject(new Error('fake: finalize is not used'))
  }

  open(): Promise<ReadableStoredObject> {
    return Promise.reject(new Error('fake: open is not used'))
  }

  moveToTrash(): Promise<void> {
    return Promise.reject(new Error('fake: moveToTrash is not used'))
  }

  restoreFromTrash(): Promise<void> {
    return Promise.reject(new Error('fake: restoreFromTrash is not used'))
  }

  purge(): Promise<void> {
    return Promise.reject(new Error('fake: purge is not used'))
  }

  stat(key: string): Promise<StoredObjectStat | null> {
    const bytes = this.files.get(key)
    return Promise.resolve(bytes === undefined
      ? null
      : { modifiedAt: new Date('2026-01-01T00:00:00.000Z'), sizeBytes: BigInt(bytes.length) })
  }

  withStagingValidationSource<T>(): Promise<T> {
    return Promise.reject(new Error('fake: withStagingValidationSource is not used'))
  }
}

class FakeMigrationClient implements CosObjectClient {
  readonly operations: string[] = []
  bucketReachable = true
  uploadFailure: Error | null = null

  constructor(private readonly target: FakeObjectStorage) {}

  putObject(request: {
    readonly contentLength: number
    readonly key: string
    readonly sha256: string
    readonly stream: Readable
  }): Promise<{ readonly crc64: string | null }> {
    this.operations.push(`put:${request.key}`)
    if (this.uploadFailure !== null) return Promise.reject(this.uploadFailure)
    return (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request.stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
      }
      this.target.files.set(request.key, Buffer.concat(chunks))
      return { crc64: null }
    })()
  }

  headBucket(): Promise<void> {
    this.operations.push('headBucket')
    return this.bucketReachable
      ? Promise.resolve()
      : Promise.reject(new CosObjectClientError('COS_CLIENT_UNAVAILABLE'))
  }

  headObject(): Promise<null> {
    return Promise.resolve(null)
  }

  deleteObject(): Promise<void> {
    return Promise.resolve()
  }

  copyObject(): Promise<void> {
    return Promise.resolve()
  }

  listObjects(): Promise<{ nextCursor: null; objects: [] }> {
    return Promise.resolve({ nextCursor: null, objects: [] })
  }

  openObjectStream(): Promise<Readable> {
    return Promise.reject(new Error('fake: openObjectStream is not used'))
  }
}

interface Fixture {
  readonly client: FakeMigrationClient
  readonly records: Map<string, MediaMigrationAssetRecord>
  readonly service: MediaMigrationService
  readonly source: FakeObjectStorage
  readonly target: FakeObjectStorage
}

function createFixture(): Fixture {
  const source = new FakeObjectStorage()
  const target = new FakeObjectStorage()
  const client = new FakeMigrationClient(target)
  const records = new Map<string, MediaMigrationAssetRecord>()
  const service = new MediaMigrationService({
    client,
    lookupAsset: (assetId: string) => Promise.resolve(records.get(assetId) ?? null),
    source,
    target,
  })
  return { client, records, service, source, target }
}

function expectFailureOf(action: () => Promise<unknown>): Promise<void> {
  return action().then(
    () => Promise.reject(new Error('Expected media migration to fail')),
    () => undefined,
  )
}

describe('MediaMigrationService', () => {
  it('previews the work without writing to the bucket', async () => {
    const fixture = createFixture()
    fixture.source.seed(ASSET_KEY, 'asset-bytes')

    await expect(fixture.service.run('preview')).resolves.toEqual({
      copied: 0,
      failed: 0,
      scanned: 1,
      skipped: 0,
    })

    expect(fixture.client.operations.filter(operation => operation.startsWith('put:')))
      .toEqual([])
    expect(fixture.target.files.size).toBe(0)
  })

  it('copies assets and trash objects and verifies each upload', async () => {
    const fixture = createFixture()
    const bytes = fixture.source.seed(ASSET_KEY, 'asset-bytes')
    const trashedBytes = fixture.source.seed(TRASH_KEY, 'trashed-bytes')
    fixture.records.set(ASSET_ID, {
      checksumSha256: digestOf(bytes),
      sizeBytes: BigInt(bytes.length),
    })
    fixture.records.set(TRASHED_ASSET_ID, {
      checksumSha256: digestOf(trashedBytes),
      sizeBytes: BigInt(trashedBytes.length),
    })

    await expect(fixture.service.run('apply')).resolves.toEqual({
      copied: 2,
      failed: 0,
      scanned: 2,
      skipped: 0,
    })

    expect(fixture.target.files.get(ASSET_KEY)?.toString()).toBe('asset-bytes')
    expect(fixture.target.files.get(TRASH_KEY)?.toString()).toBe('trashed-bytes')
    expect(fixture.target.operations).toContain(`verify:${ASSET_KEY}`)
    // 源对象保持不变：本地目录是回滚面，迁移不删除任何东西。
    expect(fixture.source.files.get(ASSET_KEY)?.toString()).toBe('asset-bytes')
  })

  it('skips objects already present and verified in the bucket', async () => {
    const fixture = createFixture()
    const bytes = fixture.source.seed(ASSET_KEY, 'asset-bytes')
    fixture.records.set(ASSET_ID, {
      checksumSha256: digestOf(bytes),
      sizeBytes: BigInt(bytes.length),
    })
    fixture.target.seed(ASSET_KEY, 'asset-bytes')

    await expect(fixture.service.run('apply')).resolves.toEqual({
      copied: 0,
      failed: 0,
      scanned: 1,
      skipped: 1,
    })
    expect(fixture.client.operations.filter(operation => operation.startsWith('put:')))
      .toEqual([])
  })

  it('counts a failure without touching the source when the upload is rejected', async () => {
    const fixture = createFixture()
    const bytes = fixture.source.seed(ASSET_KEY, 'asset-bytes')
    fixture.records.set(ASSET_ID, {
      checksumSha256: digestOf(bytes),
      sizeBytes: BigInt(bytes.length),
    })
    fixture.client.uploadFailure = new CosObjectClientError('COS_CLIENT_UNAVAILABLE')

    await expect(fixture.service.run('apply')).resolves.toEqual({
      copied: 0,
      failed: 1,
      scanned: 1,
      skipped: 0,
    })
    expect(fixture.source.files.has(ASSET_KEY)).toBe(true)
  })

  it('fails the whole run when the bucket is unreachable', async () => {
    const fixture = createFixture()
    fixture.source.seed(ASSET_KEY, 'asset-bytes')
    fixture.client.bucketReachable = false

    await expectFailureOf(() => fixture.service.run('preview'))
  })

  it('counts a failure when the uploaded object cannot be verified', async () => {
    const fixture = createFixture()
    const bytes = fixture.source.seed(ASSET_KEY, 'asset-bytes')
    fixture.records.set(ASSET_ID, {
      checksumSha256: digestOf(bytes),
      sizeBytes: BigInt(bytes.length),
    })
    fixture.target.verifyResult = false

    await expect(fixture.service.run('apply')).resolves.toEqual({
      copied: 0,
      failed: 1,
      scanned: 1,
      skipped: 0,
    })
  })

  it('reuses the database digest and only reads the source for unknown objects', async () => {
    const fixture = createFixture()
    const bytes = fixture.source.seed(ASSET_KEY, 'asset-bytes')
    fixture.records.set(ASSET_ID, {
      checksumSha256: digestOf(bytes),
      sizeBytes: BigInt(bytes.length),
    })
    const orphanKey = 'assets/2026/08/00000000-0000-4000-8000-000000009999.webp'
    fixture.source.seed(orphanKey, 'orphan-bytes')

    await fixture.service.run('apply')

    expect(fixture.source.operations).toContain(`checksum:${orphanKey}`)
    expect(fixture.source.operations).not.toContain(`checksum:${ASSET_KEY}`)
  })

  it('walks every inventory page instead of stopping at the first one', async () => {
    const fixture = createFixture()
    // 501 个对象：恰好超过单页 500，用来证明游标翻页生效。
    for (let index = 0; index < 501; index += 1) {
      const suffix = index.toString().padStart(4, '0')
      fixture.source.seed(
        `assets/2026/08/00000000-0000-4000-8000-000000${suffix.slice(0, 2)}${suffix.slice(2)}.webp`,
        'x',
      )
    }

    const result = await fixture.service.run('preview')

    expect(result.scanned).toBe(501)
    expect(fixture.source.inventoryRequests.map(request => request.cursor))
      .toEqual([undefined, expect.any(String)])
  })
})
