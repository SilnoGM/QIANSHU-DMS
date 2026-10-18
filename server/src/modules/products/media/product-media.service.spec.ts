import { Readable } from 'node:stream'

import { HttpStatus } from '@nestjs/common'
import type { Prisma } from '../../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  MediaType,
  ProductMediaKind,
  ProductStatus,
} from '../../../generated/prisma/enums'
import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import type { AuditService, RecordAuditEventInput } from '../../audit/audit.service'
import type { MediaAssetService, PreparedMediaAsset } from '../../media/media-asset.service'
import type { MediaAssetRetentionService } from '../../media/media-retention.service'
import type {
  ProductMediaPersistence,
  ProductMediaProductLock,
  ProductMediaSnapshotItem,
  ProductMediaUploadPreflight,
} from './product-media.persistence'
import {
  ProductMediaService,
  type ProductMediaCommandContext,
} from './product-media.service'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const IMAGE_MEDIA_ID = '33333333-3333-4333-8333-333333333333'
const SECOND_IMAGE_MEDIA_ID = '44444444-4444-4444-8444-444444444444'
const ASSET_ID = '55555555-5555-4555-8555-555555555555'
const SECOND_ASSET_ID = '66666666-6666-4666-8666-666666666666'
const NOW = new Date('2026-08-14T10:00:00.000Z')

const CONTEXT: ProductMediaCommandContext = {
  actorUserId: ACTOR_ID,
  requestId: 'product-media-request-1',
}

function lock(overrides: Partial<ProductMediaProductLock> = {}): ProductMediaProductLock {
  return {
    id: PRODUCT_ID,
    productNo: 'P202608140001',
    status: ProductStatus.INACTIVE,
    version: 1,
    ...overrides,
  }
}

function item(
  overrides: Partial<ProductMediaSnapshotItem> = {},
): ProductMediaSnapshotItem {
  return {
    id: IMAGE_MEDIA_ID,
    isPrimary: false,
    kind: ProductMediaKind.IMAGE,
    mediaAssetId: ASSET_ID,
    sortOrder: 0,
    ...overrides,
  }
}

function prepared(overrides: Partial<PreparedMediaAsset> = {}): PreparedMediaAsset {
  return {
    id: ASSET_ID,
    mediaType: MediaType.IMAGE,
    objectKey: `assets/2026/08/${ASSET_ID}.jpg`,
    trustedMetadata: {
      canonicalExtension: '.jpg',
      checksumSha256: 'a'.repeat(64),
      height: 100,
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      sizeBytes: 3n,
      width: 100,
    },
    ...overrides,
  }
}

interface Fixture {
  readonly activate: jest.Mock
  readonly auditRecord: jest.Mock
  readonly bumpProductVersion: jest.Mock
  readonly createAssociation: jest.Mock
  readonly detachAssociation: jest.Mock
  readonly events: string[]
  readonly fail: jest.Mock
  readonly lockProduct: jest.Mock
  readonly prepare: jest.Mock
  readonly readActiveSnapshot: jest.Mock
  readonly readUploadPreflight: jest.Mock
  readonly service: ProductMediaService
  readonly trashIfUnreferenced: jest.Mock
  readonly writeCompleteLayout: jest.Mock
}

function createFixture(options: {
  readonly auditError?: Error
  readonly lock?: ProductMediaProductLock | null
  readonly preflight?: ProductMediaUploadPreflight | null
  readonly snapshots?: readonly (readonly ProductMediaSnapshotItem[])[]
  readonly retentionResult?: 'ACTIVE_REFERENCE' | 'ISOLATED' | 'TRASHED'
} = {}): Fixture {
  const events: string[] = []
  const transactionClient = {
    $queryRaw: jest.fn().mockImplementation(() => {
      events.push('timeout')
      return Promise.resolve([])
    }),
  } as unknown as Prisma.TransactionClient
  const transaction = jest.fn(
    async (operation: (client: Prisma.TransactionClient) => Promise<unknown>) => {
      events.push('transaction')
      return operation(transactionClient)
    },
  )
  const readUploadPreflight = jest.fn().mockImplementation(() => {
    events.push('product.preflight')
    return Promise.resolve(options.preflight === null
      ? null
      : options.preflight ?? { mediaCount: 0, version: 1 })
  })
  const lockProduct = jest.fn().mockImplementation(() => {
    events.push('product.lock')
    return Promise.resolve(options.lock === null ? null : options.lock ?? lock())
  })
  const snapshots = [...(options.snapshots ?? [[], [item()]])]
  const readActiveSnapshot = jest.fn().mockImplementation(() => {
    events.push('media.snapshot')
    return Promise.resolve(snapshots.shift() ?? [])
  })
  const createAssociation = jest.fn().mockImplementation(() => {
    events.push('media.create')
    return Promise.resolve(IMAGE_MEDIA_ID)
  })
  const writeCompleteLayout = jest.fn().mockImplementation(() => {
    events.push('media.layout')
    return Promise.resolve()
  })
  const detachAssociation = jest.fn().mockImplementation(() => {
    events.push('media.detach')
    return Promise.resolve(true)
  })
  const bumpProductVersion = jest.fn().mockImplementation(() => {
    events.push('product.bump')
    return Promise.resolve(true)
  })
  const persistence = {
    bumpProductVersion,
    createAssociation,
    detachAssociation,
    lockProduct,
    readActiveSnapshot,
    readUploadPreflight,
    writeCompleteLayout,
  } as unknown as ProductMediaPersistence
  const prepareAsset = jest.fn().mockImplementation(() => {
    events.push('asset.prepare')
    return Promise.resolve(prepared())
  })
  const activate = jest.fn().mockImplementation(() => {
    events.push('asset.activate')
    return Promise.resolve()
  })
  const fail = jest.fn().mockImplementation(() => {
    events.push('asset.fail')
    return Promise.resolve()
  })
  const mediaAsset = {
    activate,
    fail,
    prepare: prepareAsset,
  } as unknown as MediaAssetService
  const trashIfUnreferenced = jest.fn().mockImplementation(() => {
    events.push('asset.retention')
    return Promise.resolve(options.retentionResult ?? 'TRASHED')
  })
  const retention = { trashIfUnreferenced } as unknown as MediaAssetRetentionService
  const auditRecord = jest.fn().mockImplementation(() => {
    events.push('audit')
    if (options.auditError !== undefined) {
      return Promise.reject(options.auditError)
    }
    return Promise.resolve({})
  })
  const audit = { record: auditRecord } as unknown as AuditService

  return {
    activate,
    auditRecord,
    bumpProductVersion,
    createAssociation,
    detachAssociation,
    events,
    fail,
    lockProduct,
    prepare: prepareAsset,
    readActiveSnapshot,
    readUploadPreflight,
    service: new ProductMediaService(
      { $transaction: transaction } as unknown as PrismaService,
      persistence,
      mediaAsset,
      retention,
      audit,
      { now: () => new Date(NOW) },
    ),
    trashIfUnreferenced,
    writeCompleteLayout,
  }
}

function upload(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  return fixture.service.upload(CONTEXT, PRODUCT_ID, {
    declaredMimeType: 'image/jpeg',
    expectedVersion: 1,
    kind: ProductMediaKind.IMAGE,
    originalFilename: 'product.jpg',
    stream: Readable.from([Buffer.from('abc')]),
    ...overrides,
  })
}

async function expectApiError(
  operation: Promise<unknown>,
  status: HttpStatus,
  code: string,
): Promise<ApiException> {
  let thrown: unknown
  try {
    await operation
  }
  catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ApiException)
  expect((thrown as ApiException).getStatus()).toBe(status)
  expect((thrown as ApiException).code).toBe(code)
  return thrown as ApiException
}

describe('ProductMediaService', () => {
  it('preflights without a lock, prepares, then locks and atomically activates/links/bumps/audits', async () => {
    const fixture = createFixture()

    await expect(upload(fixture)).resolves.toEqual({
      affectedProductMediaId: IMAGE_MEDIA_ID,
      changed: true,
      items: [item()],
      productId: PRODUCT_ID,
      version: 2,
    })

    expect(fixture.events).toEqual([
      'product.preflight',
      'asset.prepare',
      'transaction',
      'timeout',
      'product.lock',
      'media.snapshot',
      'asset.activate',
      'media.create',
      'product.bump',
      'audit',
      'media.snapshot',
    ])
    expect(fixture.prepare).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: ACTOR_ID,
      allowedTypes: [MediaType.IMAGE, MediaType.VIDEO],
      requestedType: MediaType.IMAGE,
    }))
    expect(fixture.createAssociation).toHaveBeenCalledWith(
      expect.anything(),
      {
        actorUserId: ACTOR_ID,
        kind: ProductMediaKind.IMAGE,
        mediaAssetId: ASSET_ID,
        productId: PRODUCT_ID,
        sortOrder: 0,
      },
    )
    expect(fixture.auditRecord).toHaveBeenCalledWith(
      expect.anything(),
      {
        actorType: AuditActorType.USER,
        actorUserId: ACTOR_ID,
        eventType: AuditEventType.PRODUCT_UPDATED,
        metadata: {
          action: 'UPLOAD_MEDIA',
          changedFields: 'media',
          mediaType: ProductMediaKind.IMAGE,
          previousStatus: ProductStatus.INACTIVE,
          previousVersion: 1,
          productMediaId: IMAGE_MEDIA_ID,
          productNo: 'P202608140001',
          status: ProductStatus.INACTIVE,
          version: 2,
        },
        outcome: AuditOutcome.SUCCESS,
        requestId: CONTEXT.requestId,
        targetId: PRODUCT_ID,
        targetType: 'PRODUCT',
      } satisfies RecordAuditEventInput,
    )
  })

  it('fails the prepared asset when the final Product version changed', async () => {
    const fixture = createFixture({ lock: lock({ version: 2 }) })

    await expectApiError(
      upload(fixture),
      HttpStatus.CONFLICT,
      'PRODUCT_STATE_CHANGED',
    )

    expect(fixture.events).toEqual([
      'product.preflight',
      'asset.prepare',
      'transaction',
      'timeout',
      'product.lock',
      'asset.fail',
    ])
    expect(fixture.fail).toHaveBeenCalledWith(
      ASSET_ID,
      'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED',
    )
  })

  it.each([
    [ProductMediaKind.IMAGE, 20],
    [ProductMediaKind.VIDEO, 5],
  ] as const)('rejects the %s limit in the fast preflight before streaming', async (kind, mediaCount) => {
    const fixture = createFixture({ preflight: { mediaCount, version: 1 } })

    await expectApiError(
      upload(fixture, { kind }),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'PRODUCT_MEDIA_LIMIT_EXCEEDED',
    )

    expect(fixture.prepare).not.toHaveBeenCalled()
    expect(fixture.lockProduct).not.toHaveBeenCalled()
  })

  it('rejects DOCUMENT in the Product service before MediaAsset prepare', async () => {
    const fixture = createFixture()

    await expectApiError(
      upload(fixture, { kind: 'DOCUMENT' }),
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'MEDIA_TYPE_UNSUPPORTED',
    )

    expect(fixture.readUploadPreflight).not.toHaveBeenCalled()
    expect(fixture.prepare).not.toHaveBeenCalled()
  })

  it('rejects a duplicate active asset in the final snapshot and fails the prepared asset', async () => {
    const fixture = createFixture({ snapshots: [[item()]] })

    await expectApiError(
      upload(fixture),
      HttpStatus.CONFLICT,
      'PRODUCT_STATE_CHANGED',
    )

    expect(fixture.activate).not.toHaveBeenCalled()
    expect(fixture.createAssociation).not.toHaveBeenCalled()
    expect(fixture.fail).toHaveBeenCalledWith(
      ASSET_ID,
      'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED',
    )
  })

  it('rechecks the quantity limit after streaming and fails the prepared asset on the final conflict', async () => {
    const finalImages = Array.from({ length: 20 }, (_, index) => item({
      id: `image-${index}`,
      mediaAssetId: `asset-${index}`,
      sortOrder: index,
    }))
    const fixture = createFixture({
      preflight: { mediaCount: 19, version: 1 },
      snapshots: [finalImages],
    })

    await expectApiError(
      upload(fixture),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'PRODUCT_MEDIA_LIMIT_EXCEEDED',
    )

    expect(fixture.prepare).toHaveBeenCalledTimes(1)
    expect(fixture.activate).not.toHaveBeenCalled()
    expect(fixture.fail).toHaveBeenCalledWith(
      ASSET_ID,
      'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED',
    )
  })

  it('rolls back through a fixed internal error and fails the asset when Audit rejects', async () => {
    const sensitiveCanary = '/private/media/product.jpg'
    const fixture = createFixture({ auditError: new Error(sensitiveCanary) })

    const error = await expectApiError(
      upload(fixture),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )

    expect(error.publicMessage).not.toContain(sensitiveCanary)
    expect(fixture.events).toEqual([
      'product.preflight',
      'asset.prepare',
      'transaction',
      'timeout',
      'product.lock',
      'media.snapshot',
      'asset.activate',
      'media.create',
      'product.bump',
      'audit',
      'asset.fail',
    ])
  })

  it('returns a no-op layout snapshot without bumping or auditing', async () => {
    const current = [
      item({ isPrimary: true }),
      item({
        id: SECOND_IMAGE_MEDIA_ID,
        mediaAssetId: SECOND_ASSET_ID,
        sortOrder: 1,
      }),
    ]
    const fixture = createFixture({ snapshots: [current] })

    await expect(fixture.service.updateLayout(CONTEXT, PRODUCT_ID, {
      expectedVersion: 1,
      imageIds: [IMAGE_MEDIA_ID, SECOND_IMAGE_MEDIA_ID],
      primaryImageId: IMAGE_MEDIA_ID,
      videoIds: [],
    })).resolves.toEqual({
      affectedProductMediaId: null,
      changed: false,
      items: current,
      productId: PRODUCT_ID,
      version: 1,
    })

    expect(fixture.writeCompleteLayout).not.toHaveBeenCalled()
    expect(fixture.bumpProductVersion).not.toHaveBeenCalled()
    expect(fixture.auditRecord).not.toHaveBeenCalled()
  })

  it('atomically replaces order/primary from one exact complete layout snapshot', async () => {
    const current = [
      item({ isPrimary: true }),
      item({
        id: SECOND_IMAGE_MEDIA_ID,
        mediaAssetId: SECOND_ASSET_ID,
        sortOrder: 1,
      }),
    ]
    const updated = [
      item({
        id: SECOND_IMAGE_MEDIA_ID,
        isPrimary: true,
        mediaAssetId: SECOND_ASSET_ID,
      }),
      item({ sortOrder: 1 }),
    ]
    const fixture = createFixture({ snapshots: [current, updated] })

    await expect(fixture.service.updateLayout(CONTEXT, PRODUCT_ID, {
      expectedVersion: 1,
      imageIds: [SECOND_IMAGE_MEDIA_ID, IMAGE_MEDIA_ID],
      primaryImageId: SECOND_IMAGE_MEDIA_ID,
      videoIds: [],
    })).resolves.toMatchObject({ changed: true, items: updated, version: 2 })

    expect(fixture.writeCompleteLayout).toHaveBeenCalledWith(
      expect.anything(),
      {
        imageIds: [SECOND_IMAGE_MEDIA_ID, IMAGE_MEDIA_ID],
        items: current,
        primaryImageId: SECOND_IMAGE_MEDIA_ID,
        productId: PRODUCT_ID,
        videoIds: [],
      },
    )
    expect(fixture.auditRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          action: 'UPDATE_MEDIA_LAYOUT',
          changedFields: 'media',
          mediaType: null,
          productMediaId: null,
        }) as unknown,
      }),
    )
  })

  it('rejects an incomplete layout and a video primary as layout conflicts', async () => {
    const videoId = '77777777-7777-4777-8777-777777777777'
    const current = [
      item(),
      item({
        id: videoId,
        kind: ProductMediaKind.VIDEO,
        mediaAssetId: SECOND_ASSET_ID,
      }),
    ]
    const incomplete = createFixture({ snapshots: [current] })
    await expectApiError(
      incomplete.service.updateLayout(CONTEXT, PRODUCT_ID, {
        expectedVersion: 1,
        imageIds: [IMAGE_MEDIA_ID],
        primaryImageId: null,
        videoIds: [],
      }),
      HttpStatus.CONFLICT,
      'PRODUCT_MEDIA_LAYOUT_CHANGED',
    )

    const videoPrimary = createFixture({ snapshots: [current] })
    await expectApiError(
      videoPrimary.service.updateLayout(CONTEXT, PRODUCT_ID, {
        expectedVersion: 1,
        imageIds: [IMAGE_MEDIA_ID],
        primaryImageId: videoId,
        videoIds: [videoId],
      }),
      HttpStatus.CONFLICT,
      'PRODUCT_MEDIA_LAYOUT_CHANGED',
    )
  })

  it('soft-detaches the primary, keeps no automatic replacement and audits before retention', async () => {
    const current = [
      item({ isPrimary: true }),
      item({
        id: SECOND_IMAGE_MEDIA_ID,
        mediaAssetId: SECOND_ASSET_ID,
        sortOrder: 1,
      }),
    ]
    const remaining = [
      item({
        id: SECOND_IMAGE_MEDIA_ID,
        mediaAssetId: SECOND_ASSET_ID,
        sortOrder: 0,
      }),
    ]
    const fixture = createFixture({ snapshots: [current, remaining] })

    await expect(fixture.service.detach(CONTEXT, PRODUCT_ID, IMAGE_MEDIA_ID, {
      expectedVersion: 1,
    })).resolves.toEqual({
      affectedProductMediaId: IMAGE_MEDIA_ID,
      changed: true,
      items: remaining,
      productId: PRODUCT_ID,
      version: 2,
    })

    expect(fixture.events).toEqual([
      'transaction',
      'timeout',
      'product.lock',
      'media.snapshot',
      'media.detach',
      'media.layout',
      'product.bump',
      'audit',
      'asset.retention',
      'media.snapshot',
    ])
    expect(fixture.writeCompleteLayout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        imageIds: [SECOND_IMAGE_MEDIA_ID],
        primaryImageId: null,
        videoIds: [],
      }),
    )
  })

  it('fails closed when the detached asset cannot safely enter retention', async () => {
    const fixture = createFixture({
      retentionResult: 'ISOLATED',
      snapshots: [[item()]],
    })

    await expectApiError(
      fixture.service.detach(CONTEXT, PRODUCT_ID, IMAGE_MEDIA_ID, {
        expectedVersion: 1,
      }),
      HttpStatus.SERVICE_UNAVAILABLE,
      'MEDIA_STORAGE_UNAVAILABLE',
    )

    // mock 不模拟数据库 rollback；真实事务会回滚此前的 version 与 Audit 写入。
    expect(fixture.bumpProductVersion).toHaveBeenCalledTimes(1)
    expect(fixture.auditRecord).toHaveBeenCalledTimes(1)
  })
})
