import { randomUUID } from 'node:crypto'

import { ConfigService } from '@nestjs/config'

import type { Prisma } from '../src/generated/prisma/client'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import type { AccessControlService } from '../src/modules/access-control/access-control.service'
import { AuditService } from '../src/modules/audit/audit.service'
import type { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import type { MediaAssetService } from '../src/modules/media/media-asset.service'
import type { NumberingGeneratorService } from '../src/modules/numbering/numbering-generator.service'
import { PurchaseOrderCommandService } from '../src/modules/purchase-orders/purchase-order-command.service'
import { PurchaseOrderCreateDependencyService } from '../src/modules/purchase-orders/purchase-order-create-dependency.service'
import { PurchaseOrderMutationService } from '../src/modules/purchase-orders/purchase-order-mutation.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseOrderSourceQueryService } from '../src/modules/purchase-orders/purchase-order-source-query.service'
import { SalesOrderPurchaseCoverageService } from '../src/modules/purchase-orders/sales-order-purchase-coverage.service'
import { SalesOrderAddOnService } from '../src/modules/sales-orders/sales-order-add-on.service'
import { SalesOrderAddOnQueryService } from '../src/modules/sales-orders/sales-order-add-on-query.service'
import { SalesOrderCommandService } from '../src/modules/sales-orders/sales-order-command.service'
import { SalesOrderMutationService } from '../src/modules/sales-orders/sales-order-mutation.service'
import { SalesOrderQueryService } from '../src/modules/sales-orders/sales-order-query.service'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for PurchaseOrder E2E tests')
  return value
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
  let createdTwdExchangeRate = false
  let cnyWasEnabled = false
  let issuanceVoucherMediaAssetId: string
  let paymentVoucherMediaAssetId: string
  let productId: string
  let provinceStateId: string
  let salesOrderId: string
  let splitSourceLineId: string
  let concurrentSourceLineId: string
  let customSourceLineId: string
  let twdCurrencyId: string
  let twdWasEnabled = false
  let prisma: PrismaService
  let commands: PurchaseOrderCommandService
  let mutations: PurchaseOrderMutationService
  let queries: PurchaseOrderQueryService
  let sourceQueries: PurchaseOrderSourceQueryService
  let addOns: SalesOrderAddOnService
  let addOnQueries: SalesOrderAddOnQueryService
  let salesMutations: SalesOrderMutationService
  let grantStockPermission = true
  let purchaseNumber = 0

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: requireDatabaseUrl() }),
    )
    await prisma.onModuleInit()

    const [cny, twd] = await Promise.all([
      prisma.currency.findUniqueOrThrow({
        where: { code: 'CNY' }, select: { enabled: true },
      }),
      prisma.currency.findUniqueOrThrow({
        where: { code: 'TWD' },
        select: { id: true, enabled: true, exchangeRate: { select: { id: true } } },
      }),
    ])
    cnyWasEnabled = cny.enabled
    twdCurrencyId = twd.id
    twdWasEnabled = twd.enabled
    if (twd.exchangeRate === null) {
      await prisma.exchangeRate.create({
        data: { currencyId: twd.id, foreignUnitsPerCny: '4.500000000000' },
      })
      createdTwdExchangeRate = true
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
      generateScoped: jest.fn(() => Promise.resolve({
        number: `PO-E2E-${suffix}-${++purchaseNumber}`,
        idempotentReplay: false,
      })),
    } as unknown as NumberingGeneratorService
    queries = new PurchaseOrderQueryService(prisma, dictionaryLookup)
    sourceQueries = new PurchaseOrderSourceQueryService(prisma, dictionaryLookup)
    addOns = new SalesOrderAddOnService(
      prisma,
      new AuditService(),
      dictionaryLookup,
    )
    addOnQueries = new SalesOrderAddOnQueryService(prisma, dictionaryLookup)
    salesMutations = new SalesOrderMutationService(
      prisma,
      new AuditService(),
      media,
      dictionaryLookup,
      salesQuery,
      { now: () => new Date('2026-08-27T11:30:00.000Z') },
    )
    commands = new PurchaseOrderCommandService(
      prisma,
      numbering,
      new AuditService(),
      new PurchaseOrderCreateDependencyService(dictionaryLookup, accessControl),
      new SalesOrderPurchaseCoverageService(new AuditService()),
      { businessToday: () => '2026-08-27' },
    )
    mutations = new PurchaseOrderMutationService(
      prisma,
      new AuditService(),
      dictionaryLookup,
      media,
      queries,
      { now: () => new Date('2026-08-27T12:00:00.000Z') },
    )
  })

  afterAll(async () => {
    if (prisma === undefined) return
    try {
      const orders = await prisma.purchaseOrder.findMany({
        where: { orderNo: { startsWith: `PO-E2E-${suffix}-` } },
        select: { id: true },
      })
      const purchaseOrderIds = orders.map(({ id }) => id)
      await prisma.$transaction(async (transaction) => {
        if (purchaseOrderIds.length > 0) {
          const where = { purchaseOrderId: { in: purchaseOrderIds } }
          await transaction.purchaseOrderDocument.deleteMany({ where })
          await transaction.purchaseOrderStatusHistory.deleteMany({ where })
          await transaction.purchaseOrderPayment.deleteMany({ where })
          await transaction.purchaseOrderLine.deleteMany({ where })
          await transaction.purchaseOrder.deleteMany({
            where: { id: { in: purchaseOrderIds } },
          })
        }
        if (salesOrderId !== undefined) {
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_documents" DISABLE TRIGGER "sales_order_documents_invariants_trigger"',
          )
          // 销售履约历史是 append-only；隔离 E2E 只在本清理事务内精确停用
          // 删除门禁，恢复后再提交，不改变任何生产运行时规则。
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_status_history" DISABLE TRIGGER "sales_order_status_history_immutable_trigger"',
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_payments" DISABLE TRIGGER "sales_order_payments_invariants_trigger"',
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_amount_revisions" DISABLE TRIGGER "sales_order_amount_revisions_immutable_trigger"',
          )
          await transaction.salesOrderDocument.deleteMany({
            where: { salesOrderId },
          })
          await transaction.salesOrderAmountRevision.deleteMany({
            where: { salesOrderId },
          })
          await transaction.salesOrderStatusHistory.deleteMany({
            where: { salesOrderId },
          })
          await transaction.salesOrderPayment.deleteMany({
            where: { salesOrderId },
          })
          await transaction.salesOrderLine.deleteMany({
            where: { salesOrderId },
          })
          await transaction.salesOrder.deleteMany({ where: { id: salesOrderId } })
          // READY 媒体的引用检查同样是 deferred；必须与凭证和订单一起在
          // `SET CONSTRAINTS` 前删除，否则夹具清理会留下媒体与地区业务数据。
          await transaction.mediaAsset.deleteMany({
            where: { id: { in: [
              issuanceVoucherMediaAssetId,
              paymentVoucherMediaAssetId,
            ] } },
          })
          await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_amount_revisions" ENABLE TRIGGER "sales_order_amount_revisions_immutable_trigger"',
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_payments" ENABLE TRIGGER "sales_order_payments_invariants_trigger"',
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_status_history" ENABLE TRIGGER "sales_order_status_history_immutable_trigger"',
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_documents" ENABLE TRIGGER "sales_order_documents_invariants_trigger"',
          )
        }
        if (productId !== undefined) {
          await transaction.product.deleteMany({ where: { id: productId } })
        }
        if (issuanceVoucherMediaAssetId !== undefined) {
          await transaction.mediaAsset.deleteMany({
            where: { id: { in: [
              issuanceVoucherMediaAssetId,
              paymentVoucherMediaAssetId,
            ] } },
          })
        }
        await transaction.region.deleteMany({ where: { code: `PX-${suffix}-C` } })
        await transaction.region.deleteMany({ where: { code: `PX-${suffix}-P` } })
        await transaction.region.deleteMany({ where: { code: `PX-${suffix}` } })
        await transaction.auditEvent.deleteMany({
          where: { actorUser: { username } },
        })
        await transaction.user.deleteMany({ where: { username } })
      })
      await prisma.currency.update({
        where: { code: 'CNY' }, data: { enabled: cnyWasEnabled },
      })
      await prisma.currency.update({
        where: { id: twdCurrencyId }, data: { enabled: twdWasEnabled },
      })
      if (createdTwdExchangeRate) {
        await prisma.exchangeRate.delete({ where: { currencyId: twdCurrencyId } })
      }
    }
    finally {
      await prisma.onModuleDestroy()
    }
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
      purchaseType: 'SALES_LINKED',
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
      purchaseType: 'SALES_LINKED',
      salesOrderId,
      supplierValue,
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
    expectedView: 'UNPURCHASED' | 'PARTIALLY_PURCHASED' | 'COMPLETED_PURCHASE_ADD_ON',
  ) {
    const result = await sourceQueries.salesOrders({
      view: expectedView,
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
        {
          value: 'COMPLETED_PURCHASE_ADD_ON',
          count: expectedView === 'COMPLETED_PURCHASE_ADD_ON' ? 1 : 0,
        },
      ],
    })
  }

  it('classifies a confirmed pending sales order without purchase facts as unpurchased', async () => {
    await expectSourceView('UNPURCHASED')
  })

  it('enforces admin stock creation and derives payment/pending state', async () => {
    const idempotencyKey = randomUUID()
    const stockInput = {
      purchaseType: 'STOCK',
      supplierValue,
      orderDate: '2026-08-27',
      shippingMarkText: ' E2E 唛头 ',
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
      purchaseType: 'STOCK',
      currencyCode: 'CNY',
      shippingMarkText: 'E2E 唛头',
      paymentStatus: 'UNPAID',
      lines: [{
        lineType: 'CUSTOM',
        referencePurchaseUnitPriceAmount: '25.0000',
        actualPurchaseUnitPriceAmount: '25.0000',
      }],
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
    })
    for (const toStatus of ['PREPARING', 'SHIPPED', 'SIGNED'] as const) {
      await mutations.updateFulfillmentStatus({
        actorUserId, requestId: `purchase-${toStatus}-${suffix}`,
      }, createdId, { toStatus })
    }
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
    })).resolves.toMatchObject({ total: 1 })
    await expect(mutations.updateOrderStatus({
      actorUserId, requestId: `purchase-cancel-paid-${suffix}`,
    }, createdId, { toStatus: 'CANCELLED' }))
      .rejects.toMatchObject({ code: 'PURCHASE_ORDER_CANCEL_HAS_PAYMENTS' })
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

  it('serializes disjoint final purchases and advances exactly once', async () => {
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
    await expectSourceView('COMPLETED_PURCHASE_ADD_ON')
  })

  it('atomically appends products once, becomes partial, and returns to completed after purchase', async () => {
    await salesMutations.recordPayment({
      actorUserId,
      requestId: `sales-payment-before-add-on-${suffix}`,
    }, salesOrderId, {
      paymentType: 'BALANCE',
      amount: '600',
      receivedAt: '2026-08-27T11:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
      remark: null,
      voucher: { mediaAssetId: paymentVoucherMediaAssetId },
    })
    const before = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: { version: true, paymentStatus: true, fulfillmentStatus: true },
    })
    expect(before).toMatchObject({
      paymentStatus: 'PAID',
      fulfillmentStatus: 'PREPARING',
    })
    const addOnInput = {
      expectedVersion: before.version,
      supplierValue,
      reason: '客户加购产品',
      lines: [{
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
      addOns.appendLines({
        actorUserId,
        requestId: `sales-add-on-a-${suffix}`,
      }, salesOrderId, addOnInput),
      addOns.appendLines({
        actorUserId,
        requestId: `sales-add-on-b-${suffix}`,
      }, salesOrderId, addOnInput),
    ])
    const succeeded = attempts.filter(
      (result): result is PromiseFulfilledResult<Awaited<
        ReturnType<SalesOrderAddOnService['appendLines']>
      >> => result.status === 'fulfilled',
    )
    const failed = attempts.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)
    const failedReason: unknown = failed[0]?.reason
    expect(failedReason).toMatchObject({
      code: 'SALES_ORDER_ADD_ON_VERSION_CONFLICT',
    })
    const result = succeeded[0]?.value
    if (result === undefined) throw new Error('Add-on result is unavailable')
    expect(result).toMatchObject({
      salesOrderId,
      previousVersion: before.version,
      version: before.version + 1,
      amountDelta: '180.0000',
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
      fulfillmentStatus: 'PREPARING',
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
    await expect(prisma.auditEvent.count({
      where: {
        eventType: 'SALES_ORDER_PRODUCT_APPENDED',
        targetId: { in: [...result.addedLineIds] },
      },
    })).resolves.toBe(2)
    await expectSourceView('PARTIALLY_PURCHASED')

    const sourceLines = await sourceQueries.salesOrderLines(salesOrderId)
    expect(sourceLines.items.slice(-2)).toMatchObject([{
      id: result.addedLineIds[0],
      lineType: 'CATALOG',
      purchasedQuantity: 0,
      remainingQuantity: 1,
    }, {
      id: result.addedLineIds[1],
      lineType: 'CUSTOM',
      purchasedQuantity: 0,
      remainingQuantity: 2,
    }])
    await commands.create(context(), linkedInput(result.addedLineIds[0], 1))
    await commands.create(context(), linkedCustomInput(result.addedLineIds[1], 2))
    await expect(commands.create(
      context(),
      linkedInput(result.addedLineIds[0], 1),
    )).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED',
    })
    await expectSourceView('COMPLETED_PURCHASE_ADD_ON')
    await expect(prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: { fulfillmentStatus: true },
    })).resolves.toEqual({ fulfillmentStatus: 'PREPARING' })
  })

  it('uses persisted fulfillment and order status to enforce the pre-sea add-on boundary', async () => {
    /*
     * 这里直接切换隔离数据库中的状态，是为了只验证加购资格查询对持久化事实的
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
        await expect(addOnQueries.context(salesOrderId)).resolves.toMatchObject({
          salesOrder: { fulfillmentStatus },
        })
      }

      for (const fulfillmentStatus of ['SEA_TRANSIT', 'SIGNED'] as const) {
        await prisma.salesOrder.update({
          where: { id: salesOrderId },
          data: { fulfillmentStatus },
        })
        await expect(addOnQueries.context(salesOrderId)).rejects.toMatchObject({
          status: 422,
          code: 'SALES_ORDER_ADD_ON_NOT_ALLOWED',
        })
      }

      await prisma.salesOrder.update({
        where: { id: salesOrderId },
        data: { orderStatus: 'CANCELLED', fulfillmentStatus: 'PREPARING' },
      })
      await expect(addOnQueries.context(salesOrderId)).rejects.toMatchObject({
        status: 422,
        code: 'SALES_ORDER_ADD_ON_NOT_ALLOWED',
      })
    }
    finally {
      await prisma.salesOrder.update({
        where: { id: salesOrderId },
        data: { orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING' },
      })
    }
  })
})
