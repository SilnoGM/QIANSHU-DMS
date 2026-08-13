import type { Prisma } from '../../generated/prisma/client'
import {
  MediaAssetStatus,
  MediaType,
} from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  MediaAssetPersistence,
  type PreparedMediaAssetPersistenceInput,
} from './media-asset.persistence'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'
const ACTOR_ID = '00000000-0000-4000-8000-000000000654'
const EXPIRES_AT = new Date('2026-08-14T08:00:00.000Z')

function createPersistenceFixture() {
  const create = jest.fn().mockResolvedValue({ id: ASSET_ID })
  const updateMany = jest.fn().mockResolvedValue({ count: 1 })
  const findUnique = jest.fn().mockResolvedValue(null)
  const prisma = {
    mediaAsset: { create, findUnique, updateMany },
  } as unknown as PrismaService

  return {
    create,
    findUnique,
    persistence: new MediaAssetPersistence(prisma),
    updateMany,
  }
}

function preparedInput(
  overrides: Partial<PreparedMediaAssetPersistenceInput> = {},
): PreparedMediaAssetPersistenceInput {
  return {
    assetId: ASSET_ID,
    objectKey: `assets/2026/08/${ASSET_ID}.webp`,
    trustedMetadata: {
      canonicalExtension: '.webp',
      checksumSha256: 'a'.repeat(64),
      height: 480,
      mediaType: 'IMAGE',
      mimeType: 'image/webp',
      sizeBytes: 321n,
      width: 640,
    },
    ...overrides,
  }
}

describe('MediaAssetPersistence', () => {
  it('creates a 24-hour UPLOADING fact with unavailable metadata kept null', async () => {
    const fixture = createPersistenceFixture()

    await expect(fixture.persistence.createUploading({
      actorUserId: ACTOR_ID,
      mediaType: MediaType.IMAGE,
      originalFilename: 'photo.webp',
      uploadExpiresAt: EXPIRES_AT,
    })).resolves.toEqual({ id: ASSET_ID })

    expect(fixture.create).toHaveBeenCalledWith({
      data: {
        audioCodec: null,
        checksumSha256: null,
        createdByUserId: ACTOR_ID,
        durationMs: null,
        failureCode: null,
        height: null,
        mediaType: MediaType.IMAGE,
        mimeType: null,
        objectKey: null,
        originalFilename: 'photo.webp',
        retentionUntil: null,
        sizeBytes: null,
        status: MediaAssetStatus.UPLOADING,
        storageDriver: 'local',
        uploadExpiresAt: EXPIRES_AT,
        videoCodec: null,
        width: null,
      },
      select: { id: true },
    })
  })

  it('conditionally materializes trusted IMAGE metadata without making the asset READY', async () => {
    const fixture = createPersistenceFixture()

    await expect(fixture.persistence.markPrepared(preparedInput())).resolves.toBe(true)

    expect(fixture.updateMany).toHaveBeenCalledWith({
      where: {
        id: ASSET_ID,
        objectKey: null,
        status: MediaAssetStatus.UPLOADING,
      },
      data: {
        audioCodec: null,
        checksumSha256: 'a'.repeat(64),
        durationMs: null,
        failureCode: null,
        height: 480,
        mimeType: 'image/webp',
        objectKey: `assets/2026/08/${ASSET_ID}.webp`,
        sizeBytes: 321n,
        videoCodec: null,
        width: 640,
      },
    })
    const preparedWrite = (fixture.updateMany.mock.calls as unknown as [[unknown]])[0][0]
    expect(preparedWrite).not.toHaveProperty('data.status')
  })

  it('stores only the metadata applicable to VIDEO and DOCUMENT', async () => {
    const videoFixture = createPersistenceFixture()
    await videoFixture.persistence.markPrepared(preparedInput({
      objectKey: `assets/2026/08/${ASSET_ID}.mp4`,
      trustedMetadata: {
        audioCodec: 'aac',
        canonicalExtension: '.mp4',
        checksumSha256: 'a'.repeat(64),
        durationMs: 1_234,
        height: 1080,
        mediaType: 'VIDEO',
        mimeType: 'video/mp4',
        sizeBytes: 999n,
        videoCodec: 'h264',
        width: 1920,
      },
    }))
    const videoWrite = (videoFixture.updateMany.mock.calls as unknown as [[unknown]])[0][0]
    expect(videoWrite).toMatchObject({
      data: {
        audioCodec: 'aac',
        durationMs: 1_234,
        height: 1080,
        videoCodec: 'h264',
        width: 1920,
      },
    })

    const documentFixture = createPersistenceFixture()
    await documentFixture.persistence.markPrepared(preparedInput({
      objectKey: `assets/2026/08/${ASSET_ID}.pdf`,
      trustedMetadata: {
        canonicalExtension: '.pdf',
        checksumSha256: 'a'.repeat(64),
        mediaType: 'DOCUMENT',
        mimeType: 'application/pdf',
        sizeBytes: 456n,
      },
    }))
    const documentWrite = (documentFixture.updateMany.mock.calls as unknown as [[unknown]])[0][0]
    expect(documentWrite).toMatchObject({
      data: {
        audioCodec: null,
        durationMs: null,
        height: null,
        videoCodec: null,
        width: null,
      },
    })
  })

  it('activates only a fully prepared UPLOADING row in the caller transaction', async () => {
    const fixture = createPersistenceFixture()
    const transactionUpdateMany = jest.fn().mockResolvedValue({ count: 1 })
    const transaction = {
      mediaAsset: {
        findUnique: jest.fn(),
        updateMany: transactionUpdateMany,
      },
    } as unknown as Prisma.TransactionClient

    await expect(fixture.persistence.activate(transaction, ASSET_ID)).resolves.toBe('ACTIVATED')

    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: {
        checksumSha256: { not: null },
        id: ASSET_ID,
        mimeType: { not: null },
        objectKey: { not: null },
        sizeBytes: { not: null },
        status: MediaAssetStatus.UPLOADING,
      },
      data: {
        failureCode: null,
        status: MediaAssetStatus.READY,
        uploadExpiresAt: null,
      },
    })
  })

  it('treats repeated READY activation as idempotent and rejects other states', async () => {
    const fixture = createPersistenceFixture()
    const updateMany = jest.fn().mockResolvedValue({ count: 0 })
    const findUnique = jest.fn()
      .mockResolvedValueOnce({ status: MediaAssetStatus.READY })
      .mockResolvedValueOnce({ status: MediaAssetStatus.FAILED })
      .mockResolvedValueOnce(null)
    const transaction = {
      mediaAsset: { findUnique, updateMany },
    } as unknown as Prisma.TransactionClient

    await expect(fixture.persistence.activate(transaction, ASSET_ID)).resolves.toBe('ALREADY_READY')
    await expect(fixture.persistence.activate(transaction, ASSET_ID)).resolves.toBe('NOT_ACTIVATABLE')
    await expect(fixture.persistence.activate(transaction, ASSET_ID)).resolves.toBe('NOT_FOUND')
  })

  it('moves only UPLOADING to FAILED and makes repeated failure convergence a no-op', async () => {
    const fixture = createPersistenceFixture()
    fixture.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    await expect(fixture.persistence.failUploading(
      ASSET_ID,
      'MEDIA_ASSET_CONTENT_INVALID',
    )).resolves.toBe(true)
    await expect(fixture.persistence.failUploading(
      ASSET_ID,
      'MEDIA_ASSET_CONTENT_INVALID',
    )).resolves.toBe(false)

    expect(fixture.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: ASSET_ID, status: MediaAssetStatus.UPLOADING },
      data: {
        failureCode: 'MEDIA_ASSET_CONTENT_INVALID',
        status: MediaAssetStatus.FAILED,
      },
    })
  })
})
