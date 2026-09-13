import { ensureReceiptNumberingRule } from './fixtures/sales-receipt-numbering-service.fixture'
import { SalesReceiptService } from '../src/modules/sales-orders/receipts/sales-receipt.service'
import { SalesReceiptQueryService } from '../src/modules/sales-orders/receipts/sales-receipt-query.service'
import { FundPostingApplicationService } from '../src/modules/fund-accounts/application/fund-posting.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import type { MediaContentDeliveryService } from '../src/modules/media/media-content-delivery.service'
import { randomUUID } from 'node:crypto'


import type { Prisma } from '../src/generated/prisma/client'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import type { AccessControlService } from '../src/modules/access-control/access-control.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import type { MediaAssetService } from '../src/modules/media/media-asset.service'
import { NumberingGeneratorService } from '../src/modules/numbering/numbering-generator.service'
import { PurchaseShippingMarkResolverService } from '../src/modules/purchase-shipping-marks/purchase-shipping-mark-resolver.service'
import { IsolatedNumberingPrismaService, type IsolatedNumberingDatabase } from './numbering-e2e-database'
import { createPurchaseShippingMarkDatabase, createTestShippingMarkRule } from './purchase-shipping-mark-e2e-database'
import { PurchaseOrderCommandService } from '../src/modules/purchase-orders/purchase-order-command.service'
import { PurchaseOrderCreateDependencyService } from '../src/modules/purchase-orders/purchase-order-create-dependency.service'
import { PurchaseOrderFactoryShipmentService } from '../src/modules/purchase-orders/factory-shipments/purchase-order-factory-shipment.service'
import { PurchaseOrderMutationService } from '../src/modules/purchase-orders/purchase-order-mutation.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseOrderSourceQueryService } from '../src/modules/purchase-orders/purchase-order-source-query.service'
import { SalesOrderPurchaseCoverageService } from '../src/modules/purchase-orders/sales-order-purchase-coverage.service'
import { SalesOrderCommandService } from '../src/modules/sales-orders/sales-order-command.service'
import { SalesOrderAutomaticStateService } from '../src/modules/sales-orders/sales-order-automatic-state.service'
import { SalesOrderProductEditQueryService } from '../src/modules/sales-orders/sales-order-product-edit-query.service'
import { SalesOrderProductEditService } from '../src/modules/sales-orders/sales-order-product-edit.service'
import { SalesOrderQueryService } from '../src/modules/sales-orders/sales-order-query.service'


/** 查询上下文按数据库精度返回四位小数；修改命令仍遵守销售录入最多两位小数的契约。 */
function amountInputFromSnapshot(value: string): string {
  const separator = value.indexOf('.')
  if (separator < 0) return value
  const integer = value.slice(0, separator)
  const fraction = value.slice(separator + 1).replace(/0+$/u, '')
  return fraction === '' ? integer : `${integer}.${fraction}`
}

/** 审计 metadata 来自 JSONB；先收窄成对象，再比较领域字段，避免测试 matcher 污染类型。 */
function expectAuditMetadata(
  value: Prisma.JsonValue,
  expected: Readonly<Record<string, string | number | boolean>>,
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Audit metadata must be a JSON object')
  }
  expect(value).toMatchObject(expected)
}

/** JSONB 查询未声明排序时不保证返回顺序，审计断言必须按领域内容定位目标事件。 */
function auditMetadataMatches(
  value: Prisma.JsonValue,
  expected: Readonly<Record<string, string | number | boolean>>,
): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  return Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue)
}

describe('PurchaseOrder services with isolated PostgreSQL', () => {
  jest.setTimeout(60_000)

  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
  const username = `purchase-service-e2e-${suffix.toLowerCase()}`
  const supplierValue = `PUR-SUPPLIER-${suffix}`
  let actorUserId: string
  let cityId: string
  let concurrentDistinctSourceAId: string
  let concurrentDistinctSourceBId: string
  let countryRegionId: string
  let issuanceVoucherMediaAssetId: string
  let paymentVoucherMediaAssetId: string
  const purchaseVoucherMediaAssetIds: string[] = []
  let productId: string
  let provinceStateId: string
  let salesOrderId: string
  let splitSourceLineId: string
  let concurrentSourceLineId: string
  let customSourceLineId: string
  let database: IsolatedNumberingDatabase
  let catalogResolution: string
  let customResolution: string
  let prisma: PrismaService
  let commands: PurchaseOrderCommandService
  let factoryShipments: PurchaseOrderFactoryShipmentService
  let mutations: PurchaseOrderMutationService
  let queries: PurchaseOrderQueryService
  let sourceQueries: PurchaseOrderSourceQueryService
  let productEdits: SalesOrderProductEditService
  let productEditQueries: SalesOrderProductEditQueryService
  let salesReceipts: SalesReceiptService
  let grantStockPermission = true
  let purchaseNumber = 0

  beforeAll(async () => {
    database = await createPurchaseShippingMarkDatabase()
    prisma = new IsolatedNumberingPrismaService(database) as unknown as PrismaService
    await prisma.onModuleInit()

    const [twd] = await Promise.all([
      prisma.currency.findUniqueOrThrow({
        where: { code: 'TWD' },
        select: { id: true, enabled: true, exchangeRate: { select: { id: true } } },
      }),
    ])
    if (twd.exchangeRate === null) {
      await prisma.exchangeRate.create({
        data: { currencyId: twd.id, foreignUnitsPerCny: '4.500000000000' },
      })
    }
    await prisma.currency.updateMany({
      where: { code: { in: ['CNY', 'TWD'] } }, data: { enabled: true },
    })

    const actor = await prisma.user.create({
      data: {
        displayName: 'PurchaseOrder E2E',
        passwordChangedAt: new Date(),
        passwordHash: 'e2e-only-not-a-real-password-hash',
        username,
        usernameNormalized: username,
      },
      select: { id: true },
    })
    actorUserId = actor.id
    const dictionaryType = await prisma.dictionaryType.findUniqueOrThrow({ where: { code: 'service_provider.supplier' } })
    await prisma.dictionaryItem.create({ data: { dictionaryTypeId: dictionaryType.id, value: supplierValue, label: '采购测试供应商', enabled: true } })
    await prisma.dictionaryType.update({ where: { id: dictionaryType.id }, data: { enabled: true } })
    const catalogRule = await createTestShippingMarkRule(prisma, actor.id, `TEST_MARK_${suffix}`)
    await createTestShippingMarkRule(prisma, actor.id, 'CUSTOM_MARK')
    await prisma.supplierShippingMarkRuleBinding.create({ data: {
      supplierValue, ruleId: catalogRule.id, createdByUserId: actor.id, updatedByUserId: actor.id,
    } })
    const markResolver = new PurchaseShippingMarkResolverService(prisma, new DictionaryLookupService(prisma))
    catalogResolution = (await markResolver.read({ productMode: 'CATALOG', supplierValue })).resolutionToken!
    customResolution = (await markResolver.read({ productMode: 'CUSTOM' })).resolutionToken!
    issuanceVoucherMediaAssetId = (await prisma.mediaAsset.create({
      data: {
        mediaType: 'DOCUMENT',
        status: 'UPLOADING',
        objectKey: `assets/purchase-service-e2e-${suffix.toLowerCase()}.pdf`,
        originalFilename: 'issuance.pdf',
        uploadExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
        createdByUserId: actor.id,
      },
      select: { id: true },
    })).id
    paymentVoucherMediaAssetId = (await prisma.mediaAsset.create({
      data: {
        mediaType: 'DOCUMENT',
        status: 'UPLOADING',
        objectKey: `assets/purchase-service-e2e-${suffix.toLowerCase()}-payment.pdf`,
        originalFilename: 'payment.pdf',
        uploadExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
        createdByUserId: actor.id,
      },
      select: { id: true },
    })).id

    const country = await prisma.region.create({
      data: {
        administrativeType: 'COUNTRY_REGION',
        code: `PX-${suffix}`,
        enabled: true,
        level: 'COUNTRY_REGION',
        name: `采购测试国家${suffix}`,
        normalizedName: `采购测试国家${suffix}`,
      },
      select: { id: true },
    })
    countryRegionId = country.id
    const province = await prisma.region.create({
      data: {
        administrativeType: 'PROVINCE_STATE',
        code: `PX-${suffix}-P`,
        enabled: true,
        level: 'PROVINCE_STATE',
        name: `采购测试省${suffix}`,
        normalizedName: `采购测试省${suffix}`,
        parentId: country.id,
      },
      select: { id: true },
    })
    provinceStateId = province.id
    cityId = (await prisma.region.create({
      data: {
        administrativeType: 'CITY',
        code: `PX-${suffix}-C`,
        enabled: true,
        level: 'CITY',
        name: `采购测试市${suffix}`,
        normalizedName: `采购测试市${suffix}`,
        parentId: province.id,
      },
      select: { id: true },
    })).id

    productId = (await prisma.product.create({
      data: {
        attributes: [{ title: '规格', value: 'E2E' }],
        createdByUserId: actor.id,
        name: `采购测试产品${suffix}`,
        productNo: `PUR-P-${suffix}`,
        purchaseCostAmount: '10.0000',
        purchaseCostCurrency: 'CNY',
        status: 'ACTIVE',
        supplierValue,
        twdSalePriceAmount: '100.0000',
        updatedByUserId: actor.id,
      },
      select: { id: true },
    })).id

    const media = {
      activate: jest.fn((transaction: Prisma.TransactionClient, id: string) => (
        transaction.mediaAsset.update({
          where: { id },
          data: {
            status: 'READY',
            mimeType: 'application/pdf',
            sizeBytes: 1n,
            checksumSha256: '0'.repeat(64),
            uploadExpiresAt: null,
          },
        }).then(() => undefined)
      )),
    } as unknown as MediaAssetService
    const salesQuery = new SalesOrderQueryService(prisma)
    const salesCommands = new SalesOrderCommandService(
      prisma,
      {
        generateScoped: jest.fn().mockResolvedValue({
          number: `SO-PUR-E2E-${suffix}`,
          idempotentReplay: false,
        }),
      } as unknown as NumberingGeneratorService,
      new AuditService(),
      media,
      salesQuery,
      { businessToday: () => '2026-08-27' },
    )
    const salesOrder = await salesCommands.create({
      actorUserId,
      idempotencyKey: randomUUID(),
      requestId: `purchase-source-${suffix}`,
    }, {
      orderDate: '2026-08-27',
      currencyCode: 'TWD',
      customer: {
        name: '采购来源客户',
        phone: '0912345678',
        countryRegionId,
        provinceStateId,
        cityId,
        addressDetail: '测试路 1 号',
      },
      lines: [{
        lineType: 'CATALOG',
        productId,
        actualUnitPriceAmount: '100',
        quantity: 2,
      }, {
        lineType: 'CATALOG',
        productId,
        actualUnitPriceAmount: '100',
        quantity: 1,
      }, {
        lineType: 'CUSTOM',
        name: '采购来源临时产品',
        description: '用于验证 CUSTOM 采购覆盖',
        actualUnitPriceAmount: '50',
        quantity: 2,
      }, {
        lineType: 'CATALOG',
        productId,
        actualUnitPriceAmount: '100',
        quantity: 1,
      }, {
        lineType: 'CATALOG',
        productId,
        actualUnitPriceAmount: '100',
        quantity: 1,
      }],
      agreedTotalAmount: '600',
      depositDueAmount: '0',
      balanceDueAmount: '600',
      issuanceVoucher: { mediaAssetId: issuanceVoucherMediaAssetId },
      remark: null,
    })
    salesOrderId = salesOrder.id
    const firstSourceId = salesOrder.lines[0]?.id
    const secondSourceId = salesOrder.lines[1]?.id
    const customSourceId = salesOrder.lines[2]?.id
    const distinctSourceAId = salesOrder.lines[3]?.id
    const distinctSourceBId = salesOrder.lines[4]?.id
    if (
      typeof firstSourceId !== 'string'
      || typeof secondSourceId !== 'string'
      || typeof customSourceId !== 'string'
      || typeof distinctSourceAId !== 'string'
      || typeof distinctSourceBId !== 'string'
    ) {
      throw new Error('Sales source lines were not persisted')
    }
    splitSourceLineId = firstSourceId
    concurrentSourceLineId = secondSourceId
    customSourceLineId = customSourceId
    concurrentDistinctSourceAId = distinctSourceAId
    concurrentDistinctSourceBId = distinctSourceBId

    const dictionaryLookup = {
      requireEffectiveValue: jest.fn((
        _transaction: unknown,
        input: { dictionaryCode: string, value: string },
      ) => Promise.resolve({
        dictionaryCode: input.dictionaryCode,
        label: input.value === supplierValue ? '采购 E2E 供应商' : '银行转账',
        tone: 'DEFAULT',
        value: input.value,
      })),
      resolveStoredValue: jest.fn((
        input: { dictionaryCode: string, value: string },
      ) => Promise.resolve({
        dictionaryCode: input.dictionaryCode,
        effectiveEnabled: true,
        known: true,
        label: '采购 E2E 供应商',
        tone: 'DEFAULT',
        value: input.value,
      })),
      resolveStoredValues: jest.fn((
        input: { values: readonly string[] },
      ) => Promise.resolve(input.values.map(value => ({
        effectiveEnabled: true,
        known: true,
        label: '采购 E2E 供应商',
        tone: 'DEFAULT',
        value,
      })))),
    } as unknown as DictionaryLookupService
    const accessControl = {
      getPermissionCodesInTransaction: jest.fn(() => Promise.resolve(
        grantStockPermission ? ['purchase-orders:create-stock'] : [],
      )),
      hasAll: jest.fn((granted: readonly string[], required: readonly string[]) => (
        required.every(code => granted.includes(code))
      )),
    } as unknown as AccessControlService
    const numbering = {
      generateScopedInTransaction: new NumberingGeneratorService(prisma).generateScopedInTransaction.bind(new NumberingGeneratorService(prisma)),
      generateScoped: jest.fn(() => Promise.resolve({
        number: `PO-E2E-${suffix}-${++purchaseNumber}`,
        idempotentReplay: false,
      })),
    } as unknown as NumberingGeneratorService
    queries = new PurchaseOrderQueryService(prisma, dictionaryLookup)
    sourceQueries = new PurchaseOrderSourceQueryService(prisma, dictionaryLookup)
    productEdits = new SalesOrderProductEditService(prisma, new AuditService())
    productEditQueries = new SalesOrderProductEditQueryService(prisma)
    await ensureReceiptNumberingRule(prisma, actorUserId)
    salesReceipts = new SalesReceiptService(prisma, new SalesReceiptQueryService(prisma), dictionaryLookup, media,
      new FundPostingApplicationService(prisma, new AuditService()), new AuditService(), new SalesOrderAutomaticStateService(new AuditService()),
      { getPermissionCodesInTransaction: () => Promise.resolve(['sales-orders:payment', 'sales-orders:document', 'sales-receipts:review']), hasAll: () => true } as unknown as AccessControlService,
      { stat: () => Promise.resolve({ sizeBytes: 1n, modifiedAt: new Date() }) } as unknown as MediaContentDeliveryService,
      new NumberingGeneratorService(prisma),
    )
    await new FundAccountCommandService(prisma, new AuditService()).createUserAccount({ actorUserId, requestId: randomUUID() }, { userId: actorUserId, userShareRate: '30' })
    commands = new PurchaseOrderCommandService(
      prisma,
      numbering,
      new AuditService(),
      new PurchaseOrderCreateDependencyService(dictionaryLookup, accessControl),
      markResolver,
      { businessToday: () => '2026-08-27' },
    )
    factoryShipments = new PurchaseOrderFactoryShipmentService(
      prisma,
      new AuditService(),
      new SalesOrderPurchaseCoverageService(new AuditService()),
    )
    mutations = new PurchaseOrderMutationService(
      prisma,
      new AuditService(),
      dictionaryLookup,
      media,
      queries,
      new SalesOrderPurchaseCoverageService(new AuditService()),
      numbering,
      markResolver,
      { now: () => new Date('2026-08-27T12:00:00.000Z') },
    )
  })

  afterAll(async () => {
    await prisma?.onModuleDestroy()
    await database?.dispose()
  })

  function context(idempotencyKey = randomUUID()) {
    return {
      actorUserId,
      idempotencyKey,
      requestId: `purchase-e2e-${randomUUID()}`,
    }
  }

  function linkedInput(sourceSalesOrderLineId: string, quantity: number) {
    const total = String(20 * quantity)
    return {
      parts: [{ key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', items: [{ lineNumber: 1, quantity }] }],
      purchaseType: 'SALES_LINKED',
      productMode: 'CATALOG',
      expectedShippingMarkResolution: catalogResolution,
      salesOrderId,
      supplierValue,
      orderDate: '2026-08-27',
      lines: [{
        lineType: 'CATALOG',
        productId,
        sourceSalesOrderLineId,
        actualPurchaseUnitPriceAmount: '20',
        quantity,
      }],
      purchaseTotalAmount: total,
      depositDueAmount: '0',
      balanceDueAmount: total,
      remark: null,
    }
  }

  function linkedCustomInput(sourceSalesOrderLineId: string, quantity: number) {
    const total = String(15 * quantity)
    return {
      parts: [{ key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', items: [{ lineNumber: 1, quantity }] }],
      purchaseType: 'SALES_LINKED',
      productMode: 'CUSTOM',
      expectedShippingMarkResolution: customResolution,
      salesOrderId,
      customSupplierName: 'E2E 临时供应商',
      orderDate: '2026-08-27',
      lines: [{
        lineType: 'CUSTOM',
        name: '采购侧临时产品',
        description: '采购覆盖 E2E',
        sourceSalesOrderLineId,
        referencePurchaseUnitPriceAmount: '15',
        actualPurchaseUnitPriceAmount: '15',
        quantity,
      }],
      purchaseTotalAmount: total,
      depositDueAmount: '0',
      balanceDueAmount: total,
      remark: null,
    }
  }

  async function expectSourceView(
    expectedView: 'UNPURCHASED' | 'PARTIALLY_PURCHASED',
  ) {
    const result = await sourceQueries.salesOrders({
      view: expectedView,
      productMode: 'CATALOG',
      supplierValue,
      keyword: `SO-PUR-E2E-${suffix}`,
      page: 1,
      pageSize: 20,
    })
    expect(result).toMatchObject({
      view: expectedView,
      total: 1,
      items: [{ id: salesOrderId }],
      counts: [
        { value: 'UNPURCHASED', count: expectedView === 'UNPURCHASED' ? 1 : 0 },
        {
          value: 'PARTIALLY_PURCHASED',
          count: expectedView === 'PARTIALLY_PURCHASED' ? 1 : 0,
        },
      ],
    })
  }

  async function expectNoSourceView() {
    for (const view of ['UNPURCHASED', 'PARTIALLY_PURCHASED'] as const) {
      await expect(sourceQueries.salesOrders({
        view,
        productMode: 'CATALOG',
        supplierValue,
        keyword: `SO-PUR-E2E-${suffix}`,
        page: 1,
        pageSize: 20,
      })).resolves.toMatchObject({ view, total: 0, items: [] })
    }
  }

  it('classifies a confirmed pending sales order without purchase facts as unpurchased', async () => {
    await expectSourceView('UNPURCHASED')
  })

  it('enforces admin stock creation and derives payment/pending state', async () => {
    const idempotencyKey = randomUUID()
    const stockInput = {
      parts: [{ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] }],
      purchaseType: 'STOCK',
      productMode: 'CUSTOM',
      customSupplierName: 'E2E 备货供应商',
      orderDate: '2026-08-27',
      expectedShippingMarkResolution: customResolution,
      lines: [{
        lineType: 'CUSTOM',
        name: '临时采购产品',
        description: null,
        referencePurchaseUnitPriceAmount: '25',
        actualPurchaseUnitPriceAmount: '25.00',
        quantity: 1,
      }],
      purchaseTotalAmount: '25',
      depositDueAmount: '10',
      balanceDueAmount: '15',
      remark: null,
    }
    grantStockPermission = false
    await expect(commands.create(context(idempotencyKey), stockInput))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    grantStockPermission = true
    const createdId = await commands.create(context(idempotencyKey), stockInput)
    await expect(commands.create(context(idempotencyKey), stockInput))
      .resolves.toBe(createdId)
    await expect(prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: { fulfillmentStatus: true },
    })).resolves.toEqual({ fulfillmentStatus: 'PENDING' })
    const created = await queries.getById(createdId)
    expect(created).toMatchObject({
      orderStatus: 'PENDING_REVIEW',
      fulfillmentStatus: 'ORDERED',
      purchaseType: 'STOCK',
      currencyCode: 'CNY',
      shippingMarkText: null,
      shippingMarks: [],
      paymentStatus: 'UNPAID',
      lines: [{
        lineType: 'CUSTOM',
        referencePurchaseUnitPriceAmount: '25.0000',
        actualPurchaseUnitPriceAmount: '25.0000',
      }],
    })

    await expect(queries.list({ view: 'pending', pendingTask: 'AWAITING_REVIEW', keyword: created.orderNo }))
      .resolves.toMatchObject({ total: 1 })
    for (const pendingTask of ['AWAITING_SHIPMENT', 'AWAITING_WAREHOUSE', 'AWAITING_PAYMENT'] as const) {
      await expect(queries.list({ view: 'pending', pendingTask, keyword: created.orderNo }))
        .resolves.toMatchObject({ total: 0 })
    }
    await expect(mutations.recordPayment(context(), createdId, {
      paymentType: 'DEPOSIT', amount: '10', paidAt: '2026-08-27T10:00:00.000Z', paymentMethod: 'BANK_TRANSFER',
    })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID' })
    await expect(mutations.updateFulfillmentStatus(context(), createdId, { toStatus: 'PREPARING' }))
      .rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID' })
    await expect(factoryShipments.shipPurchaseOrder(context(), createdId, { expectedVersion: created.version, partIds: created.parts.map(part => part.id) }))
      .rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_NOT_ALLOWED' })
    const reviewResults = await Promise.allSettled([
      mutations.review(context(), createdId, { expectedVersion: created.version }),
      mutations.review(context(), createdId, { expectedVersion: created.version }),
    ])
    expect(reviewResults.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(reviewResults.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'PURCHASE_ORDER_STATE_CHANGED' },
    })
    await expect(queries.getById(createdId)).resolves.toMatchObject({
      orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING',
      shippingMarkText: expect.stringMatching(/^MARK\d{8}$/u) as unknown,
      shippingMarks: [expect.stringMatching(/^MARK\d{8}$/u) as unknown],
      orderNo: created.orderNo, version: created.version + 1,
    })
    await expect(prisma.purchaseOrderStatusHistory.count({ where: { purchaseOrderId: createdId } }))
      .resolves.toBe(2)
    await expect(queries.statusCounts({ view: 'pending', keyword: created.orderNo })).resolves.toMatchObject({
      items: [
        { value: 'AWAITING_REVIEW', count: 0 }, { value: 'AWAITING_SHIPMENT', count: 1 },
        { value: 'AWAITING_WAREHOUSE', count: 0 }, { value: 'AWAITING_PAYMENT', count: 1 },
      ],
    })

    await mutations.recordPayment({
      actorUserId, requestId: `purchase-deposit-${suffix}`,
    }, createdId, {
      paymentType: 'DEPOSIT',
      amount: '10',
      paidAt: '2026-08-27T10:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
    })
    const paid = await mutations.recordPayment({
      actorUserId, requestId: `purchase-balance-${suffix}`,
    }, createdId, {
      paymentType: 'BALANCE',
      amount: '15',
      paidAt: '2026-08-27T11:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
    })
    expect(paid).toMatchObject({
      paymentStatus: 'PAID',
      amounts: { paidAmount: '25.0000', outstandingAmount: '0.0000' },
      paymentRecordSummary: { totalCount: 2, count: 2, byType: [
        { paymentType: 'DEPOSIT', count: 1, amount: '10.0000' },
        { paymentType: 'BALANCE', count: 1, amount: '15.0000' },
        { paymentType: 'OTHER', count: 0, amount: '0.0000' },
      ] },
    })
    const paidPage = await queries.list({ view: 'all', keyword: created.orderNo, pageSize: 1 })
    expect(paidPage.items).toHaveLength(1)
    expect(paidPage.items[0]).toMatchObject({
      id: createdId, paidAmount: '25.0000',
      paymentRecordSummary: paid.paymentRecordSummary,
      documentSummary: { count: 0 },
      changeSummary: paid.changeSummary,
    })
    expect(paidPage.items[0]?.changeSummary.latest?.kind).toBe('STATUS')
    expect(paidPage.items[0]?.changeSummary.latest?.reason).toContain('25.0000')
    await expect(queries.list({ view: 'all', keyword: created.orderNo, page: 2, pageSize: 1 }))
      .resolves.toMatchObject({ total: 1, items: [] })
    await expect(mutations.updateOrderStatus({
      actorUserId, requestId: `purchase-cancel-paid-${suffix}`,
    }, createdId, { toStatus: 'CANCELLED' }))
      .rejects.toMatchObject({ code: 'PURCHASE_ORDER_CANCEL_HAS_PAYMENTS' })
    await factoryShipments.shipPurchaseOrder({
      actorUserId, requestId: `purchase-SHIPPED-${suffix}`,
    }, createdId, { expectedVersion: paid.version, partIds: paid.parts.map(part => part.id) })
    await mutations.updateFulfillmentStatus({
      actorUserId, requestId: `purchase-SIGNED-${suffix}`,
    }, createdId, { toStatus: 'SIGNED' })
    await expect(queries.list({
      view: 'pending', keyword: created.orderNo,
    })).resolves.toMatchObject({ total: 0, items: [] })
    const balance = await prisma.purchaseOrderPayment.findFirstOrThrow({
      where: { purchaseOrderId: createdId, paymentType: 'BALANCE' },
      select: { id: true },
    })
    const voided = await mutations.voidPayment({
      actorUserId, requestId: `purchase-void-${suffix}`,
    }, createdId, balance.id, { reason: 'E2E 作废尾款' })
    expect(voided).toMatchObject({
      paymentStatus: 'PARTIALLY_PAID',
      amounts: { paidAmount: '10.0000', outstandingAmount: '15.0000' },
    })
    await expect(queries.list({
      view: 'pending', keyword: created.orderNo,
    })).resolves.toMatchObject({ total: 1, items: [{
      paidAmount: '10.0000', paymentRecordSummary: { totalCount: 2, count: 1, byType: [
        { paymentType: 'DEPOSIT', count: 1, amount: '10.0000' },
        { paymentType: 'BALANCE', count: 0, amount: '0.0000' },
        { paymentType: 'OTHER', count: 0, amount: '0.0000' },
      ] },
      changeSummary: voided.changeSummary,
    }] })
    await expect(mutations.updateOrderStatus({
      actorUserId, requestId: `purchase-cancel-shipped-${suffix}`,
    }, createdId, { toStatus: 'CANCELLED' }))
      .rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID' })
  })

  it('persists typed voucher names without renaming source files or reusing uploads', async () => {
    const orderId = await commands.create(context(), {
      parts: [{ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] }],
      purchaseType: 'STOCK', productMode: 'CUSTOM', customSupplierName: '凭证命名测试供应商',
      expectedShippingMarkResolution: customResolution,
      orderDate: '2026-08-27',
      lines: [{
        lineType: 'CUSTOM', name: '凭证命名测试产品', description: null,
        referencePurchaseUnitPriceAmount: '100', actualPurchaseUnitPriceAmount: '100', quantity: 1,
      }],
      purchaseTotalAmount: '100', depositDueAmount: '30', balanceDueAmount: '70',
    })
    const { orderNo, version } = await queries.getById(orderId)
    await mutations.review(context(), orderId, { expectedVersion: version })
    for (const [paymentType, label] of [
      ['DEPOSIT', '定金凭证'], ['BALANCE', '尾款凭证'], ['OTHER', '其他付款凭证'],
    ] as const) {
      const originalFilename = `original-${paymentType}.pdf`
      const asset = await prisma.mediaAsset.create({
        data: {
          mediaType: 'DOCUMENT', status: 'UPLOADING', originalFilename,
          objectKey: `assets/purchase-voucher-${suffix}-${paymentType}.pdf`,
          uploadExpiresAt: new Date('2099-01-01T00:00:00.000Z'), createdByUserId: actorUserId,
        },
        select: { id: true },
      })
      purchaseVoucherMediaAssetIds.push(asset.id)
      const input = {
        paymentType, amount: '10', paidAt: '2026-08-27T11:00:00.000Z',
        paymentMethod: 'BANK_TRANSFER', voucher: { mediaAssetId: asset.id },
      }
      const detail = await mutations.recordPayment(context(), orderId, input)
      expect(detail.documents.find(document => document.mediaAssetId === asset.id))
        .toMatchObject({ title: `${orderNo}-${label}`, originalFilename })
      await expect(prisma.purchaseOrderDocument.findFirstOrThrow({
        where: { purchaseOrderId: orderId, mediaAssetId: asset.id },
        select: { title: true, mediaAsset: { select: { originalFilename: true } } },
      })).resolves.toEqual({ title: `${orderNo}-${label}`, mediaAsset: { originalFilename } })
      // 延续现有上传归属/状态校验；重复使用已激活的附件不能新增付款或凭证。
      await expect(mutations.recordPayment(context(), orderId, input))
        .rejects.toMatchObject({ code: 'PURCHASE_ORDER_DOCUMENT_UNAVAILABLE' })
    }
    await expect(prisma.purchaseOrderPayment.count({ where: { purchaseOrderId: orderId } }))
      .resolves.toBe(3)
    await expect(prisma.purchaseOrderDocument.count({ where: { purchaseOrderId: orderId } }))
      .resolves.toBe(3)
    await expect(queries.getById(orderId)).resolves.toMatchObject({
      paymentStatus: 'PARTIALLY_PAID', amounts: { paidAmount: '30.0000', outstandingAmount: '70.0000' },
    })
  })

  it('supports split quantities, rejects overage, and releases quantity on cancel', async () => {
    const first = await commands.create(context(), linkedInput(splitSourceLineId, 1))
    await expectSourceView('PARTIALLY_PURCHASED')

    await mutations.updateOrderStatus({
      actorUserId, requestId: `purchase-cancel-release-${suffix}`,
    }, first, { toStatus: 'CANCELLED', reason: '释放来源数量' })
    await expectSourceView('UNPURCHASED')
    await commands.create(context(), linkedInput(splitSourceLineId, 1))
    await expect(commands.create(context(), linkedInput(splitSourceLineId, 1)))
      .resolves.toEqual(expect.any(String))
    await expect(commands.create(context(), linkedInput(splitSourceLineId, 1)))
      .rejects.toMatchObject({ code: 'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED' })
    await expectSourceView('PARTIALLY_PURCHASED')
    const aggregate = await prisma.purchaseOrderLine.aggregate({
      where: {
        sourceSalesOrderLineId: splitSourceLineId,
        purchaseOrder: { orderStatus: { not: 'CANCELLED' } },
      },
      _sum: { quantity: true },
    })
    expect(aggregate._sum.quantity).toBe(2)
    await expect(prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: { fulfillmentStatus: true },
    })).resolves.toEqual({ fulfillmentStatus: 'PENDING' })
  })

  it('serializes concurrent source claims so at most one transaction succeeds', async () => {
    const results = await Promise.allSettled([
      commands.create(context(), linkedInput(concurrentSourceLineId, 1)),
      commands.create(context(), linkedInput(concurrentSourceLineId, 1)),
    ])
    const succeeded = results.filter(result => result.status === 'fulfilled')
    const failed = results.filter(result => result.status === 'rejected')
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)
    const aggregate = await prisma.purchaseOrderLine.aggregate({
      where: {
        sourceSalesOrderLineId: concurrentSourceLineId,
        purchaseOrder: { orderStatus: { not: 'CANCELLED' } },
      },
      _sum: { quantity: true },
    })
    expect(aggregate._sum.quantity).toBe(1)
    await expect(prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: { fulfillmentStatus: true },
    })).resolves.toEqual({ fulfillmentStatus: 'PENDING' })
  })

  it('counts CUSTOM purchases cumulatively without advancing incomplete orders', async () => {
    const firstKey = randomUUID()
    const secondKey = randomUUID()
    await commands.create(
      context(firstKey),
      linkedCustomInput(customSourceLineId, 1),
    )
    const secondId = await commands.create(
      context(secondKey),
      linkedCustomInput(customSourceLineId, 1),
    )
    await expect(commands.create(
      context(secondKey),
      linkedCustomInput(customSourceLineId, 1),
    )).resolves.toBe(secondId)

    await expect(prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: { fulfillmentStatus: true, version: true },
    })).resolves.toEqual({ fulfillmentStatus: 'PENDING', version: 1 })
    await expect(prisma.salesOrderStatusHistory.count({
      where: { salesOrderId, dimension: 'FULFILLMENT' },
    })).resolves.toBe(0)
  })

  it('reserves disjoint final purchases and advances exactly once only after all reviews', async () => {
    const firstKey = randomUUID()
    const secondKey = randomUUID()
    const firstInput = linkedInput(concurrentDistinctSourceAId, 1)
    const secondInput = linkedInput(concurrentDistinctSourceBId, 1)
    const attempts = [
      { idempotencyKey: firstKey, input: firstInput },
      { idempotencyKey: secondKey, input: secondInput },
    ] as const
    const initialResults = await Promise.allSettled(attempts.map(attempt => (
      commands.create(context(attempt.idempotencyKey), attempt.input)
    )))
    expect(initialResults.filter(result => result.status === 'fulfilled').length)
      .toBeGreaterThanOrEqual(1)
    for (const [index, result] of initialResults.entries()) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({
          code: 'PURCHASE_ORDER_STATE_CHANGED',
        })
        const attempt = attempts[index]
        if (attempt === undefined) throw new Error('Concurrent attempt missing')
        await commands.create(
          context(attempt.idempotencyKey),
          attempt.input,
        )
      }
    }
    const [firstId, secondId] = await Promise.all([
      commands.create(context(firstKey), firstInput),
      commands.create(context(secondKey), secondInput),
    ])
    await expect(commands.create(context(firstKey), firstInput)).resolves.toBe(firstId)
    await expect(commands.create(context(secondKey), secondInput)).resolves.toBe(secondId)

    await expect(prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId }, select: { fulfillmentStatus: true, version: true },
    })).resolves.toEqual({ fulfillmentStatus: 'PENDING', version: 1 })
    const pendingOrders = await prisma.purchaseOrder.findMany({
      where: { salesOrderId, orderStatus: 'PENDING_REVIEW' },
      orderBy: { id: 'asc' }, select: { id: true, version: true },
    })
    for (const [index, order] of pendingOrders.entries()) {
      await mutations.review(context(), order.id, { expectedVersion: order.version })
      if (index < pendingOrders.length - 1) {
        await expect(prisma.salesOrder.findUniqueOrThrow({
          where: { id: salesOrderId }, select: { fulfillmentStatus: true },
        })).resolves.toEqual({ fulfillmentStatus: 'PENDING' })
      }
    }

    await expect(prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: { fulfillmentStatus: true, version: true },
    })).resolves.toEqual({ fulfillmentStatus: 'PREPARING', version: 2 })
    await expect(prisma.salesOrderStatusHistory.findMany({
      where: { salesOrderId, dimension: 'FULFILLMENT' },
      select: {
        fromStatus: true,
        toStatus: true,
        changedByUserId: true,
      },
    })).resolves.toEqual([{
      fromStatus: 'PENDING',
      toStatus: 'PREPARING',
      changedByUserId: actorUserId,
    }])
    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED',
        targetId: salesOrderId,
      },
      select: { metadata: true },
    })
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0]?.metadata).toMatchObject({
      automatic: true,
      fromStatus: 'PENDING',
      toStatus: 'PREPARING',
      trigger: 'PURCHASE_COVERAGE',
    })
    await expectNoSourceView()
  })

  it('atomically edits products once, becomes partial, and returns to completed after purchase', async () => {
    const receipt = await salesReceipts.submit({
      actorUserId,
      requestId: `sales-payment-before-product-edit-${suffix}`,
    }, salesOrderId, {
      paymentType: 'BALANCE',
      amount: '600',
      receivedAt: '2026-08-27T11:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
      remark: null,
      voucher: { mediaAssetId: paymentVoucherMediaAssetId },
    }, randomUUID())
    const approval = await salesReceipts.approvalContext({ actorUserId, requestId: randomUUID() }, receipt.id)
    await salesReceipts.approve({ actorUserId, requestId: randomUUID() }, receipt.id, { expectedVersion: 1, expectedContext: approval.expectedContext })
    const before = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: { version: true, paymentStatus: true, fulfillmentStatus: true },
    })
    expect(before).toMatchObject({
      paymentStatus: 'PAID',
      fulfillmentStatus: 'PREPARING',
    })
    const editContext = await productEditQueries.context(salesOrderId)
    const productEditInput = {
      expectedVersion: before.version,
      reason: '客户加购产品',
      confirmDepositReduction: false,
      existingLines: editContext.existingLines.map(line => ({
        lineId: line.id,
        name: line.productName,
        description: line.description,
        actualUnitPriceAmount: amountInputFromSnapshot(line.actualUnitPriceAmount),
        desiredQuantity: line.quantity,
      })),
      newLines: [{
        lineType: 'CATALOG',
        productId,
        actualUnitPriceAmount: '120',
        quantity: 1,
      }, {
        lineType: 'CUSTOM',
        name: '加购安装服务',
        description: '采购服务 E2E 加购',
        actualUnitPriceAmount: '30',
        quantity: 2,
      }],
    }
    const attempts = await Promise.allSettled([
      productEdits.updateProducts({
        actorUserId,
        requestId: `sales-product-edit-a-${suffix}`,
      }, salesOrderId, productEditInput),
      productEdits.updateProducts({
        actorUserId,
        requestId: `sales-product-edit-b-${suffix}`,
      }, salesOrderId, productEditInput),
    ])
    const succeeded = attempts.filter(
      (result): result is PromiseFulfilledResult<Awaited<
        ReturnType<SalesOrderProductEditService['updateProducts']>
      >> => result.status === 'fulfilled',
    )
    const failed = attempts.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)
    const failedReason: unknown = failed[0]?.reason
    expect(failedReason).toMatchObject({
      code: 'SALES_ORDER_PRODUCT_EDIT_VERSION_CONFLICT',
    })
    const result = succeeded[0]?.value
    if (result === undefined) throw new Error('Product-edit result is unavailable')
    expect(result).toMatchObject({
      salesOrderId,
      previousVersion: before.version,
      version: before.version + 1,
      amountDelta: '180.0000',
      fulfillmentStatus: 'PENDING',
      paymentStatus: 'PARTIALLY_PAID',
      amounts: {
        lineSubtotalAmount: '780.0000',
        agreedTotalAmount: '780.0000',
        depositDueAmount: '0.0000',
        balanceDueAmount: '780.0000',
        paidAmount: '600.0000',
        outstandingAmount: '180.0000',
      },
    })
    expect(result.addedLineIds).toHaveLength(2)

    const persisted = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: {
        version: true,
        fulfillmentStatus: true,
        paymentStatus: true,
        lineSubtotalAmount: true,
        agreedTotalAmount: true,
        depositDueAmount: true,
        balanceDueAmount: true,
        lines: {
          where: { id: { in: [...result.addedLineIds] } },
          orderBy: { lineNumber: 'asc' },
          select: {
            id: true,
            lineNumber: true,
            lineType: true,
            productId: true,
            productNoSnapshot: true,
            productNameSnapshot: true,
            descriptionSnapshot: true,
            standardUnitPriceAmount: true,
            actualUnitPriceAmount: true,
            quantity: true,
            lineTotalAmount: true,
          },
        },
      },
    })
    expect({
      ...persisted,
      lineSubtotalAmount: persisted.lineSubtotalAmount.toFixed(4),
      agreedTotalAmount: persisted.agreedTotalAmount.toFixed(4),
      depositDueAmount: persisted.depositDueAmount.toFixed(4),
      balanceDueAmount: persisted.balanceDueAmount.toFixed(4),
      lines: persisted.lines.map(line => ({
        ...line,
        standardUnitPriceAmount: line.standardUnitPriceAmount?.toFixed(4) ?? null,
        actualUnitPriceAmount: line.actualUnitPriceAmount.toFixed(4),
        lineTotalAmount: line.lineTotalAmount.toFixed(4),
      })),
    }).toMatchObject({
      version: before.version + 1,
      fulfillmentStatus: 'PENDING',
      paymentStatus: 'PARTIALLY_PAID',
      lineSubtotalAmount: '780.0000',
      agreedTotalAmount: '780.0000',
      depositDueAmount: '0.0000',
      balanceDueAmount: '780.0000',
      lines: [{
        lineNumber: 6,
        lineType: 'CATALOG',
        productId,
        productNoSnapshot: `PUR-P-${suffix}`,
        productNameSnapshot: `采购测试产品${suffix}`,
        standardUnitPriceAmount: '100.0000',
        actualUnitPriceAmount: '120.0000',
        quantity: 1,
        lineTotalAmount: '120.0000',
      }, {
        lineNumber: 7,
        lineType: 'CUSTOM',
        productId: null,
        productNoSnapshot: null,
        productNameSnapshot: '加购安装服务',
        descriptionSnapshot: '采购服务 E2E 加购',
        standardUnitPriceAmount: null,
        actualUnitPriceAmount: '30.0000',
        quantity: 2,
        lineTotalAmount: '60.0000',
      }],
    })
    await expect(prisma.salesOrderAmountRevision.count({
      where: { salesOrderId },
    })).resolves.toBe(1)
    await expect(prisma.salesOrderStatusHistory.findMany({
      where: { salesOrderId, dimension: 'PAYMENT' },
      orderBy: { changedAt: 'asc' },
      select: { fromStatus: true, toStatus: true },
    })).resolves.toEqual([
      { fromStatus: 'UNPAID', toStatus: 'PAID' },
      { fromStatus: 'PAID', toStatus: 'PARTIALLY_PAID' },
    ])
    await expect(prisma.salesOrderStatusHistory.findMany({
      where: { salesOrderId, dimension: 'FULFILLMENT' },
      orderBy: { changedAt: 'asc' },
      select: { fromStatus: true, toStatus: true },
    })).resolves.toEqual([
      { fromStatus: 'PENDING', toStatus: 'PREPARING' },
      { fromStatus: 'PREPARING', toStatus: 'PENDING' },
    ])
    await expect(prisma.auditEvent.count({
      where: {
        eventType: 'SALES_ORDER_PRODUCTS_CHANGED',
        targetId: salesOrderId,
      },
    })).resolves.toBe(1)
    await expectSourceView('PARTIALLY_PURCHASED')

    const catalogSourceLines = await sourceQueries.salesOrderLines(salesOrderId, {
      productMode: 'CATALOG',
      supplierValue,
    })
    const customSourceLines = await sourceQueries.salesOrderLines(salesOrderId, {
      productMode: 'CUSTOM',
    })
    expect(catalogSourceLines.items.find(line => line.id === result.addedLineIds[0]))
      .toMatchObject({
      id: result.addedLineIds[0],
      lineType: 'CATALOG',
      purchasedQuantity: 0,
      remainingQuantity: 1,
    })
    expect(customSourceLines.items.find(line => line.id === result.addedLineIds[1]))
      .toMatchObject({
      id: result.addedLineIds[1],
      lineType: 'CUSTOM',
      purchasedQuantity: 0,
      remainingQuantity: 2,
    })
    const addedCatalogId = await commands.create(context(), linkedInput(result.addedLineIds[0], 1))
    const addedCustomId = await commands.create(context(), linkedCustomInput(result.addedLineIds[1], 2))
    await expect(commands.create(
      context(),
      linkedInput(result.addedLineIds[0], 1),
    )).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED',
    })
    await expectNoSourceView()
    await expect(prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId }, select: { fulfillmentStatus: true },
    })).resolves.toEqual({ fulfillmentStatus: 'PENDING' })
    for (const orderId of [addedCatalogId, addedCustomId]) {
      const order = await queries.getById(orderId)
      await mutations.review(context(), orderId, { expectedVersion: order.version })
    }
    await expect(prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: { fulfillmentStatus: true },
    })).resolves.toEqual({ fulfillmentStatus: 'PREPARING' })
  })

  it('uses persisted fulfillment and order status to enforce the pre-sea product-edit boundary', async () => {
    /*
     * 这里直接切换隔离数据库中的状态，是为了只验证产品修改资格查询对持久化事实的
     * 判断；履约状态机的逐步流转已由独立服务测试负责，避免本用例产生无关历史。
     */
    try {
      for (const fulfillmentStatus of [
        'PREPARING',
        'LAND_TRANSIT',
        'WAREHOUSE_ARRIVED',
      ] as const) {
        await prisma.salesOrder.update({
          where: { id: salesOrderId },
          data: { fulfillmentStatus },
        })
        await expect(productEditQueries.context(salesOrderId)).resolves.toMatchObject({
          salesOrder: { fulfillmentStatus },
        })
      }

      for (const fulfillmentStatus of ['SEA_TRANSIT', 'SIGNED'] as const) {
        await prisma.salesOrder.update({
          where: { id: salesOrderId },
          data: { fulfillmentStatus },
        })
        await expect(productEditQueries.context(salesOrderId)).rejects.toMatchObject({
          status: 422,
          code: 'SALES_ORDER_PRODUCT_EDIT_NOT_ALLOWED',
        })
      }

      await prisma.salesOrder.update({
        where: { id: salesOrderId },
        data: { orderStatus: 'CANCELLED', fulfillmentStatus: 'PREPARING' },
      })
      await expect(productEditQueries.context(salesOrderId)).rejects.toMatchObject({
        status: 422,
        code: 'SALES_ORDER_PRODUCT_EDIT_NOT_ALLOWED',
      })
    }
    finally {
      await prisma.salesOrder.update({
        where: { id: salesOrderId },
        data: { orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING' },
      })
    }
  })

  it('ships linked purchases atomically and advances sales only after the final shipment', async () => {
    const initialOrders = await prisma.purchaseOrder.findMany({
      where: {
        salesOrderId,
        purchaseType: 'SALES_LINKED',
        orderStatus: { not: 'CANCELLED' },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        orderNo: true,
        fulfillmentStatus: true,
        version: true,
        parts: { select: { id: true, partNumber: true } },
      },
    })
    expect(initialOrders.length).toBeGreaterThanOrEqual(3)
    expect(initialOrders.every(order => order.fulfillmentStatus === 'PREPARING'))
      .toBe(true)

    const concurrentTarget = initialOrders[0]
    if (concurrentTarget === undefined) {
      throw new Error('Concurrent factory-shipment target is unavailable')
    }
    const concurrentResults = await Promise.all([
      factoryShipments.shipPurchaseOrder({
        actorUserId,
        requestId: `purchase-factory-concurrent-a-${suffix}`,
      }, concurrentTarget.id, {
        expectedVersion: concurrentTarget.version,
        partIds: concurrentTarget.parts.map(part => part.id),
        reason: 'E2E 并发发货',
      }),
      factoryShipments.shipPurchaseOrder({
        actorUserId,
        requestId: `purchase-factory-concurrent-b-${suffix}`,
      }, concurrentTarget.id, {
        expectedVersion: concurrentTarget.version,
        partIds: concurrentTarget.parts.map(part => part.id),
        reason: 'E2E 并发发货',
      }),
    ])
    expect(concurrentResults.map(result => result.changedPurchaseOrderCount).sort())
      .toEqual([0, 1])

    const concurrentHistory = await prisma.purchaseOrderStatusHistory.findMany({
      where: {
        purchaseOrderId: concurrentTarget.id,
        dimension: 'FULFILLMENT',
      },
      select: {
        fromStatus: true,
        toStatus: true,
        reason: true,
        changedByUserId: true,
        changedAt: true,
      },
    })
    expect(concurrentHistory).toHaveLength(2)
    expect(concurrentHistory.every(history => history.changedAt instanceof Date))
      .toBe(true)
    expect(concurrentHistory.map(history => ({
      fromStatus: history.fromStatus,
      toStatus: history.toStatus,
      reason: history.reason,
      changedByUserId: history.changedByUserId,
    })))
      .toEqual(expect.arrayContaining([{
      fromStatus: 'ORDERED',
      toStatus: 'PREPARING',
      reason: '采购订单审核通过，进入备货',
      changedByUserId: actorUserId,
    }, {
      fromStatus: 'PREPARING',
      toStatus: 'SHIPPED',
      reason: `本次发货：${concurrentTarget.parts.map(part => `货件-${String(part.partNumber).padStart(2, '0')}`).join('、')}；E2E 并发发货`,
      changedByUserId: actorUserId,
    }]))
    const purchaseAuditEvents = await prisma.auditEvent.findMany({
      where: {
        eventType: 'PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED',
        targetId: concurrentTarget.id,
      },
      select: { metadata: true },
    })
    expect(purchaseAuditEvents).toHaveLength(2)
    expect(purchaseAuditEvents.some(event => auditMetadataMatches(event.metadata, {
      action: 'REVIEW',
      fromStatus: 'ORDERED',
      toStatus: 'PREPARING',
    }))).toBe(true)
    expect(purchaseAuditEvents.some(event => auditMetadataMatches(event.metadata, {
      automatic: false,
      fromStatus: 'PREPARING',
      source: 'PURCHASE_ORDER',
      toStatus: 'SHIPPED',
    }))).toBe(true)

    const pendingOrders = await prisma.purchaseOrder.findMany({
      where: {
        salesOrderId,
        purchaseType: 'SALES_LINKED',
        orderStatus: { not: 'CANCELLED' },
        fulfillmentStatus: { in: ['ORDERED', 'PREPARING'] },
      },
      orderBy: { id: 'asc' },
      select: { id: true, version: true, parts: { select: { id: true } } },
    })
    const finalTarget = pendingOrders.at(-1)
    const selectedTargets = pendingOrders.slice(0, -1)
    if (finalTarget === undefined || selectedTargets.length === 0) {
      throw new Error('Split factory-shipment targets are unavailable')
    }

    const staleTarget = selectedTargets[0]
    if (staleTarget === undefined) throw new Error('Stale target is unavailable')
    await expect(factoryShipments.shipPurchaseOrder({
      actorUserId,
      requestId: `purchase-factory-stale-${suffix}`,
    }, staleTarget.id, {
      expectedVersion: staleTarget.version + 1,
      partIds: staleTarget.parts.map(part => part.id),
      reason: null,
    })).rejects.toMatchObject({
      status: 409,
      code: 'FACTORY_SHIPMENT_STATE_CHANGED',
    })

    const partial = await factoryShipments.shipSalesOrder({
      actorUserId,
      requestId: `sales-factory-partial-${suffix}`,
    }, salesOrderId, {
      mode: 'SELECTED',
      targets: selectedTargets.map(target => ({
        purchaseOrderId: target.id,
        expectedVersion: target.version,
        partIds: target.parts.map(part => part.id),
      })),
      reason: 'E2E 销售分批发货',
    })
    expect(partial).toMatchObject({
      changedPurchaseOrderCount: selectedTargets.length,
      remainingPendingShipmentCount: 1,
      salesOrder: {
        fulfillmentStatus: 'PREPARING',
        advancedToLandTransit: false,
      },
    })

    const completed = await factoryShipments.shipPurchaseOrder({
      actorUserId,
      requestId: `purchase-factory-final-${suffix}`,
    }, finalTarget.id, {
      expectedVersion: finalTarget.version,
      partIds: finalTarget.parts.map(part => part.id),
      reason: 'E2E 最后一张采购发货',
    })
    expect(completed).toMatchObject({
      changedPurchaseOrderCount: 1,
      remainingPendingShipmentCount: 0,
      salesOrder: {
        fulfillmentStatus: 'LAND_TRANSIT',
        advancedToLandTransit: true,
      },
    })
    await expect(prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: { fulfillmentStatus: true },
    })).resolves.toEqual({ fulfillmentStatus: 'LAND_TRANSIT' })
    const salesShipmentHistory = await prisma.salesOrderStatusHistory.findMany({
      where: {
        salesOrderId,
        dimension: 'FULFILLMENT',
        fromStatus: 'PREPARING',
        toStatus: 'LAND_TRANSIT',
      },
      select: {
        reason: true,
        changedByUserId: true,
        changedAt: true,
      },
    })
    expect(salesShipmentHistory).toHaveLength(1)
    expect(salesShipmentHistory[0]).toMatchObject({
      reason: '全部有效关联采购订单已发货',
      changedByUserId: actorUserId,
    })
    expect(salesShipmentHistory[0]?.changedAt).toBeInstanceOf(Date)
    const salesAuditEvents = await prisma.auditEvent.findMany({
      where: {
        eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED',
        targetId: salesOrderId,
      },
      orderBy: { occurredAt: 'desc' },
      take: 1,
      select: { metadata: true },
    })
    expect(salesAuditEvents).toHaveLength(1)
    expectAuditMetadata(salesAuditEvents[0]?.metadata ?? null, {
      automatic: true,
      changedPurchaseOrderCount: 1,
      fromStatus: 'PREPARING',
      source: 'PURCHASE_FACTORY_SHIPMENT',
      toStatus: 'LAND_TRANSIT',
      trigger: 'PURCHASE_FACTORY_SHIPMENT',
    })

    const historyCountBeforeRetry = await prisma.purchaseOrderStatusHistory.count({
      where: { purchaseOrderId: finalTarget.id, dimension: 'FULFILLMENT' },
    })
    await expect(factoryShipments.shipPurchaseOrder({
      actorUserId,
      requestId: `purchase-factory-retry-${suffix}`,
    }, finalTarget.id, {
      expectedVersion: finalTarget.version,
      partIds: finalTarget.parts.map(part => part.id),
      reason: 'E2E 安全重试不得重复写历史',
    })).resolves.toMatchObject({
      changedPurchaseOrderCount: 0,
      alreadySatisfiedCount: 1,
      remainingPendingShipmentCount: 0,
      salesOrder: {
        fulfillmentStatus: 'LAND_TRANSIT',
        advancedToLandTransit: false,
      },
    })
    await expect(prisma.purchaseOrderStatusHistory.count({
      where: { purchaseOrderId: finalTarget.id, dimension: 'FULFILLMENT' },
    })).resolves.toBe(historyCountBeforeRetry)
  })
})
