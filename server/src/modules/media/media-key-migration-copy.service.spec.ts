import { Readable } from 'node:stream'

import {
  MediaKeyMigrationCopyService,
  type MediaKeyMigrationCopyClient,
  type MediaKeyMigrationCopyDependencies,
  type MediaKeyMigrationCopyResult,
  type MediaKeyMigrationCopySource,
  type MediaKeyMigrationCopyTarget,
} from './media-key-migration-copy.service'
import type { MediaKeyMigrationCandidate } from './media-key-migration.service'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'
const OTHER_ASSET_ID = '00000000-0000-4000-8000-000000000322'
const CHECKSUM = 'a'.repeat(64)
const SIZE_BYTES = 321n
const OLD_KEY = `assets/2026/08/${ASSET_ID}.webp`
const NEW_KEY = `assets/prod/product/2026/08/${ASSET_ID}.webp`
const OTHER_OLD_KEY = `assets/2026/08/${OTHER_ASSET_ID}.webp`
const OTHER_NEW_KEY = `assets/prod/product/2026/08/${OTHER_ASSET_ID}.webp`

interface PutRequest {
  readonly contentLength: number
  readonly key: string
  readonly sha256: string
  readonly stream: Readable
}

/** 源端：只有旧键上有字节；对象被读走后仍然留在桶里（复制不删源）。 */
class FakeSource implements MediaKeyMigrationCopySource {
  readonly objects = new Map<string, bigint>()
  readonly opened: string[] = []

  openManagedObject(key: string): Promise<{ readonly sizeBytes: bigint, readonly stream: Readable }> {
    this.opened.push(key)
    const sizeBytes = this.objects.get(key)
    if (sizeBytes === undefined) {
      return Promise.reject(new Error('source object is missing'))
    }
    // 流出的字节数与声明的长度一致：复核阶段比对的正是这个长度。
    return Promise.resolve({
      sizeBytes,
      stream: Readable.from([Buffer.alloc(Number(sizeBytes))]),
    })
  }
}

/** 目标端：`objects` 是桶里已存在的对象；`verified` 控制校验结论，`verifyFailure` 模拟不可达。 */
class FakeTarget implements MediaKeyMigrationCopyTarget {
  readonly objects = new Map<string, bigint>()
  readonly verifications: string[] = []
  verifyFailure: Error | null = null
  verifyResult: boolean | null = null

  stat(key: string): Promise<{ readonly sizeBytes: bigint } | null> {
    const sizeBytes = this.objects.get(key)
    return Promise.resolve(sizeBytes === undefined ? null : { sizeBytes })
  }

  verifyStoredObject(
    key: string,
    expected: { readonly checksumSha256: string, readonly sizeBytes: bigint },
  ): Promise<boolean> {
    this.verifications.push(key)
    if (this.verifyFailure !== null) return Promise.reject(this.verifyFailure)
    if (this.verifyResult !== null) return Promise.resolve(this.verifyResult)
    return Promise.resolve(this.objects.get(key) === expected.sizeBytes)
  }
}

/** 上传端口：把字节写进目标端，便于后续校验拿到真实长度。 */
class FakeClient implements MediaKeyMigrationCopyClient {
  readonly puts: PutRequest[] = []
  failure: Error | null = null
  failOnce = false

  putObject(request: PutRequest): Promise<unknown> {
    this.puts.push(request)
    if (this.failure !== null) return Promise.reject(this.failure)
    if (this.failOnce) {
      this.failOnce = false
      return Promise.reject(new Error('upload rejected'))
    }
    return (async () => {
      let total = 0
      for await (const chunk of request.stream) {
        total += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk as string)
      }
      this.target.objects.set(request.key, BigInt(total))
      return undefined
    })()
  }

  constructor(private readonly target: FakeTarget) {}
}

interface Fixture {
  readonly client: FakeClient
  readonly service: MediaKeyMigrationCopyService
  readonly source: FakeSource
  readonly target: FakeTarget
}

function createFixture(): Fixture {
  const source = new FakeSource()
  const target = new FakeTarget()
  const client = new FakeClient(target)
  const dependencies: MediaKeyMigrationCopyDependencies = { client, source, target }
  return { client, service: new MediaKeyMigrationCopyService(dependencies), source, target }
}

function candidate(
  assetId: string,
  oldKey: string,
  newKey: string,
): MediaKeyMigrationCandidate {
  return { assetId, checksumSha256: CHECKSUM, newKey, oldKey, sizeBytes: SIZE_BYTES }
}

describe('MediaKeyMigrationCopyService.copyBatch', () => {
  it('skips a candidate whose target object already passes verification', async () => {
    const fixture = createFixture()
    fixture.source.objects.set(OLD_KEY, SIZE_BYTES)
    fixture.target.objects.set(NEW_KEY, SIZE_BYTES)

    await expect(fixture.service.copyBatch([candidate(ASSET_ID, OLD_KEY, NEW_KEY)]))
      .resolves.toEqual({ copied: 0, failed: 0, skipped: 1 })

    expect(fixture.target.verifications).toContain(NEW_KEY)
    expect(fixture.client.puts).toEqual([])
    expect(fixture.source.opened).toEqual([])
  })

  it('copies a missing target from the old key and verifies the uploaded object', async () => {
    const fixture = createFixture()
    fixture.source.objects.set(OLD_KEY, SIZE_BYTES)

    await expect(fixture.service.copyBatch([candidate(ASSET_ID, OLD_KEY, NEW_KEY)]))
      .resolves.toEqual({ copied: 1, failed: 0, skipped: 0 })

    expect(fixture.source.opened).toEqual([OLD_KEY])
    expect(fixture.client.puts.map(put => ({
      contentLength: put.contentLength,
      key: put.key,
      sha256: put.sha256,
    }))).toEqual([{
      contentLength: Number(SIZE_BYTES),
      key: NEW_KEY,
      sha256: CHECKSUM,
    }])
    // 上传后立即复核：校验请求必须带数据库记录的摘要与长度。
    expect(fixture.target.verifications).toContain(NEW_KEY)
    expect(fixture.target.objects.get(NEW_KEY)).toBe(SIZE_BYTES)
    // 源对象保持不动：改键之前它是唯一的回滚面。
    expect(fixture.source.objects.get(OLD_KEY)).toBe(SIZE_BYTES)
  })

  it('counts a failed verification after upload and keeps the source object', async () => {
    const fixture = createFixture()
    fixture.source.objects.set(OLD_KEY, SIZE_BYTES)
    fixture.target.verifyResult = false

    await expect(fixture.service.copyBatch([candidate(ASSET_ID, OLD_KEY, NEW_KEY)]))
      .resolves.toEqual({ copied: 0, failed: 1, skipped: 0 })

    expect(fixture.client.puts).toHaveLength(1)
    expect(fixture.source.objects.has(OLD_KEY)).toBe(true)
  })

  it('counts a failing upload and keeps copying the remaining candidates', async () => {
    const fixture = createFixture()
    fixture.source.objects.set(OLD_KEY, SIZE_BYTES)
    fixture.source.objects.set(OTHER_OLD_KEY, SIZE_BYTES)
    fixture.client.failOnce = true

    await expect(fixture.service.copyBatch([
      candidate(ASSET_ID, OLD_KEY, NEW_KEY),
      candidate(OTHER_ASSET_ID, OTHER_OLD_KEY, OTHER_NEW_KEY),
    ])).resolves.toEqual({ copied: 1, failed: 1, skipped: 0 })

    expect(fixture.client.puts.map(put => put.key)).toEqual([NEW_KEY, OTHER_NEW_KEY])
    expect(fixture.target.objects.has(OTHER_NEW_KEY)).toBe(true)
    expect(fixture.source.objects.has(OLD_KEY)).toBe(true)
  })

  it('counts an unreachable target as a failure instead of treating it as not copied', async () => {
    const fixture = createFixture()
    fixture.source.objects.set(OLD_KEY, SIZE_BYTES)
    fixture.target.objects.set(NEW_KEY, SIZE_BYTES)
    fixture.target.verifyFailure = new Error('storage unavailable')

    await expect(fixture.service.copyBatch([candidate(ASSET_ID, OLD_KEY, NEW_KEY)]))
      .resolves.toEqual({ copied: 0, failed: 1, skipped: 0 })

    expect(fixture.client.puts).toEqual([])
  })

  it('refuses to copy a candidate whose checksum or size is unknown', async () => {
    const fixture = createFixture()
    fixture.source.objects.set(OLD_KEY, SIZE_BYTES)

    await expect(fixture.service.copyBatch([{
      assetId: ASSET_ID,
      checksumSha256: null,
      newKey: NEW_KEY,
      oldKey: OLD_KEY,
      sizeBytes: null,
    }])).resolves.toEqual<MediaKeyMigrationCopyResult>({
      copied: 0,
      failed: 1,
      skipped: 0,
    })
    expect(fixture.client.puts).toEqual([])
    expect(fixture.source.opened).toEqual([])
  })
})
