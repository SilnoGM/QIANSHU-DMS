import type { Prisma } from '../../generated/prisma/client'
import {
  MEDIA_STORAGE_POOLS,
  type MediaStoragePool,
} from './media-object-key'
import {
  MediaKeyMigrationService,
  resolveMediaStoragePool,
  type MediaKeyMigrationDatabase,
  type MediaKeyMigrationScanRow,
  type MediaKeyMigrationSqlClient,
  type MediaKeyMigrationStorage,
  type MediaKeyPoolFacts,
} from './media-key-migration.service'

const ENVIRONMENT = 'prod'
const ASSET_ID = '00000000-0000-4000-8000-000000000321'
const OTHER_ASSET_ID = '00000000-0000-4000-8000-000000000322'
const STRUCTURED_ASSET_ID = '00000000-0000-4000-8000-000000000323'
const CHECKSUM = 'a'.repeat(64)
const SIZE_BYTES = 321n

const NO_REFERENCE_FACTS: MediaKeyPoolFacts = {
  billSourceFile: false,
  containerSourceFile: false,
  invoiceRequestDocument: false,
  packagingImage: false,
  packagingPaymentVoucher: false,
  paymentRecipientQr: false,
  productMedia: false,
  purchaseDocument: false,
  purchaseDocumentVoucher: false,
  purchaseImageDraft: false,
  salesDocument: false,
  salesDocumentVoucher: false,
  salesReceiptVoucher: false,
  uploadPurpose: null,
}

function scanRow(
  assetId: string,
  objectKey: string,
  facts: Partial<MediaKeyPoolFacts> = {},
): MediaKeyMigrationScanRow {
  return {
    ...NO_REFERENCE_FACTS,
    ...facts,
    assetId,
    checksumSha256: CHECKSUM,
    objectKey,
    sizeBytes: SIZE_BYTES,
  }
}

interface RegistrationRecord {
  readonly assetId: string
  readonly newKey: string
  readonly oldKey: string
  appliedAt: Date | null
}

interface FakeDatabaseOptions {
  readonly assets?: readonly {
    readonly assetId: string
    readonly objectKey: string
    readonly sizeBytes: bigint
  }[]
  readonly registrations?: readonly {
    readonly applied?: boolean
    readonly assetId: string
    readonly newKey: string
    readonly oldKey: string
  }[]
  readonly scanPages?: readonly (readonly MediaKeyMigrationScanRow[])[]
}

/**
 * 内存替身：按 SQL 文本分派，模拟登记表的 ON CONFLICT DO NOTHING、带 `object_key` 守卫的
 * UPDATE 以及按 `applied_at IS NULL` 取待应用行，让幂等与并发守卫可以被真实驱动。
 *
 * 参数位置按被测语句的模板顺序读取：它是被测语句的一部分，语句改了参数顺序这里也会立刻反映出来。
 */
class FakeKeyMigrationDatabase implements MediaKeyMigrationDatabase {
  readonly assetKeys = new Map<string, string>()
  readonly assetSizes = new Map<string, bigint>()
  readonly calls: { readonly inTransaction: boolean, readonly query: Prisma.Sql }[] = []
  readonly registrations = new Map<string, RegistrationRecord>()
  transactionCount = 0
  private readonly scanPages: (readonly MediaKeyMigrationScanRow[])[]
  private scanIndex = 0
  private transactionDepth = 0

  constructor(options: FakeDatabaseOptions = {}) {
    for (const asset of options.assets ?? []) {
      this.assetKeys.set(asset.assetId, asset.objectKey)
      this.assetSizes.set(asset.assetId, asset.sizeBytes)
    }
    for (const record of options.registrations ?? []) {
      this.registrations.set(record.assetId, {
        appliedAt: record.applied === true ? new Date('2026-10-07T00:00:00.000Z') : null,
        assetId: record.assetId,
        newKey: record.newKey,
        oldKey: record.oldKey,
      })
    }
    this.scanPages = [...(options.scanPages ?? [])]
  }

  $queryRaw<T>(query: Prisma.Sql): Promise<T> {
    this.calls.push({ inTransaction: this.transactionDepth > 0, query })
    const text = query.text
    let rows: unknown
    if (text.includes('FROM "media_assets" AS "asset"')) {
      rows = this.readScanPage()
    }
    else if (text.includes('INSERT INTO "media_object_key_migrations"')) {
      rows = this.insertRegistrations(query)
    }
    else if (text.includes('UPDATE "media_assets"')) {
      rows = this.updateObjectKey(query)
    }
    else if (text.includes('UPDATE "media_object_key_migrations"')) {
      rows = this.markApplied(query)
    }
    else if (text.includes('"asset_id" IN (')) {
      rows = this.readRegistrations(query)
    }
    else if (text.includes('"applied_at" IS NULL')) {
      rows = this.readPendingRegistrations(query)
    }
    else if (text.includes('count(*)')) {
      rows = this.countRegistrations()
    }
    else {
      return Promise.reject(new Error('fake: unexpected query'))
    }
    return Promise.resolve(rows as T)
  }

  async $transaction<T>(
    operation: (transaction: MediaKeyMigrationSqlClient) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1
    this.transactionDepth += 1
    try {
      return await operation(this)
    }
    finally {
      this.transactionDepth -= 1
    }
  }

  pendingRegistrations(): readonly RegistrationRecord[] {
    return [...this.registrations.values()].filter(record => record.appliedAt === null)
  }

  private readScanPage(): readonly MediaKeyMigrationScanRow[] {
    const page = this.scanPages[this.scanIndex] ?? []
    this.scanIndex += 1
    return page
  }

  private insertRegistrations(query: Prisma.Sql): readonly { assetId: string }[] {
    const values = query.values as readonly string[]
    const inserted: { assetId: string }[] = []
    for (let index = 0; index + 2 < values.length; index += 3) {
      const assetId = values[index]
      if (assetId === undefined || this.registrations.has(assetId)) continue
      this.registrations.set(assetId, {
        appliedAt: null,
        assetId,
        newKey: values[index + 2] ?? '',
        oldKey: values[index + 1] ?? '',
      })
      inserted.push({ assetId })
    }
    return inserted
  }

  private readRegistrations(query: Prisma.Sql): readonly RegistrationRecord[] {
    return (query.values as readonly string[])
      .map(assetId => this.registrations.get(assetId))
      .filter((record): record is RegistrationRecord => record !== undefined)
  }

  private readPendingRegistrations(
    query: Prisma.Sql,
  ): readonly (RegistrationRecord & { readonly sizeBytes: bigint | null })[] {
    const limit = query.values[0] as number
    return [...this.registrations.values()]
      .filter(record => record.appliedAt === null)
      .sort((left, right) => left.assetId.localeCompare(right.assetId))
      .slice(0, limit)
      .map(record => ({
        ...record,
        sizeBytes: this.assetSizes.get(record.assetId) ?? null,
      }))
  }

  private updateObjectKey(query: Prisma.Sql): readonly { assetId: string }[] {
    const [newKey, assetId, oldKey] = query.values as readonly string[]
    if (assetId === undefined || this.assetKeys.get(assetId) !== oldKey) return []
    this.assetKeys.set(assetId, newKey ?? '')
    return [{ assetId }]
  }

  private markApplied(query: Prisma.Sql): readonly { assetId: string }[] {
    const [assetId] = query.values as readonly string[]
    const record = assetId === undefined ? undefined : this.registrations.get(assetId)
    if (record === undefined || record.appliedAt !== null) return []
    record.appliedAt = new Date('2026-10-07T00:00:00.000Z')
    return [{ assetId: record.assetId }]
  }

  private countRegistrations(): readonly { applied: number, registered: number }[] {
    const records = [...this.registrations.values()]
    return [{
      applied: records.filter(record => record.appliedAt !== null).length,
      registered: records.length,
    }]
  }
}

/** 目标对象核对端口：`objects` 是「桶里已存在的对象」，只记录长度。 */
class FakeKeyMigrationStorage implements MediaKeyMigrationStorage {
  readonly objects = new Map<string, bigint>()
  readonly stats: string[] = []

  stat(key: string): Promise<{ readonly sizeBytes: bigint } | null> {
    this.stats.push(key)
    const sizeBytes = this.objects.get(key)
    return Promise.resolve(sizeBytes === undefined ? null : { sizeBytes })
  }
}

function createService(
  database: FakeKeyMigrationDatabase,
  storage: FakeKeyMigrationStorage = new FakeKeyMigrationStorage(),
): MediaKeyMigrationService {
  return new MediaKeyMigrationService({
    database,
    storage,
    storageEnvironment: ENVIRONMENT,
  })
}

function queryFor(
  database: FakeKeyMigrationDatabase,
  marker: string,
): Prisma.Sql | undefined {
  return database.calls.find(call => call.query.text.includes(marker))?.query
}

describe('MediaKeyMigrationService.planCandidates', () => {
  it('selects legacy keys and skips rows that already use the structured layout', async () => {
    const database = new FakeKeyMigrationDatabase({
      scanPages: [[
        scanRow(ASSET_ID, `assets/2026/08/${ASSET_ID}.webp`, { productMedia: true }),
        scanRow(STRUCTURED_ASSET_ID, `assets/prod/product/2026/08/${STRUCTURED_ASSET_ID}.webp`),
        scanRow(OTHER_ASSET_ID, 'not-a-managed-key'),
      ]],
    })

    const plan = await createService(database).planCandidates()

    expect(plan.scanned).toBe(3)
    expect(plan.candidates.map(candidate => candidate.assetId)).toEqual([ASSET_ID])
  })

  it('walks every scan page with an id cursor instead of stopping at the first one', async () => {
    const database = new FakeKeyMigrationDatabase({
      scanPages: [
        [scanRow(ASSET_ID, `assets/2026/08/${ASSET_ID}.webp`, { productMedia: true })],
        [scanRow(OTHER_ASSET_ID, `assets/2026/08/${OTHER_ASSET_ID}.webp`, { productMedia: true })],
      ],
    })

    const plan = await createService(database).planCandidates({ pageSize: 1 })

    expect(plan.scanned).toBe(2)
    expect(plan.candidates).toHaveLength(2)
    const scanQueries = database.calls.filter(
      call => call.query.text.includes('FROM "media_assets" AS "asset"'),
    )
    // 两页各一行，第三页为空页收尾；第二页必须带上第一页末行的 id 游标。
    expect(scanQueries).toHaveLength(3)
    expect(scanQueries[1]?.query.values).toContain(ASSET_ID)
    expect(scanQueries[0]?.query.values).not.toContain(ASSET_ID)
  })

  it('keeps namespace, year and extension of the legacy key and inserts environment and pool', async () => {
    const database = new FakeKeyMigrationDatabase({
      scanPages: [[
        scanRow(ASSET_ID, `assets/2026/08/${ASSET_ID}.webp`, { productMedia: true }),
        scanRow(OTHER_ASSET_ID, `trash/2026/07/${OTHER_ASSET_ID}.xlsx`, {
          containerSourceFile: true,
        }),
      ]],
    })

    const plan = await createService(database).planCandidates()

    expect(plan.candidates).toEqual([
      {
        assetId: ASSET_ID,
        checksumSha256: CHECKSUM,
        newKey: `assets/prod/product/2026/08/${ASSET_ID}.webp`,
        oldKey: `assets/2026/08/${ASSET_ID}.webp`,
        sizeBytes: SIZE_BYTES,
      },
      {
        assetId: OTHER_ASSET_ID,
        checksumSha256: CHECKSUM,
        newKey: `trash/prod/container/2026/07/${OTHER_ASSET_ID}.xlsx`,
        oldKey: `trash/2026/07/${OTHER_ASSET_ID}.xlsx`,
        sizeBytes: SIZE_BYTES,
      },
    ])
  })
})

describe('resolveMediaStoragePool', () => {
  const RULE_SAMPLES: [string, Partial<MediaKeyPoolFacts>, MediaStoragePool][] = [
    ['product_media.media_asset_id', { productMedia: true }, 'product'],
    ['sales_receipt_requests.voucher_media_asset_id', { salesReceiptVoucher: true }, 'voucher'],
    ['sales_order_documents PAYMENT_VOUCHER', { salesDocumentVoucher: true }, 'voucher'],
    ['sales_order_documents 其它类型', { salesDocument: true }, 'sales'],
    ['purchase_order_documents PAYMENT_VOUCHER', { purchaseDocumentVoucher: true }, 'voucher'],
    ['purchase_order_documents 其它类型', { purchaseDocument: true }, 'purchase'],
    ['purchase_order_image_drafts.media_asset_id', { purchaseImageDraft: true }, 'purchase'],
    [
      'packaging_cost_requests.payment_voucher_media_asset_id',
      { packagingPaymentVoucher: true },
      'voucher',
    ],
    ['packaging_cost_requests 包装图与报价图', { packagingImage: true }, 'packaging'],
    ['收款码三列', { paymentRecipientQr: true }, 'payment-recipient'],
    ['container_batches.source_file_id', { containerSourceFile: true }, 'container'],
    ['slh_bills.source_file_id', { billSourceFile: true }, 'bill'],
    ['invoice_requests.document_media_asset_id', { invoiceRequestDocument: true }, 'invoice'],
    ['uploadPurpose=INVOICE_REQUEST_DOCUMENT', { uploadPurpose: 'INVOICE_REQUEST_DOCUMENT' }, 'invoice'],
    [
      'uploadPurpose=PURCHASE_PAYMENT_VOUCHER',
      { uploadPurpose: 'PURCHASE_PAYMENT_VOUCHER' },
      'voucher',
    ],
    [
      'uploadPurpose=PACKAGING_PAYMENT_VOUCHER',
      { uploadPurpose: 'PACKAGING_PAYMENT_VOUCHER' },
      'voucher',
    ],
    [
      'uploadPurpose=PAYMENT_RECIPIENT_QR',
      { uploadPurpose: 'PAYMENT_RECIPIENT_QR' },
      'payment-recipient',
    ],
    ['uploadPurpose=SLH_BILL_SOURCE_XLSX', { uploadPurpose: 'SLH_BILL_SOURCE_XLSX' }, 'bill'],
    [
      'uploadPurpose=OCEAN_FREIGHT_SOURCE_XLSX',
      { uploadPurpose: 'OCEAN_FREIGHT_SOURCE_XLSX' },
      'container',
    ],
    ['无引用且无 uploadPurpose', {}, 'misc'],
    ['未知 uploadPurpose', { uploadPurpose: 'SOMETHING_ELSE' }, 'misc'],
  ]

  it.each(RULE_SAMPLES)('maps %s to the expected pool', (_label, facts, expected) => {
    expect(resolveMediaStoragePool({ ...NO_REFERENCE_FACTS, ...facts })).toBe(expected)
    expect(MEDIA_STORAGE_POOLS).toContain(expected)
  })

  const PRECEDENCE_SAMPLES: [string, Partial<MediaKeyPoolFacts>, MediaStoragePool][] = [
    [
      '同一采购单表的凭证列先于普通单据列',
      { purchaseDocument: true, purchaseDocumentVoucher: true },
      'voucher',
    ],
    [
      '同一销售单表的凭证列先于普通单据列',
      { salesDocument: true, salesDocumentVoucher: true },
      'voucher',
    ],
    [
      '打木架付款截图先于打木架图片',
      { packagingImage: true, packagingPaymentVoucher: true },
      'voucher',
    ],
    [
      '商品图片先于所有业务单据',
      { productMedia: true, purchaseDocument: true, salesDocument: true },
      'product',
    ],
    [
      '引用列先于 uploadPurpose',
      { salesDocument: true, uploadPurpose: 'PAYMENT_RECIPIENT_QR' },
      'sales',
    ],
    [
      '靠前的引用列先于靠后的引用列',
      { containerSourceFile: true, uploadPurpose: 'PURCHASE_PAYMENT_VOUCHER' },
      'container',
    ],
  ]

  it.each(PRECEDENCE_SAMPLES)('applies the documented order: %s', (_label, facts, expected) => {
    expect(resolveMediaStoragePool({ ...NO_REFERENCE_FACTS, ...facts })).toBe(expected)
  })
})

describe('MediaKeyMigrationService.registerPlan', () => {
  const planned = {
    assetId: ASSET_ID,
    checksumSha256: CHECKSUM,
    newKey: `assets/prod/product/2026/08/${ASSET_ID}.webp`,
    oldKey: `assets/2026/08/${ASSET_ID}.webp`,
    sizeBytes: SIZE_BYTES,
  }

  it('registers the plan idempotently with bound parameters and ON CONFLICT DO NOTHING', async () => {
    const database = new FakeKeyMigrationDatabase({})
    const service = createService(database)

    await expect(service.registerPlan([planned])).resolves.toEqual({
      conflicts: 0,
      registered: 1,
    })
    await expect(service.registerPlan([planned])).resolves.toEqual({
      conflicts: 0,
      registered: 0,
    })

    const insert = queryFor(database, 'INSERT INTO "media_object_key_migrations"')
    expect(insert?.text).toContain('ON CONFLICT ("asset_id") DO NOTHING')
    expect(insert?.values).toEqual([ASSET_ID, planned.oldKey, planned.newKey])
    // 键对与标识只走绑定参数：语句文本里不得出现它们。
    expect(insert?.text).not.toContain(planned.oldKey)
    expect(insert?.text).not.toContain(ASSET_ID)
  })

  it('keeps the registration when the same asset is registered with the identical pair', async () => {
    const database = new FakeKeyMigrationDatabase({ registrations: [planned] })

    await expect(createService(database).registerPlan([planned])).resolves.toEqual({
      conflicts: 0,
      registered: 0,
    })
    expect(database.registrations.size).toBe(1)
  })

  it('refuses the whole plan when an asset is already registered with another pair', async () => {
    const database = new FakeKeyMigrationDatabase({
      registrations: [{
        assetId: ASSET_ID,
        newKey: `assets/dev/product/2026/08/${ASSET_ID}.webp`,
        oldKey: planned.oldKey,
      }],
    })

    await expect(createService(database).registerPlan([planned])).resolves.toEqual({
      conflicts: 1,
      registered: 0,
    })
    // 拒绝意味着不写入：既有登记行保持原样，不会与本次计划混在一起。
    expect(queryFor(database, 'INSERT INTO "media_object_key_migrations"')).toBeUndefined()
    expect(database.registrations.get(ASSET_ID)?.newKey)
      .toBe(`assets/dev/product/2026/08/${ASSET_ID}.webp`)
  })
})

describe('MediaKeyMigrationService.applyBatch', () => {
  const oldKey = `assets/2026/08/${ASSET_ID}.webp`
  const newKey = `assets/prod/product/2026/08/${ASSET_ID}.webp`
  const otherOldKey = `assets/2026/08/${OTHER_ASSET_ID}.webp`
  const otherNewKey = `assets/prod/product/2026/08/${OTHER_ASSET_ID}.webp`

  function createApplyFixture(options: {
    readonly assetKey?: string
    readonly targetSize?: bigint | null
  } = {}) {
    const storage = new FakeKeyMigrationStorage()
    const targetSize = options.targetSize === undefined ? SIZE_BYTES : options.targetSize
    // 目标键上的对象：null 表示桶里还没有副本，其余表示已存在且长度已知。
    if (targetSize !== null) storage.objects.set(newKey, targetSize)
    const database = new FakeKeyMigrationDatabase({
      assets: [{
        assetId: ASSET_ID,
        objectKey: options.assetKey ?? oldKey,
        sizeBytes: SIZE_BYTES,
      }],
      registrations: [{ assetId: ASSET_ID, newKey, oldKey }],
    })
    return { database, service: createService(database, storage), storage }
  }

  it('rewrites the key inside one transaction and marks the registration as applied', async () => {
    const fixture = createApplyFixture()

    await expect(fixture.service.applyBatch(500)).resolves.toEqual({
      applied: 1,
      missingTarget: 0,
      skipped: 0,
    })

    expect(fixture.database.assetKeys.get(ASSET_ID)).toBe(newKey)
    expect(fixture.database.registrations.get(ASSET_ID)?.appliedAt).not.toBeNull()
    expect(fixture.database.transactionCount).toBe(1)
    expect(fixture.database.calls.every(call => call.inTransaction)).toBe(true)
  })

  it('guards the rewrite with the registered old key', async () => {
    const fixture = createApplyFixture()

    await fixture.service.applyBatch(500)

    const update = queryFor(fixture.database, 'UPDATE "media_assets"')
    expect(update?.text).toContain('AND "object_key" = ')
    expect(update?.values).toEqual([newKey, ASSET_ID, oldKey])
    expect(update?.text).not.toContain(oldKey)
  })

  it('leaves the key alone when the target object is missing', async () => {
    const fixture = createApplyFixture({ targetSize: null })

    await expect(fixture.service.applyBatch(500)).resolves.toEqual({
      applied: 0,
      missingTarget: 1,
      skipped: 0,
    })

    // 缺失目标只登记事实、不写数据库：键保持旧值，登记行仍是 pending。
    expect(fixture.database.assetKeys.get(ASSET_ID)).toBe(oldKey)
    expect(fixture.database.registrations.get(ASSET_ID)?.appliedAt).toBeNull()
    expect(queryFor(fixture.database, 'UPDATE "media_assets"')).toBeUndefined()
    expect(fixture.storage.stats).toContain(newKey)
  })

  it('leaves the key alone when the target object has a different length', async () => {
    const fixture = createApplyFixture({ targetSize: SIZE_BYTES + 1n })

    await expect(fixture.service.applyBatch(500)).resolves.toEqual({
      applied: 0,
      missingTarget: 1,
      skipped: 0,
    })

    expect(fixture.database.assetKeys.get(ASSET_ID)).toBe(oldKey)
    expect(fixture.database.registrations.get(ASSET_ID)?.appliedAt).toBeNull()
    expect(queryFor(fixture.database, 'UPDATE "media_assets"')).toBeUndefined()
  })

  it('skips a registration whose key already drifted and leaves it pending', async () => {
    const fixture = createApplyFixture({ assetKey: otherOldKey })

    await expect(fixture.service.applyBatch(500)).resolves.toEqual({
      applied: 0,
      missingTarget: 0,
      skipped: 1,
    })
    // 未真正改键就不能标记已应用：登记行保持 pending，人工核对后仍可重跑。
    expect(fixture.database.registrations.get(ASSET_ID)?.appliedAt).toBeNull()
    expect(fixture.database.pendingRegistrations()).toHaveLength(1)
  })

  it('applies at most the requested number of rows per batch', async () => {
    const storage = new FakeKeyMigrationStorage()
    storage.objects.set(newKey, SIZE_BYTES)
    storage.objects.set(otherNewKey, SIZE_BYTES)
    const database = new FakeKeyMigrationDatabase({
      assets: [
        { assetId: ASSET_ID, objectKey: oldKey, sizeBytes: SIZE_BYTES },
        { assetId: OTHER_ASSET_ID, objectKey: otherOldKey, sizeBytes: SIZE_BYTES },
      ],
      registrations: [
        { assetId: ASSET_ID, newKey, oldKey },
        { assetId: OTHER_ASSET_ID, newKey: otherNewKey, oldKey: otherOldKey },
      ],
    })

    const result = await createService(database, storage).applyBatch(1)

    expect(result).toEqual({ applied: 1, missingTarget: 0, skipped: 0 })
    expect(queryFor(database, '"applied_at" IS NULL')?.values).toEqual([1])
    expect(database.pendingRegistrations()).toHaveLength(1)
  })
})

describe('MediaKeyMigrationService.previewSummary', () => {
  it('reports candidates, registered and applied counts without writing anything', async () => {
    const database = new FakeKeyMigrationDatabase({
      registrations: [
        { applied: true, assetId: ASSET_ID, newKey: 'a', oldKey: 'b' },
        { assetId: OTHER_ASSET_ID, newKey: 'c', oldKey: 'd' },
      ],
      scanPages: [[
        scanRow(ASSET_ID, `assets/2026/08/${ASSET_ID}.webp`, { productMedia: true }),
        scanRow(STRUCTURED_ASSET_ID, `assets/prod/product/2026/08/${STRUCTURED_ASSET_ID}.webp`),
      ]],
    })

    await expect(createService(database).previewSummary()).resolves.toEqual({
      alreadyRegistered: 2,
      applied: 1,
      candidates: 1,
      // 唯一的候选是 product 池：分布要与候选清单同源，而不是另写一套判定。
      pools: { product: 1 },
    })

    expect(database.calls.filter(call => call.query.text.includes('INSERT'))).toEqual([])
    expect(database.calls.filter(call => call.query.text.includes('UPDATE'))).toEqual([])
    expect(database.transactionCount).toBe(0)
    expect(database.pendingRegistrations()).toHaveLength(1)
  })
})
