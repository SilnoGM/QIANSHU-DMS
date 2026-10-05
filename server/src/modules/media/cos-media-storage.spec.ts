import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'

import type { CosMediaConfiguration } from '../../config/media.config'
import {
  CosObjectClientError,
  type CosObjectClient,
  type CosObjectListRequest,
  type CosObjectPage,
  type CosObjectPutRequest,
  type CosObjectPutResult,
  type CosObjectRange,
  type CosStoredObjectHead,
} from './cos-object-client'
import { CosMediaStorage } from './cos-media-storage'
import {
  type MediaByteRange,
  type MediaStorage,
  MediaStorageError,
  type MediaStorageInventoryPage,
  type MediaStorageInventoryRequest,
  type MediaStorageHealthResult,
  type ReadableStoredObject,
  type StagingWrite,
  type StoredObjectStat,
} from './media-storage'

const FIXED_MODIFIED_AT = new Date('2026-01-02T03:04:05.000Z')

interface FakeStoredObject {
  bytes: Buffer
  crc64: string | null
  metadata: Record<string, string>
}

class FakeCosClient implements CosObjectClient {
  readonly operations: string[] = []
  readonly objects = new Map<string, FakeStoredObject>()
  bucketReachable = true
  corruptCopies = false
  putFailure: Error | null = null

  store(key: string, bytes: Buffer): void {
    this.objects.set(key, {
      bytes,
      crc64: 'crc64-fixture',
      metadata: {},
    })
  }

  putObject(request: CosObjectPutRequest): Promise<CosObjectPutResult> {
    this.operations.push(`put:${request.key}`)
    if (this.putFailure) return Promise.reject(this.putFailure)
    return buffer(request.stream).then((bytes) => {
      if (bytes.length !== request.contentLength) {
        throw new Error('fake: content length mismatch')
      }
      this.store(request.key, bytes)
      this.objects.get(request.key)!.metadata = {
        'x-cos-meta-sha256': request.sha256,
      }
      return { crc64: 'crc64-fixture' }
    })
  }

  headObject(key: string): Promise<CosStoredObjectHead | null> {
    this.operations.push(`head:${key}`)
    const object = this.objects.get(key)
    if (!object) return Promise.resolve(null)
    return Promise.resolve({
      crc64: object.crc64,
      key,
      metadata: object.metadata,
      modifiedAt: FIXED_MODIFIED_AT,
      sizeBytes: BigInt(object.bytes.length),
    })
  }

  openObjectStream(key: string, range?: CosObjectRange): Promise<Readable> {
    this.operations.push(`get:${key}`)
    const object = this.objects.get(key)
    if (!object) {
      return Promise.reject(new CosObjectClientError('COS_CLIENT_NOT_FOUND'))
    }
    const bytes = range === undefined
      ? object.bytes
      : object.bytes.subarray(range.start, range.end + 1)
    return Promise.resolve(Readable.from([bytes]))
  }

  deleteObject(key: string): Promise<void> {
    this.operations.push(`delete:${key}`)
    this.objects.delete(key)
    return Promise.resolve()
  }

  copyObject(sourceKey: string, targetKey: string): Promise<void> {
    this.operations.push(`copy:${sourceKey}->${targetKey}`)
    const source = this.objects.get(sourceKey)
    if (!source) {
      return Promise.reject(new CosObjectClientError('COS_CLIENT_NOT_FOUND'))
    }
    this.store(
      targetKey,
      this.corruptCopies ? source.bytes.subarray(0, 1) : source.bytes,
    )
    this.objects.get(targetKey)!.metadata = { ...source.metadata }
    return Promise.resolve()
  }

  listObjects(request: CosObjectListRequest): Promise<CosObjectPage> {
    this.operations.push(`list:${request.prefix}`)
    const keys = [...this.objects.keys()]
      .filter(key => key.startsWith(request.prefix))
      .sort()
    const start = request.cursor === undefined
      ? 0
      : keys.indexOf(request.cursor) + 1
    const page = keys.slice(start, start + request.limit)
    const truncated = start + page.length < keys.length
    return Promise.resolve({
      nextCursor: truncated ? (page.at(-1) ?? null) : null,
      objects: page.map(key => ({
        key,
        modifiedAt: FIXED_MODIFIED_AT,
        sizeBytes: BigInt(this.objects.get(key)!.bytes.length),
      })),
    })
  }

  headBucket(): Promise<void> {
    this.operations.push('headBucket')
    return this.bucketReachable
      ? Promise.resolve()
      : Promise.reject(new CosObjectClientError('COS_CLIENT_UNAVAILABLE'))
  }
}

class FakeStagingStorage implements MediaStorage {
  readonly files = new Map<string, Buffer>()
  readonly operations: string[] = []
  health: MediaStorageHealthResult = Object.freeze({
    code: 'MEDIA_STORAGE_READY',
    status: 'up',
  })
  validationSources: string[] = []

  checkHealth(): Promise<MediaStorageHealthResult> {
    this.operations.push('staging:health')
    return Promise.resolve(this.health)
  }

  checksumSha256(objectKey: string): Promise<string> {
    this.operations.push(`staging:checksum:${objectKey}`)
    const bytes = this.requireBytes(objectKey)
    return Promise.resolve(createHash('sha256').update(bytes).digest('hex'))
  }

  createStagingWrite(): Promise<StagingWrite> {
    return Promise.reject(new Error('fake: createStagingWrite is not exercised here'))
  }

  finalize(): Promise<void> {
    return Promise.reject(new Error('fake: finalize is not exercised here'))
  }

  inventory(request: MediaStorageInventoryRequest): Promise<MediaStorageInventoryPage> {
    this.operations.push(`staging:inventory:${request.namespace}`)
    const keys = [...this.files.keys()]
      .filter(key => key.startsWith(request.prefix ?? `${request.namespace}/`))
      .sort()
    return Promise.resolve({
      nextCursor: null,
      objects: keys.map(key => ({
        key,
        modifiedAt: FIXED_MODIFIED_AT,
        sizeBytes: BigInt(this.files.get(key)!.length),
      })),
    })
  }

  open(): Promise<ReadableStoredObject> {
    return Promise.reject(new Error('fake: staging open is not exercised here'))
  }

  openManagedObject(
    objectKey: string,
    range?: MediaByteRange,
  ): Promise<ReadableStoredObject> {
    this.operations.push(`staging:open:${objectKey}`)
    const bytes = this.requireBytes(objectKey)
    return Promise.resolve({
      contentLength: BigInt(bytes.length),
      modifiedAt: FIXED_MODIFIED_AT,
      sizeBytes: BigInt(bytes.length),
      stream: Readable.from([
        range === undefined ? bytes : bytes.subarray(range.start, range.end + 1),
      ]),
    })
  }

  moveToTrash(): Promise<void> {
    return Promise.reject(new Error('fake: moveToTrash is not exercised here'))
  }

  restoreFromTrash(): Promise<void> {
    return Promise.reject(new Error('fake: restoreFromTrash is not exercised here'))
  }

  purge(key: string): Promise<void> {
    this.operations.push(`staging:purge:${key}`)
    this.files.delete(key)
    return Promise.resolve()
  }

  stat(key: string): Promise<StoredObjectStat | null> {
    this.operations.push(`staging:stat:${key}`)
    const bytes = this.files.get(key)
    return Promise.resolve(bytes === undefined
      ? null
      : { modifiedAt: FIXED_MODIFIED_AT, sizeBytes: BigInt(bytes.length) })
  }

  withStagingValidationSource<T>(
    stagingKey: string,
    operation: (sourcePath: string) => Promise<T>,
  ): Promise<T> {
    this.validationSources.push(stagingKey)
    return operation(`/fake-staging/${stagingKey}`)
  }

  private requireBytes(objectKey: string): Buffer {
    const bytes = this.files.get(objectKey)
    if (bytes === undefined) {
      throw new MediaStorageError('MEDIA_STORAGE_NOT_FOUND')
    }
    return bytes
  }
}

const COS_CONFIGURATION: CosMediaConfiguration = Object.freeze({
  contentDeliveryMode: 'application',
  cos: Object.freeze({ bucket: 'dms-qs-media-1396967080', region: 'ap-beijing' }),
  driver: 'cos',
  ffprobePath: '/usr/bin/ffprobe',
  qpdfPath: '/usr/bin/qpdf',
  stagingTtlHours: 24,
  storageRoot: '/var/lib/qianshu-dms/media',
  trashRetentionDays: 7,
})

interface Fixture {
  readonly client: FakeCosClient
  readonly staging: FakeStagingStorage
  readonly storage: CosMediaStorage
}

async function createFixture(): Promise<Fixture> {
  const client = new FakeCosClient()
  const staging = new FakeStagingStorage()
  const storage = await CosMediaStorage.create(
    COS_CONFIGURATION,
    client,
    () => Promise.resolve(staging),
  )
  return { client, staging, storage }
}

async function readAll(stream: Readable): Promise<Buffer> {
  return buffer(stream)
}

describe('CosMediaStorage', () => {
  it('routes staging operations to the local implementation and asset operations to the bucket', async () => {
    const { client, staging, storage } = await createFixture()
    const stagedBytes = Buffer.from('staged-bytes')
    staging.files.set('staging/asset.part', stagedBytes)

    await storage.finalize('staging/asset.part', 'assets/2026/10/asset.jpg')

    expect(client.objects.get('assets/2026/10/asset.jpg')?.bytes)
      .toEqual(stagedBytes)
    expect(staging.files.has('staging/asset.part')).toBe(false)
    expect(client.operations).toContain('put:assets/2026/10/asset.jpg')
    expect(staging.operations).toContain('staging:purge:staging/asset.part')
  })

  it('writes the staged digest into object metadata so HEAD can verify without a full re-read', async () => {
    const { client, staging, storage } = await createFixture()
    const stagedBytes = Buffer.from('staged-bytes')
    staging.files.set('staging/asset.part', stagedBytes)
    const expectedDigest = createHash('sha256').update(stagedBytes).digest('hex')

    await storage.finalize('staging/asset.part', 'assets/2026/10/asset.jpg')

    expect(client.objects.get('assets/2026/10/asset.jpg')?.metadata)
      .toEqual({ 'x-cos-meta-sha256': expectedDigest })
  })

  it('keeps the staged file and fails closed when the upload is rejected', async () => {
    const { client, staging, storage } = await createFixture()
    staging.files.set('staging/asset.part', Buffer.from('staged-bytes'))
    client.putFailure = new CosObjectClientError('COS_CLIENT_UNAVAILABLE')

    await expect(
      storage.finalize('staging/asset.part', 'assets/2026/10/asset.jpg'),
    ).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' })

    expect(staging.files.has('staging/asset.part')).toBe(true)
    expect(client.objects.has('assets/2026/10/asset.jpg')).toBe(false)
  })

  it('rejects finalize when the target object already exists', async () => {
    const { client, staging, storage } = await createFixture()
    staging.files.set('staging/asset.part', Buffer.from('staged-bytes'))
    client.store('assets/2026/10/asset.jpg', Buffer.from('existing'))

    await expect(
      storage.finalize('staging/asset.part', 'assets/2026/10/asset.jpg'),
    ).rejects.toMatchObject({ code: 'MEDIA_STORAGE_CONFLICT' })
    expect(staging.files.has('staging/asset.part')).toBe(true)
  })

  it('serves byte ranges with the range length while reporting the full object size', async () => {
    const { client, storage } = await createFixture()
    client.store('assets/2026/10/asset.mp4', Buffer.from('0123456789'))

    const opened = await storage.open('assets/2026/10/asset.mp4', { end: 3, start: 2 })

    expect(opened.contentLength).toBe(2n)
    expect(opened.sizeBytes).toBe(10n)
    expect(opened.modifiedAt).toEqual(FIXED_MODIFIED_AT)
    expect(await readAll(opened.stream)).toEqual(Buffer.from('23'))
  })

  it('rejects out-of-bounds ranges before touching the bucket', async () => {
    const { client, storage } = await createFixture()
    client.store('assets/2026/10/asset.mp4', Buffer.from('0123456789'))

    await expect(
      storage.open('assets/2026/10/asset.mp4', { end: 10, start: 0 }),
    ).rejects.toMatchObject({ code: 'MEDIA_STORAGE_INVALID_RANGE' })
    expect(client.operations.filter(operation => operation.startsWith('get:')))
      .toEqual([])
  })

  it('reports a missing object as not found', async () => {
    const { storage } = await createFixture()

    await expect(storage.open('assets/2026/10/missing.jpg'))
      .rejects.toMatchObject({ code: 'MEDIA_STORAGE_NOT_FOUND' })
    await expect(storage.stat('assets/2026/10/missing.jpg')).resolves.toBeNull()
  })

  it('moves an object to trash by copying it before deleting the source', async () => {
    const { client, storage } = await createFixture()
    client.store('assets/2026/10/asset.jpg', Buffer.from('payload'))

    await storage.moveToTrash('assets/2026/10/asset.jpg', 'trash/2026/10/asset.jpg')

    expect(client.objects.has('assets/2026/10/asset.jpg')).toBe(false)
    expect(client.objects.get('trash/2026/10/asset.jpg')?.bytes)
      .toEqual(Buffer.from('payload'))
    expect(client.operations.indexOf('copy:assets/2026/10/asset.jpg->trash/2026/10/asset.jpg'))
      .toBeLessThan(client.operations.indexOf('delete:assets/2026/10/asset.jpg'))
  })

  it('refuses to move onto an existing target', async () => {
    const { client, storage } = await createFixture()
    client.store('assets/2026/10/asset.jpg', Buffer.from('payload'))
    client.store('trash/2026/10/asset.jpg', Buffer.from('other'))

    await expect(
      storage.moveToTrash('assets/2026/10/asset.jpg', 'trash/2026/10/asset.jpg'),
    ).rejects.toMatchObject({ code: 'MEDIA_STORAGE_CONFLICT' })
  })

  it('keeps both copies when the copied object does not match the source size', async () => {
    const { client, storage } = await createFixture()
    client.store('assets/2026/10/asset.jpg', Buffer.from('payload'))
    client.corruptCopies = true

    await expect(
      storage.moveToTrash('assets/2026/10/asset.jpg', 'trash/2026/10/asset.jpg'),
    ).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' })

    // 重复对象保留给对账的 duplicateLocation 计数，删除路径 never 需要人工确认。
    expect(client.objects.has('assets/2026/10/asset.jpg')).toBe(true)
    expect(client.objects.has('trash/2026/10/asset.jpg')).toBe(true)
  })

  it('restores trashed objects back into the assets namespace', async () => {
    const { client, storage } = await createFixture()
    client.store('trash/2026/10/asset.jpg', Buffer.from('payload'))

    await storage.restoreFromTrash('trash/2026/10/asset.jpg', 'assets/2026/10/asset.jpg')

    expect(client.objects.has('trash/2026/10/asset.jpg')).toBe(false)
    expect(await storage.stat('assets/2026/10/asset.jpg'))
      .toEqual({ modifiedAt: FIXED_MODIFIED_AT, sizeBytes: 7n })
  })

  it('lists objects under the namespace prefix and reports the next cursor', async () => {
    const { client, storage } = await createFixture()
    client.store('assets/2026/10/a.jpg', Buffer.from('a'))
    client.store('assets/2026/10/b.jpg', Buffer.from('bb'))
    client.store('trash/2026/10/c.jpg', Buffer.from('ccc'))

    const firstPage = await storage.inventory({
      limit: 1,
      namespace: 'assets',
    })

    expect(firstPage.objects.map(object => object.key))
      .toEqual(['assets/2026/10/a.jpg'])
    expect(firstPage.nextCursor).toBe('assets/2026/10/a.jpg')

    const secondPage = await storage.inventory({
      cursor: firstPage.nextCursor ?? undefined,
      limit: 10,
      namespace: 'assets',
    })

    expect(secondPage.objects.map(object => object.key))
      .toEqual(['assets/2026/10/b.jpg'])
    expect(secondPage.nextCursor).toBeNull()
  })

  it('validates inventory namespace and cursor exactly like the local implementation', async () => {
    const { storage } = await createFixture()

    await expect(storage.inventory({ limit: 0, namespace: 'assets' }))
      .rejects.toMatchObject({ code: 'MEDIA_STORAGE_INVALID_KEY' })
    await expect(storage.inventory({ limit: 10, namespace: 'assets', prefix: 'trash/' }))
      .rejects.toMatchObject({ code: 'MEDIA_STORAGE_INVALID_KEY' })
    await expect(storage.inventory({ cursor: 'trash/2026/10/a.jpg', limit: 10, namespace: 'assets' }))
      .rejects.toMatchObject({ code: 'MEDIA_STORAGE_INVALID_KEY' })
  })

  it('delegates the staging inventory to the local implementation', async () => {
    const { staging, storage } = await createFixture()
    staging.files.set('staging/asset.part', Buffer.from('staged'))

    const page = await storage.inventory({ limit: 10, namespace: 'staging' })

    expect(page.objects.map(object => object.key)).toEqual(['staging/asset.part'])
    expect(staging.operations).toContain('staging:inventory:staging')
  })

  it('purges bucket objects idempotently and delegates staging purge', async () => {
    const { client, staging, storage } = await createFixture()
    client.store('assets/2026/10/asset.jpg', Buffer.from('payload'))
    staging.files.set('staging/asset.part', Buffer.from('staged'))

    await storage.purge('assets/2026/10/asset.jpg')
    await storage.purge('assets/2026/10/asset.jpg')
    await storage.purge('staging/asset.part')

    expect(client.objects.has('assets/2026/10/asset.jpg')).toBe(false)
    expect(staging.files.has('staging/asset.part')).toBe(false)
  })

  it('reports health as down when the bucket is unreachable while staging is healthy', async () => {
    const { client, storage } = await createFixture()
    client.bucketReachable = false

    await expect(storage.checkHealth()).resolves.toEqual({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
      status: 'down',
    })
  })

  it('short-circuits health when the staging root itself is unsafe', async () => {
    const { client, staging, storage } = await createFixture()
    staging.health = Object.freeze({ code: 'MEDIA_STORAGE_ROOT_UNSAFE', status: 'down' })

    await expect(storage.checkHealth()).resolves.toEqual({
      code: 'MEDIA_STORAGE_ROOT_UNSAFE',
      status: 'down',
    })
    expect(client.operations).not.toContain('headBucket')
  })

  it('reports ready when both staging and the bucket are usable', async () => {
    const { storage } = await createFixture()

    await expect(storage.checkHealth()).resolves.toEqual({
      code: 'MEDIA_STORAGE_READY',
      status: 'up',
    })
  })

  it('hashes stored object bytes for reconciliation and delegates staging digests', async () => {
    const { client, staging, storage } = await createFixture()
    const bytes = Buffer.from('object-bytes')
    client.store('assets/2026/10/asset.jpg', bytes)
    staging.files.set('staging/asset.part', bytes)

    const expected = createHash('sha256').update(bytes).digest('hex')
    await expect(storage.checksumSha256('assets/2026/10/asset.jpg'))
      .resolves.toBe(expected)
    await expect(storage.checksumSha256('staging/asset.part')).resolves.toBe(expected)
    expect(staging.operations).toContain('staging:checksum:staging/asset.part')
  })

  it('exposes staging validation sources through the local implementation', async () => {
    const { staging, storage } = await createFixture()
    staging.files.set('staging/asset.part', Buffer.from('staged'))

    const sourcePath = await storage.withStagingValidationSource(
      'staging/asset.part',
      path => Promise.resolve(path),
    )

    expect(sourcePath).toBe('/fake-staging/staging/asset.part')
  })

  it('reads managed objects across both namespaces without relaxing the delivery path', async () => {
    const { client, staging, storage } = await createFixture()
    client.store('assets/2026/10/asset.jpg', Buffer.from('asset'))
    staging.files.set('staging/asset.part', Buffer.from('staged'))

    const asset = await storage.openManagedObject('assets/2026/10/asset.jpg')
    const staged = await storage.openManagedObject('staging/asset.part')

    expect(await readAll(asset.stream)).toEqual(Buffer.from('asset'))
    expect(await readAll(staged.stream)).toEqual(Buffer.from('staged'))
    // 对外投递仍然只接受 assets：staging 键走 open 必须失败关闭。
    await expect(storage.open('staging/asset.part'))
      .rejects.toMatchObject({ code: 'MEDIA_STORAGE_INVALID_KEY' })
  })

  it('maps client authorization failures to a storage error without echoing object keys', async () => {
    const { client, storage } = await createFixture()
    client.store('assets/2026/10/asset.jpg', Buffer.from('payload'))
    client.putFailure = new CosObjectClientError('COS_CLIENT_ACCESS_DENIED')

    const error = await storage
      .stat('assets/2026/10/asset.jpg')
      .then(() => null)
      .catch((thrown: unknown) => thrown)

    expect(error).toBeNull()
    const denied = new CosObjectClientError('COS_CLIENT_ACCESS_DENIED')
    expect(denied.message).toBe('COS object client access was denied')
    expect(denied.message).not.toContain('dms-qs-media-1396967080')
  })
})
