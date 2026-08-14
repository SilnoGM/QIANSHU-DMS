import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

import { ConfigService } from '@nestjs/config'

import type { Prisma } from '../src/generated/prisma/client'
import {
  MediaAssetStatus,
  MediaType,
  ProductMediaKind,
} from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { ApiException } from '../src/infrastructure/http/api.exception'
import {
  AuditService,
  AuditWriteFailedError,
} from '../src/modules/audit/audit.service'
import { MediaAssetPersistence } from '../src/modules/media/media-asset.persistence'
import type {
  MediaAssetService,
  PreparedMediaAsset,
} from '../src/modules/media/media-asset.service'
import type { MediaAssetRetentionService } from '../src/modules/media/media-retention.service'
import { ProductMediaPersistence } from '../src/modules/products/media/product-media.persistence'
import {
  ProductMediaService,
  type ProductMediaCommandContext,
} from '../src/modules/products/media/product-media.service'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for ProductMedia E2E tests')
  return value
}

interface PreparedAssetFixture {
  readonly id: string
  readonly prepared: PreparedMediaAsset
}

// ProductMedia 历史行由数据库禁止 DELETE，不能与假设空业务表的全量 E2E 共用同一容器。
// 专用 runner 会为本 suite 创建独占的一次性 PostgreSQL，并显式打开该环境门禁。
const describeExclusive = process.env.PRODUCT_MEDIA_E2E_EXCLUSIVE === '1'
  ? describe
  : describe.skip

describeExclusive('ProductMediaService with isolated PostgreSQL', () => {
  jest.setTimeout(60_000)

  let actorId: string
  let prisma: PrismaService
  let persistence: ProductMediaPersistence
  let assetPersistence: MediaAssetPersistence
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: requireDatabaseUrl() }),
    )
    await prisma.onModuleInit()
    persistence = new ProductMediaPersistence(prisma)
    assetPersistence = new MediaAssetPersistence(prisma)

    const actor = await prisma.user.create({
      data: {
        displayName: 'ProductMedia E2E',
        passwordChangedAt: new Date(),
        passwordHash: 'e2e-only-not-a-real-password-hash',
        username: `product-media-e2e-${suffix}`,
        usernameNormalized: `product-media-e2e-${suffix}`,
      },
      select: { id: true },
    })
    actorId = actor.id
  })

  afterAll(async () => {
    // ProductMedia 历史表禁止 DELETE；CI PostgreSQL 本身是一次性隔离环境，由外层统一销毁。
    await prisma.onModuleDestroy()
  })

  async function createProduct(label: string): Promise<string> {
    const product = await prisma.product.create({
      data: {
        createdByUserId: actorId,
        name: `ProductMedia ${label}`,
        productNo: `PM-${suffix}-${label}`,
        updatedByUserId: actorId,
      },
      select: { id: true },
    })
    return product.id
  }

  async function createPreparedImage(label: string): Promise<PreparedAssetFixture> {
    const asset = await prisma.mediaAsset.create({
      data: {
        checksumSha256: 'a'.repeat(64),
        createdByUserId: actorId,
        height: 100,
        mediaType: MediaType.IMAGE,
        mimeType: 'image/jpeg',
        objectKey: `assets/2026/08/${randomUUID()}.jpg`,
        originalFilename: `${label}.jpg`,
        sizeBytes: 3n,
        status: MediaAssetStatus.UPLOADING,
        uploadExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        width: 100,
      },
      select: { id: true, objectKey: true },
    })
    if (asset.objectKey === null) throw new Error('Prepared asset key invariant failed')
    return {
      id: asset.id,
      prepared: {
        id: asset.id,
        mediaType: MediaType.IMAGE,
        objectKey: asset.objectKey,
        trustedMetadata: {
          canonicalExtension: '.jpg',
          checksumSha256: 'a'.repeat(64),
          height: 100,
          mediaType: 'IMAGE',
          mimeType: 'image/jpeg',
          sizeBytes: 3n,
          width: 100,
        },
      },
    }
  }

  function context(label: string): ProductMediaCommandContext {
    return { actorUserId: actorId, requestId: `product-media-e2e-${label}` }
  }

  function mediaAssetAdapter(
    asset: PreparedAssetFixture,
    prepareBarrier?: () => Promise<void>,
  ): MediaAssetService {
    return {
      activate: (transaction: Prisma.TransactionClient, assetId: string) => (
        assetPersistence.activate(transaction, assetId).then((result) => {
          if (result !== 'ACTIVATED' && result !== 'ALREADY_READY') {
            throw new Error('E2E asset activation failed')
          }
        })
      ),
      fail: async (assetId: string) => {
        await assetPersistence.failUploading(
          assetId,
          'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED',
        )
      },
      prepare: async () => {
        await prepareBarrier?.()
        return asset.prepared
      },
    } as unknown as MediaAssetService
  }

  function retentionAdapter(): MediaAssetRetentionService {
    return {
      trashIfUnreferenced: async (
        transaction: Prisma.TransactionClient,
        assetId: string,
      ) => {
        const activeReference = await transaction.productMedia.findFirst({
          where: { mediaAssetId: assetId, detachedAt: null },
          select: { id: true },
        })
        if (activeReference !== null) return 'ACTIVE_REFERENCE'

        const now = new Date()
        const changed = await transaction.mediaAsset.updateMany({
          where: { id: assetId, status: MediaAssetStatus.READY },
          data: {
            deletedAt: now,
            retentionUntil: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000),
            status: MediaAssetStatus.TRASHED,
          },
        })
        return changed.count === 1 ? 'TRASHED' : 'STATE_CONFLICT'
      },
    } as unknown as MediaAssetRetentionService
  }

  function service(
    asset: PreparedAssetFixture,
    audit: AuditService = new AuditService(),
    prepareBarrier?: () => Promise<void>,
  ): ProductMediaService {
    return new ProductMediaService(
      prisma,
      persistence,
      mediaAssetAdapter(asset, prepareBarrier),
      retentionAdapter(),
      audit,
    )
  }

  function upload(
    target: ProductMediaService,
    productId: string,
    expectedVersion: number,
    label: string,
  ) {
    return target.upload(context(label), productId, {
      declaredMimeType: 'image/jpeg',
      expectedVersion,
      kind: ProductMediaKind.IMAGE,
      originalFilename: `${label}.jpg`,
      stream: Readable.from([Buffer.from('abc')]),
    })
  }

  it('serializes same-version uploads, swaps sort safely, no-ops identical layout and detaches without a replacement primary', async () => {
    const productId = await createProduct('CONCURRENCY')
    const firstAsset = await createPreparedImage('first')
    const secondAsset = await createPreparedImage('second')
    let preparedCount = 0
    let releasePreparations: (() => void) | undefined
    const bothPrepared = new Promise<void>((resolve) => {
      releasePreparations = resolve
    })
    const barrier = async () => {
      preparedCount += 1
      if (preparedCount === 2) releasePreparations?.()
      await bothPrepared
    }

    const concurrent = await Promise.allSettled([
      upload(service(firstAsset, new AuditService(), barrier), productId, 1, 'first'),
      upload(service(secondAsset, new AuditService(), barrier), productId, 1, 'second'),
    ])
    expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = concurrent.find(result => result.status === 'rejected')
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ code: 'PRODUCT_STATE_CHANGED' }) as unknown,
      status: 'rejected',
    })

    const afterConcurrent = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: {
        version: true,
        media: {
          where: { detachedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, mediaAssetId: true, sortOrder: true },
        },
      },
    })
    expect(afterConcurrent.version).toBe(2)
    expect(afterConcurrent.media).toHaveLength(1)
    const statuses = await prisma.mediaAsset.findMany({
      where: { id: { in: [firstAsset.id, secondAsset.id] } },
      orderBy: { status: 'asc' },
      select: { status: true },
    })
    expect(statuses.map(asset => asset.status).sort()).toEqual([
      MediaAssetStatus.FAILED,
      MediaAssetStatus.READY,
    ])

    const thirdAsset = await createPreparedImage('third')
    const secondUpload = await upload(service(thirdAsset), productId, 2, 'third')
    expect(secondUpload.version).toBe(3)
    const originalIds = secondUpload.items.map(item => item.id)
    expect(originalIds).toHaveLength(2)

    const reversedIds = [...originalIds].reverse()
    const layoutService = service(thirdAsset)
    const changed = await layoutService.updateLayout(context('layout'), productId, {
      expectedVersion: 3,
      imageIds: reversedIds,
      primaryImageId: reversedIds[0] ?? null,
      videoIds: [],
    })
    expect(changed).toMatchObject({ changed: true, version: 4 })
    expect(changed.items.map(item => ({
      id: item.id,
      isPrimary: item.isPrimary,
      sortOrder: item.sortOrder,
    }))).toEqual([
      { id: reversedIds[0], isPrimary: true, sortOrder: 0 },
      { id: reversedIds[1], isPrimary: false, sortOrder: 1 },
    ])

    const auditCountBeforeNoop = await prisma.auditEvent.count({
      where: { targetId: productId, eventType: 'PRODUCT_UPDATED' },
    })
    const noOp = await layoutService.updateLayout(context('layout-noop'), productId, {
      expectedVersion: 4,
      imageIds: reversedIds,
      primaryImageId: reversedIds[0] ?? null,
      videoIds: [],
    })
    expect(noOp).toMatchObject({ changed: false, version: 4 })
    await expect(prisma.auditEvent.count({
      where: { targetId: productId, eventType: 'PRODUCT_UPDATED' },
    })).resolves.toBe(auditCountBeforeNoop)

    const detached = await layoutService.detach(
      context('detach'),
      productId,
      reversedIds[0],
      { expectedVersion: 4 },
    )
    expect(detached).toMatchObject({ changed: true, version: 5 })
    expect(detached.items).toHaveLength(1)
    expect(detached.items[0]).toMatchObject({ isPrimary: false, sortOrder: 0 })
    const detachedAssetId = changed.items.find(item => item.id === reversedIds[0])?.mediaAssetId
    if (detachedAssetId === undefined) {
      throw new Error('Detached media asset invariant failed')
    }
    await expect(prisma.mediaAsset.findUniqueOrThrow({
      where: { id: detachedAssetId },
      select: { status: true },
    })).resolves.toEqual({ status: MediaAssetStatus.TRASHED })
  })

  it('rolls back activation, association and Product version when Audit fails, then marks the prepared asset FAILED', async () => {
    const productId = await createProduct('AUDIT-ROLLBACK')
    const asset = await createPreparedImage('audit-rollback')
    const failingAudit = {
      record: () => Promise.reject(new AuditWriteFailedError()),
    } as unknown as AuditService

    let thrown: unknown
    try {
      await upload(service(asset, failingAudit), productId, 1, 'audit-rollback')
    }
    catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ApiException)
    expect((thrown as ApiException).code).toBe('INTERNAL_ERROR')

    await expect(prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { version: true },
    })).resolves.toEqual({ version: 1 })
    await expect(prisma.productMedia.count({
      where: { productId, detachedAt: null },
    })).resolves.toBe(0)
    await expect(prisma.mediaAsset.findUniqueOrThrow({
      where: { id: asset.id },
      select: { status: true, failureCode: true },
    })).resolves.toEqual({
      failureCode: 'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED',
      status: MediaAssetStatus.FAILED,
    })
    await expect(prisma.auditEvent.count({
      where: { targetId: productId, eventType: 'PRODUCT_UPDATED' },
    })).resolves.toBe(0)
  })
})
