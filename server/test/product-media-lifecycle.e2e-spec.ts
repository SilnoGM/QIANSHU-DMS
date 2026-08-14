import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import {
  MediaAssetStatus,
  MediaType,
  ProductMediaKind,
} from '../src/generated/prisma/enums'
import { AuditService } from '../src/modules/audit/audit.service'
import {
  MediaAssetService,
  type PrepareMediaAssetInput,
  type PreparedMediaAsset,
} from '../src/modules/media/media-asset.service'
import { trashKeyFor } from '../src/modules/media/media-retention.service'
import { ProductMediaService } from '../src/modules/products/media/product-media.service'
import {
  createE2eImageBuffer,
  ProductMediaE2eHarness,
} from './product-media-e2e-harness'

// ProductMedia 历史行禁止 DELETE；本文件只能由专属 runner 在一次性数据库中开启。
const describeExclusive = process.env.PRODUCT_MEDIA_E2E_EXCLUSIVE === '1'
  ? describe
  : describe.skip

describeExclusive('Product media real lifecycle with isolated storage', () => {
  jest.setTimeout(60_000)

  let runtime: ProductMediaE2eHarness

  beforeAll(async () => {
    runtime = await ProductMediaE2eHarness.create()
  })

  afterAll(async () => {
    await runtime?.close()
  })

  it('starts from an empty media domain and preserves the migration RBAC invariant', () => {
    expect(runtime.initialState).toEqual({
      mediaAssetCount: 0,
      productMediaCount: 0,
      productMediaReadPermissionGrantedToSystemAdmin: true,
    })
  })

  it('uploads real IMAGE and VIDEO files, persists trusted metadata, and writes a complete primary layout', async () => {
    const productId = await runtime.createProduct('REAL-LIFECYCLE')
    const firstImage = await runtime.uploadImage(productId, 1, 'real-first')
    const video = await runtime.uploadVideo(productId, 2, 'real-video')
    const secondImage = await runtime.uploadImage(productId, 3, 'real-second')
    if (
      firstImage.affectedProductMediaId === null
      || video.affectedProductMediaId === null
      || secondImage.affectedProductMediaId === null
    ) {
      throw new Error('Real upload association invariant failed')
    }

    const layout = await runtime.productMedia.updateLayout(
      runtime.context('real-layout'),
      productId,
      {
        expectedVersion: 4,
        imageIds: [
          secondImage.affectedProductMediaId,
          firstImage.affectedProductMediaId,
        ],
        primaryImageId: secondImage.affectedProductMediaId,
        videoIds: [video.affectedProductMediaId],
      },
    )
    expect(layout).toMatchObject({ changed: true, version: 5 })
    expect(layout.items.map(item => ({
      id: item.id,
      isPrimary: item.isPrimary,
      kind: item.kind,
      sortOrder: item.sortOrder,
    }))).toEqual([
      {
        id: secondImage.affectedProductMediaId,
        isPrimary: true,
        kind: ProductMediaKind.IMAGE,
        sortOrder: 0,
      },
      {
        id: firstImage.affectedProductMediaId,
        isPrimary: false,
        kind: ProductMediaKind.IMAGE,
        sortOrder: 1,
      },
      {
        id: video.affectedProductMediaId,
        isPrimary: false,
        kind: ProductMediaKind.VIDEO,
        sortOrder: 0,
      },
    ])

    const associations = await runtime.prisma.productMedia.findMany({
      where: { productId, detachedAt: null },
      select: {
        kind: true,
        mediaAsset: {
          select: {
            audioCodec: true,
            durationMs: true,
            height: true,
            objectKey: true,
            status: true,
            videoCodec: true,
            width: true,
          },
        },
      },
    })
    expect(associations).toHaveLength(3)
    expect(associations.find(item => item.kind === ProductMediaKind.VIDEO)
      ?.mediaAsset).toMatchObject({
      audioCodec: 'aac',
      durationMs: 1_250,
      height: 1_080,
      status: MediaAssetStatus.READY,
      videoCodec: 'h264',
      width: 1_920,
    })
    for (const association of associations) {
      const objectKey = association.mediaAsset.objectKey
      if (objectKey === null) throw new Error('Ready asset object key invariant failed')
      await expect(runtime.storage.stat(objectKey)).resolves.toEqual(
        expect.objectContaining({ sizeBytes: expect.any(BigInt) as unknown }),
      )
    }
    await expect(runtime.prisma.auditEvent.count({
      where: { targetId: productId, eventType: 'PRODUCT_UPDATED' },
    })).resolves.toBe(4)
  })

  it('compensates interrupted streams and purges expired staging plus a finalized file after domain failure', async () => {
    const interruptedProductId = await runtime.createProduct('STREAM-FAILURE')
    const interrupted = Readable.from((function* () {
      yield Buffer.from('partial')
      throw new Error('e2e stream interruption')
    })())
    await expect(runtime.productMedia.upload(
      runtime.context('stream-failure'),
      interruptedProductId,
      {
        declaredMimeType: 'image/webp',
        expectedVersion: 1,
        kind: ProductMediaKind.IMAGE,
        originalFilename: 'interrupted.webp',
        stream: interrupted,
      },
    )).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' })
    const interruptedAsset = await runtime.prisma.mediaAsset.findFirstOrThrow({
      where: { originalFilename: 'interrupted.webp' },
      orderBy: { createdAt: 'desc' },
      select: { failureCode: true, id: true, objectKey: true, status: true },
    })
    expect(interruptedAsset).toMatchObject({
      failureCode: 'MEDIA_ASSET_STREAM_FAILED',
      objectKey: null,
      status: MediaAssetStatus.FAILED,
    })
    await expect(runtime.storage.inventory({
      limit: 100,
      namespace: 'staging',
      prefix: `staging/${interruptedAsset.id}.`,
    })).resolves.toMatchObject({ objects: [] })

    const stagingAsset = await runtime.mediaAssetPersistence.createUploading({
      actorUserId: runtime.actorId,
      mediaType: MediaType.IMAGE,
      originalFilename: 'expired-staging.webp',
      uploadExpiresAt: new Date('2026-08-14T11:00:00.000Z'),
    })
    const staging = await runtime.storage.createStagingWrite(stagingAsset.id)
    await pipeline(Readable.from([Buffer.from('expired-staging')]), staging.stream)

    const racedProductId = await runtime.createProduct('FINALIZED-FAILURE')
    let finalizedAsset: PreparedMediaAsset | undefined
    const racingAsset = {
      activate: runtime.assets.activate.bind(runtime.assets),
      fail: runtime.assets.fail.bind(runtime.assets),
      prepare: async (input: PrepareMediaAssetInput) => {
        const prepared = await runtime.assets.prepare(input)
        finalizedAsset = prepared
        // 文件已完成原子 rename 后制造真实 Product version 竞争，验证领域失败补偿。
        await runtime.prisma.product.update({
          where: { id: racedProductId },
          data: { version: { increment: 1 } },
        })
        return prepared
      },
    } as unknown as MediaAssetService
    const racingService = new ProductMediaService(
      runtime.prisma,
      runtime.persistence,
      racingAsset,
      runtime.retention,
      new AuditService(),
    )
    await expect(racingService.upload(
      runtime.context('finalized-failure'),
      racedProductId,
      {
        declaredMimeType: 'image/webp',
        expectedVersion: 1,
        kind: ProductMediaKind.IMAGE,
        originalFilename: 'finalized-failure.webp',
        stream: Readable.from([await createE2eImageBuffer()]),
      },
    )).rejects.toMatchObject({ code: 'PRODUCT_STATE_CHANGED' })
    if (finalizedAsset === undefined) {
      throw new Error('Finalized failure asset invariant failed')
    }
    await expect(runtime.storage.stat(finalizedAsset.objectKey)).resolves.not.toBeNull()
    await expect(runtime.prisma.mediaAsset.findUniqueOrThrow({
      where: { id: finalizedAsset.id },
      select: { failureCode: true, status: true },
    })).resolves.toEqual({
      failureCode: 'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED',
      status: MediaAssetStatus.FAILED,
    })
    await runtime.prisma.mediaAsset.update({
      where: { id: finalizedAsset.id },
      data: { uploadExpiresAt: new Date('2026-08-14T11:00:00.000Z') },
    })

    const cleanup = await runtime.reconciliation.cleanupExpiredUploads({
      batchSize: 10,
      timeBudgetMs: 5_000,
    })
    expect(cleanup).toMatchObject({ completed: 2, failed: 0, isolated: 0 })
    await expect(runtime.storage.stat(finalizedAsset.objectKey)).resolves.toBeNull()
    const cleanedAssets = await runtime.prisma.mediaAsset.findMany({
      where: { id: { in: [stagingAsset.id, finalizedAsset.id] } },
      select: { status: true },
    })
    expect(cleanedAssets).toHaveLength(2)
    expect(cleanedAssets.every(asset => asset.status === MediaAssetStatus.PURGED))
      .toBe(true)
    await expect(runtime.storage.inventory({
      limit: 100,
      namespace: 'staging',
      prefix: `staging/${stagingAsset.id}.`,
    })).resolves.toMatchObject({ objects: [] })
  })

  it('prevents cleanup while referenced, then trashes, restores, re-trashes and purges one real file', async () => {
    const productId = await runtime.createProduct('RETENTION')
    const uploaded = await runtime.uploadImage(productId, 1, 'retention')
    if (uploaded.affectedProductMediaId === null) {
      throw new Error('Retention upload association invariant failed')
    }
    const association = await runtime.prisma.productMedia.findUniqueOrThrow({
      where: { id: uploaded.affectedProductMediaId },
      select: { mediaAsset: { select: { id: true, objectKey: true } } },
    })
    const { id: assetId, objectKey } = association.mediaAsset
    if (objectKey === null) throw new Error('Retention object key invariant failed')

    await expect(runtime.prisma.$transaction(transaction => (
      runtime.retention.trashIfUnreferenced(transaction, assetId)
    ))).resolves.toBe('ACTIVE_REFERENCE')
    await expect(runtime.storage.stat(objectKey)).resolves.not.toBeNull()

    await runtime.productMedia.detach(
      runtime.context('retention-detach'),
      productId,
      uploaded.affectedProductMediaId,
      { expectedVersion: 2 },
    )
    const trashKey = trashKeyFor(objectKey)
    await expect(runtime.storage.stat(objectKey)).resolves.toBeNull()
    await expect(runtime.storage.stat(trashKey)).resolves.not.toBeNull()

    const restoredProductId = await runtime.createProduct('RESTORED')
    let restoredAssociationId = ''
    const restoreResult = await runtime.prisma.$transaction(async (transaction) => {
      const result = await runtime.retention.restoreForReference(transaction, assetId)
      restoredAssociationId = await runtime.persistence.createAssociation(transaction, {
        actorUserId: runtime.actorId,
        kind: ProductMediaKind.IMAGE,
        mediaAssetId: assetId,
        productId: restoredProductId,
        sortOrder: 0,
      })
      return result
    })
    expect(restoreResult).toBe('RESTORED')
    await expect(runtime.storage.stat(objectKey)).resolves.not.toBeNull()
    await expect(runtime.storage.stat(trashKey)).resolves.toBeNull()

    await runtime.productMedia.detach(
      runtime.context('restored-detach'),
      restoredProductId,
      restoredAssociationId,
      { expectedVersion: 1 },
    )
    await runtime.prisma.mediaAsset.update({
      where: { id: assetId },
      data: { retentionUntil: new Date('2026-08-14T11:00:00.000Z') },
    })
    await expect(runtime.reconciliation.cleanupExpiredTrash({
      batchSize: 10,
      timeBudgetMs: 5_000,
    })).resolves.toMatchObject({
      completed: 1,
      failed: 0,
      isolated: 0,
      scanned: 1,
    })
    await expect(runtime.prisma.mediaAsset.findUniqueOrThrow({
      where: { id: assetId },
      select: { status: true },
    })).resolves.toEqual({ status: MediaAssetStatus.PURGED })
    await expect(runtime.storage.stat(objectKey)).resolves.toBeNull()
    await expect(runtime.storage.stat(trashKey)).resolves.toBeNull()
  })
})
