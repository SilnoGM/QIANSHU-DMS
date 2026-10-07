import { createHash } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'
import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'
import type { Prisma } from '../../generated/prisma/client'
import { MediaType } from '../../generated/prisma/enums'
import type { MediaConfiguration } from '../../config/media.config'
import { PRODUCT_MEDIA_ALLOWED_TYPES } from '../products/media/product-media.policy'
import type { MediaStorage, StagingWrite } from './media-storage'
import { MediaStorageError } from './media-storage'
import type { MediaStoragePool } from './media-object-key'
import type { MediaContentValidator } from './media-content-validator'
import { MediaValidationError } from './media-validation'
import type { MediaAssetPersistence } from './media-asset.persistence'
import type { PreparedMediaAssetPersistenceInput } from './media-asset.persistence'
import {
  MediaAssetLifecycleError,
  MediaAssetService,
} from './media-asset.service'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'
const ACTOR_ID = '00000000-0000-4000-8000-000000000654'
const NOW = new Date('2026-08-13T08:09:10.000Z')
const STAGING_KEY = `staging/${ASSET_ID}.00000000-0000-4000-8000-000000000777.part`

interface Fixture {
  readonly activate: jest.Mock
  readonly cancel: jest.Mock
  readonly createUploading: jest.Mock
  readonly failUploading: jest.Mock
  readonly finalize: jest.Mock
  readonly markPrepared: jest.Mock
  readonly persistence: MediaAssetPersistence
  readonly purge: jest.Mock
  readonly service: MediaAssetService
  readonly storage: MediaStorage
  readonly validate: jest.Mock
  readonly verifyStoredObject: jest.Mock
  readonly withStagingValidationSource: jest.Mock
}

function configuration(): MediaConfiguration {
  return {
    contentDeliveryMode: 'application',
    driver: 'local',
    ffprobePath: '/usr/bin/ffprobe',
    qpdfPath: '/usr/bin/qpdf',
    stagingTtlHours: 24,
    storageEnvironment: 'dev',
    storageRoot: '/var/lib/qianshu-dms/media',
    trashRetentionDays: 7,
  }
}

function writableSink(): Writable {
  return new NodeWritable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
}

function createFixture(options: {
  readonly finalContents?: Buffer
  readonly markPrepared?: boolean
  readonly statSize?: bigint | null
} = {}): Fixture {
  const cancel = jest.fn().mockResolvedValue(undefined)
  const createUploading = jest.fn().mockResolvedValue({ id: ASSET_ID })
  const markPrepared = jest.fn().mockResolvedValue(options.markPrepared ?? true)
  const failUploading = jest.fn().mockResolvedValue(true)
  const activate = jest.fn().mockResolvedValue('ACTIVATED')
  const persistence = {
    activate,
    createUploading,
    failUploading,
    markPrepared,
  } as unknown as MediaAssetPersistence
  const finalize = jest.fn().mockResolvedValue(undefined)
  const purge = jest.fn().mockResolvedValue(undefined)
  const withStagingValidationSource = jest.fn(
    async (_key: string, operation: (sourcePath: string) => Promise<unknown>) => (
      operation('/private/trusted/staging.part')
    ),
  )
  const storage = {
    checkHealth: jest.fn(),
    createStagingWrite: jest.fn().mockResolvedValue({
      cancel,
      key: STAGING_KEY,
      stream: writableSink(),
    } satisfies StagingWrite),
    finalize,
    moveToTrash: jest.fn(),
    /**
     * 模拟驱动的分级校验：stat 不可证明或摘要不一致都必须返回 false，
     * 与真实驱动「长度 + 摘要」的失败关闭语义保持一致。
     */
    verifyStoredObject: jest.fn().mockImplementation(
      (
        _key: string,
        expected: { readonly checksumSha256: string; readonly sizeBytes: bigint },
      ) => {
        if (options.statSize === null) return Promise.resolve(false)
        const finalContents = options.finalContents ?? Buffer.from('abc')
        if (BigInt(finalContents.length) !== expected.sizeBytes) {
          return Promise.resolve(false)
        }
        return Promise.resolve(
          createHash('sha256').update(finalContents).digest('hex') ===
            expected.checksumSha256,
        )
      },
    ),
    purge,
    restoreFromTrash: jest.fn(),
    stat: jest.fn().mockResolvedValue(
      options.statSize === null
        ? null
        : { modifiedAt: NOW, sizeBytes: options.statSize ?? 3n },
    ),
    withStagingValidationSource,
  } as unknown as MediaStorage
  const validate = jest.fn().mockResolvedValue({
    canonicalExtension: '.webp',
    checksumSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    height: 2,
    mediaType: 'IMAGE',
    mimeType: 'image/webp',
    sizeBytes: 3n,
    width: 1,
  })
  const service = new MediaAssetService(
    persistence,
    storage,
    { validate } as unknown as MediaContentValidator,
    configuration(),
    { now: () => new Date(NOW) },
  )

  return {
    activate,
    cancel,
    createUploading,
    failUploading,
    finalize,
    markPrepared,
    persistence,
    purge,
    service,
    storage,
    validate,
    verifyStoredObject: jest.mocked(storage.verifyStoredObject),
    withStagingValidationSource,
  }
}

function prepare(
  fixture: Fixture,
  overrides: Partial<{
    allowedTypes: readonly MediaType[]
    declaredMimeType: string | null
    originalFilename: string
    pool: MediaStoragePool
    requestedType: MediaType
    stream: Readable
  }> = {},
) {
  return fixture.service.prepare({
    actorUserId: ACTOR_ID,
    allowedTypes: [MediaType.IMAGE],
    declaredMimeType: 'image/webp',
    originalFilename: 'photo.webp',
    pool: 'product',
    requestedType: MediaType.IMAGE,
    stream: NodeReadable.from([Buffer.from('abc')]),
    ...overrides,
  })
}

async function expectLifecycleError(
  operation: Promise<unknown>,
  code: MediaAssetLifecycleError['code'],
  sensitiveCanary?: string,
): Promise<void> {
  let thrown: unknown
  try {
    await operation
  }
  catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(MediaAssetLifecycleError)
  expect((thrown as MediaAssetLifecycleError).code).toBe(code)
  if (sensitiveCanary) {
    expect((thrown as Error).message).not.toContain(sensitiveCanary)
  }
}

describe('MediaAssetService', () => {
  it('streams, validates, materializes and finalizes while keeping activation separate', async () => {
    const fixture = createFixture()

    const prepared = await prepare(fixture)
    expect(prepared).toEqual({
      id: ASSET_ID,
      mediaType: MediaType.IMAGE,
      objectKey: `assets/dev/product/2026/08/${ASSET_ID}.webp`,
      trustedMetadata: {
        canonicalExtension: '.webp',
        checksumSha256: prepared.trustedMetadata.checksumSha256,
        height: 2,
        mediaType: 'IMAGE',
        mimeType: 'image/webp',
        sizeBytes: 3n,
        width: 1,
      },
    })
    expect(prepared.trustedMetadata.checksumSha256).toMatch(/^[0-9a-f]{64}$/u)

    expect(fixture.createUploading).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      mediaType: MediaType.IMAGE,
      originalFilename: 'photo.webp',
      uploadExpiresAt: new Date('2026-08-14T08:09:10.000Z'),
    })
    expect(fixture.withStagingValidationSource).toHaveBeenCalledWith(
      STAGING_KEY,
      expect.any(Function),
    )
    expect(fixture.validate).toHaveBeenCalledWith({
      declaredMimeType: 'image/webp',
      expectedMediaType: 'IMAGE',
      originalFilename: 'photo.webp',
      sourcePath: '/private/trusted/staging.part',
    })
    const markPreparedInput = (
      fixture.markPrepared.mock.calls as unknown as [[PreparedMediaAssetPersistenceInput]]
    )[0][0]
    expect(markPreparedInput).toEqual({
      assetId: ASSET_ID,
      objectKey: `assets/dev/product/2026/08/${ASSET_ID}.webp`,
      trustedMetadata: expect.objectContaining({ sizeBytes: 3n }) as unknown,
    })
    expect(fixture.finalize).toHaveBeenCalledWith(
      STAGING_KEY,
      `assets/dev/product/2026/08/${ASSET_ID}.webp`,
    )
    expect(fixture.markPrepared.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.finalize.mock.invocationCallOrder[0],
    )
    expect(fixture.activate).not.toHaveBeenCalled()
    expect(fixture.failUploading).not.toHaveBeenCalled()
  })

  it('sanitizes display filenames without using them in the canonical object key', async () => {
    const fixture = createFixture()
    const unsafeFilename = `../folder\\\r\n${'名'.repeat(300)}.webp`

    await prepare(fixture, { originalFilename: unsafeFilename })

    const createInput = (fixture.createUploading.mock.calls as unknown as [[{
      originalFilename: string
    }]])[0][0]
    expect(createInput.originalFilename).not.toMatch(/[\\/\r\n]/u)
    expect(Array.from(createInput.originalFilename)).toHaveLength(255)
    const finalizeCall = (fixture.finalize.mock.calls as unknown as [[string, string]])[0]
    expect(finalizeCall[1]).toBe(
      `assets/dev/product/2026/08/${ASSET_ID}.webp`,
    )
  })

  it('enforces the Product IMAGE/VIDEO policy before creating an asset', async () => {
    const fixture = createFixture()

    expect(PRODUCT_MEDIA_ALLOWED_TYPES).toEqual([
      MediaType.IMAGE,
      MediaType.VIDEO,
    ])
    await expectLifecycleError(
      prepare(fixture, {
        allowedTypes: PRODUCT_MEDIA_ALLOWED_TYPES,
        declaredMimeType: 'application/pdf',
        originalFilename: 'manual.pdf',
        pool: 'bill',
        requestedType: MediaType.DOCUMENT,
      }),
      'MEDIA_ASSET_TYPE_NOT_ALLOWED',
    )
    expect(fixture.createUploading).not.toHaveBeenCalled()
  })

  it('keeps DOCUMENT available to an explicit internal domain policy', async () => {
    const fixture = createFixture({
      finalContents: Buffer.from('test'),
      statSize: 4n,
    })
    fixture.validate.mockResolvedValue({
      canonicalExtension: '.pdf',
      checksumSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      mediaType: 'DOCUMENT',
      mimeType: 'application/pdf',
      sizeBytes: 4n,
    })

    await expect(prepare(fixture, {
      allowedTypes: [MediaType.DOCUMENT],
      declaredMimeType: 'application/pdf',
      originalFilename: 'manual.pdf',
      pool: 'bill',
      requestedType: MediaType.DOCUMENT,
      stream: NodeReadable.from([Buffer.from('test')]),
    })).resolves.toMatchObject({
      mediaType: MediaType.DOCUMENT,
      objectKey: `assets/dev/bill/2026/08/${ASSET_ID}.pdf`,
    })
  })

  it('cancels partial staging and converges to FAILED on stream interruption', async () => {
    const fixture = createFixture()
    const sensitiveCanary = '/secret/input/location'
    const interrupted = new NodeReadable({
      read() {
        this.destroy(new Error(sensitiveCanary))
      },
    })

    await expectLifecycleError(
      prepare(fixture, { stream: interrupted }),
      'MEDIA_ASSET_STREAM_FAILED',
      sensitiveCanary,
    )
    expect(fixture.cancel).toHaveBeenCalledTimes(1)
    expect(fixture.failUploading).toHaveBeenCalledWith(
      ASSET_ID,
      'MEDIA_ASSET_STREAM_FAILED',
    )
    expect(fixture.validate).not.toHaveBeenCalled()
  })

  it('fails closed before storage when the initial UPLOADING fact cannot be created', async () => {
    const fixture = createFixture()
    fixture.createUploading.mockRejectedValue(new Error('database topology canary'))

    await expectLifecycleError(
      prepare(fixture),
      'MEDIA_ASSET_PERSISTENCE_FAILED',
      'database topology canary',
    )
    expect(fixture.storage.createStagingWrite).not.toHaveBeenCalled()
    expect(fixture.failUploading).not.toHaveBeenCalled()
  })

  it('converges to FAILED when staging creation cannot start', async () => {
    const fixture = createFixture()
    jest.mocked(fixture.storage.createStagingWrite).mockRejectedValue(
      new MediaStorageError('MEDIA_STORAGE_INSUFFICIENT_SPACE'),
    )

    await expectLifecycleError(prepare(fixture), 'MEDIA_ASSET_STORAGE_FAILED')
    expect(fixture.failUploading).toHaveBeenCalledWith(
      ASSET_ID,
      'MEDIA_ASSET_STORAGE_FAILED',
    )
    expect(fixture.cancel).not.toHaveBeenCalled()
  })

  it('maps validator details to fixed errors and does not finalize invalid content', async () => {
    const fixture = createFixture()
    fixture.validate.mockRejectedValue(
      new MediaValidationError('MEDIA_CONTENT_TYPE_MISMATCH'),
    )

    await expectLifecycleError(
      prepare(fixture),
      'MEDIA_ASSET_CONTENT_TYPE_MISMATCH',
    )
    expect(fixture.cancel).toHaveBeenCalledTimes(1)
    expect(fixture.failUploading).toHaveBeenCalledWith(
      ASSET_ID,
      'MEDIA_ASSET_CONTENT_TYPE_MISMATCH',
    )
    expect(fixture.finalize).not.toHaveBeenCalled()
  })

  it('rejects digest/parser size disagreement before persistence', async () => {
    const fixture = createFixture()
    fixture.validate.mockResolvedValue({
      canonicalExtension: '.webp',
      checksumSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      height: 2,
      mediaType: 'IMAGE',
      mimeType: 'image/webp',
      sizeBytes: 99n,
      width: 1,
    })

    await expectLifecycleError(prepare(fixture), 'MEDIA_ASSET_CONTENT_INVALID')
    expect(fixture.markPrepared).not.toHaveBeenCalled()
    expect(fixture.cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects a same-size staging replacement when validator and upload digests differ', async () => {
    const fixture = createFixture()
    fixture.validate.mockResolvedValue({
      canonicalExtension: '.webp',
      checksumSha256: 'f'.repeat(64),
      height: 2,
      mediaType: 'IMAGE',
      mimeType: 'image/webp',
      sizeBytes: 3n,
      width: 1,
    })

    await expectLifecycleError(prepare(fixture), 'MEDIA_ASSET_CONTENT_INVALID')
    expect(fixture.markPrepared).not.toHaveBeenCalled()
    expect(fixture.cancel).toHaveBeenCalledTimes(1)
  })

  it('uses conditional metadata materialization and fails closed on a state race', async () => {
    const fixture = createFixture({ markPrepared: false })

    await expectLifecycleError(prepare(fixture), 'MEDIA_ASSET_STATE_CONFLICT')
    expect(fixture.cancel).toHaveBeenCalledTimes(1)
    expect(fixture.finalize).not.toHaveBeenCalled()
  })

  it('cancels staging and records a fixed failure when metadata persistence throws', async () => {
    const fixture = createFixture()
    fixture.markPrepared.mockRejectedValue(new Error('database connection canary'))

    await expectLifecycleError(
      prepare(fixture),
      'MEDIA_ASSET_PERSISTENCE_FAILED',
      'database connection canary',
    )
    expect(fixture.cancel).toHaveBeenCalledTimes(1)
    expect(fixture.finalize).not.toHaveBeenCalled()
    expect(fixture.failUploading).toHaveBeenCalledWith(
      ASSET_ID,
      'MEDIA_ASSET_PERSISTENCE_FAILED',
    )
  })

  it('keeps a post-rename final object non-READY when later activation rolls back', async () => {
    const fixture = createFixture()
    const prepared = await prepare(fixture)
    const transaction = {} as Prisma.TransactionClient
    fixture.activate.mockRejectedValue(new Error('database transaction rolled back'))

    await expectLifecycleError(
      fixture.service.activate(transaction, prepared.id),
      'MEDIA_ASSET_PERSISTENCE_FAILED',
      'database transaction rolled back',
    )
    expect(fixture.purge).not.toHaveBeenCalled()
    expect(fixture.failUploading).not.toHaveBeenCalled()
  })

  it('converges finalize failures to FAILED without leaking storage details', async () => {
    const fixture = createFixture()
    fixture.finalize.mockRejectedValue(
      new MediaStorageError('MEDIA_STORAGE_FILESYSTEM_MISMATCH'),
    )

    await expectLifecycleError(prepare(fixture), 'MEDIA_ASSET_STORAGE_FAILED')
    expect(fixture.failUploading).toHaveBeenCalledWith(
      ASSET_ID,
      'MEDIA_ASSET_STORAGE_FAILED',
    )
  })

  it('verifies the stored object through the driver contract after finalize', async () => {
    const fixture = createFixture()

    await prepare(fixture)

    expect(fixture.finalize).toHaveBeenCalledTimes(1)
    // 校验强度由驱动决定，服务只提供期望的长度与摘要，因此这里断言的是合同调用本身。
    expect(fixture.verifyStoredObject).toHaveBeenCalledWith(
      `assets/dev/product/2026/08/${ASSET_ID}.webp`,
      {
        checksumSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        sizeBytes: 3n,
      },
    )
  })

  it('retains an unknown final residue for reconciliation when final stat cannot be proven', async () => {
    const fixture = createFixture({ statSize: null })

    await expectLifecycleError(prepare(fixture), 'MEDIA_ASSET_STORAGE_FAILED')
    expect(fixture.finalize).toHaveBeenCalledTimes(1)
    expect(fixture.purge).not.toHaveBeenCalled()
    expect(fixture.failUploading).toHaveBeenCalledWith(
      ASSET_ID,
      'MEDIA_ASSET_STORAGE_FAILED',
    )
  })

  it('rejects a same-size final object whose digest differs after atomic rename', async () => {
    const fixture = createFixture({ finalContents: Buffer.from('xyz') })

    await expectLifecycleError(prepare(fixture), 'MEDIA_ASSET_STORAGE_FAILED')
    expect(fixture.failUploading).toHaveBeenCalledWith(
      ASSET_ID,
      'MEDIA_ASSET_STORAGE_FAILED',
    )
    expect(fixture.purge).not.toHaveBeenCalled()
  })

  it('keeps fail idempotent and never asks persistence to rewrite READY directly', async () => {
    const fixture = createFixture()

    await expect(fixture.service.fail(
      ASSET_ID,
      'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED',
    )).resolves.toBeUndefined()
    await expect(fixture.service.fail(
      ASSET_ID,
      'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED',
    )).resolves.toBeUndefined()

    expect(fixture.failUploading).toHaveBeenCalledTimes(2)
  })

  it('accepts repeated READY activation but rejects non-activatable facts', async () => {
    const readyFixture = createFixture()
    readyFixture.activate.mockResolvedValue('ALREADY_READY')
    await expect(readyFixture.service.activate(
      {} as Prisma.TransactionClient,
      ASSET_ID,
    )).resolves.toBeUndefined()

    const failedFixture = createFixture()
    failedFixture.activate.mockResolvedValue('NOT_ACTIVATABLE')
    await expectLifecycleError(
      failedFixture.service.activate({} as Prisma.TransactionClient, ASSET_ID),
      'MEDIA_ASSET_STATE_CONFLICT',
    )
  })

  it('rejects arbitrary high-cardinality failure codes before persistence', async () => {
    const fixture = createFixture()

    await expectLifecycleError(
      fixture.service.fail(
        ASSET_ID,
        '/private/secret/input.webp' as 'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED',
      ),
      'MEDIA_ASSET_INPUT_INVALID',
      '/private/secret/input.webp',
    )
    expect(fixture.failUploading).not.toHaveBeenCalled()
  })
})
