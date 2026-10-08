import { createPaymentRecipientFixture } from './fixtures/payment-recipient.fixture'
import { mkdtemp, mkdir, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'

import type { MediaConfiguration } from '../src/config/media.config'
import type { AuditService } from '../src/modules/audit/audit.service'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { LocalMediaStorage } from '../src/modules/media/local-media-storage'
import { MediaAssetPersistence } from '../src/modules/media/media-asset.persistence'
import { MediaAssetService } from '../src/modules/media/media-asset.service'
import { MediaContentDeliveryService } from '../src/modules/media/media-content-delivery.service'
import { MediaContentValidator } from '../src/modules/media/media-content-validator'
import { MediaReconciliationPersistence } from '../src/modules/media/media-reconciliation.persistence'
import { MediaReconciliationService } from '../src/modules/media/media-reconciliation.service'
import { MediaAssetReferenceRepository } from '../src/modules/media/media-reference.repository'
import { MediaAssetRetentionService } from '../src/modules/media/media-retention.service'
import { PurchaseOrderImageDraftService } from '../src/modules/purchase-orders/order-images/purchase-order-image-draft.service'
import type { PurchaseOrderImageRenderer } from '../src/modules/purchase-orders/order-images/purchase-order-image-renderer'
import { PurchaseOrderMutationService } from '../src/modules/purchase-orders/purchase-order-mutation.service'
import { PurchasePayableService } from '../src/modules/purchase-orders/payables/purchase-payable.service'
import { FundPostingApplicationService } from '../src/modules/fund-accounts/application/fund-posting.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseOrderWarehouseReceiptService } from '../src/modules/purchase-orders/warehouse-receipts/purchase-order-warehouse-receipt.service'
import type { AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

async function detectFixturePng(sourcePath: string) {
  const handle = await open(sourcePath, 'r')
  try {
    const signature = Buffer.alloc(8)
    await handle.read(signature, 0, 8, 0)
    return signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? { ext: 'png', mime: 'image/png' } : undefined
  }
  finally { await handle.close() }
}

/** 只替代单据排版器；媒体完整解码、文件存储、数据库引用、派号和审核全部使用正式实现。 */
export async function createPurchaseOrderImageFixture(fixture: AtomicityFixture) {
  const sandbox = await mkdtemp(join(tmpdir(), 'qianshu-order-image-e2e-'))
  const storageRoot = join(sandbox, 'media')
  await mkdir(storageRoot, { mode: 0o750 })
  const configuration: MediaConfiguration = { contentDeliveryMode: 'application', driver: 'local', ffmpegPath: '/usr/bin/ffmpeg', ffprobePath: '/usr/bin/ffprobe', qpdfPath: '/usr/bin/qpdf', stagingTtlHours: 24, storageEnvironment: 'dev', storageRoot, trashRetentionDays: 7 }
  const storage = await LocalMediaStorage.create(configuration, { forbiddenRoots: [] })
  const media = new MediaAssetService(new MediaAssetPersistence(fixture.prisma), storage, new MediaContentValidator(configuration, {
    // Jest 29 无法解析 ESM-only file-type@21；只替代魔数探测，sharp 完整解码及 SHA 校验仍使用生产代码。
    detectFileType: detectFixturePng,
  }), configuration)
  const delivery = new MediaContentDeliveryService(storage, 'application')
  const references = new MediaAssetReferenceRepository()
  const persistence = new MediaReconciliationPersistence(fixture.prisma)
  const retention = new MediaAssetRetentionService(persistence, references, storage, configuration)
  const lookup = new DictionaryLookupService(fixture.prisma)
  const query = new PurchaseOrderQueryService(fixture.prisma, lookup, createPaymentRecipientFixture(fixture.prisma))
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const renderer = { render: jest.fn<Promise<Buffer>, [unknown, unknown]>().mockResolvedValue(png) }
  const buildDrafts = (audit: AuditService = fixture.audit) => new PurchaseOrderImageDraftService(fixture.prisma, query, renderer as unknown as PurchaseOrderImageRenderer, media, delivery, retention, audit)
  const drafts = buildDrafts()
  const buildMutations = (imageDrafts = drafts, audit: AuditService = fixture.audit) => new PurchaseOrderMutationService(
    fixture.prisma, audit, lookup, media, query, fixture.salesProgress, fixture.numbering, fixture.resolver,
    new PurchaseOrderWarehouseReceiptService(fixture.prisma, audit, query), imageDrafts,
    new PurchasePayableService(new FundPostingApplicationService(fixture.prisma, audit), fixture.access, createPaymentRecipientFixture(fixture.prisma)),
  )
  return {
    storage, media, delivery, references, retention, query, png, renderer, drafts, buildDrafts, buildMutations,
    reconciliation: new MediaReconciliationService(persistence, references, storage, 'dev'),
    async dispose() { await rm(sandbox, { recursive: true, force: true }) },
  }
}

export type PurchaseOrderImageFixture = Awaited<ReturnType<typeof createPurchaseOrderImageFixture>>
