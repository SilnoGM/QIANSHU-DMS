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
import { SalesOrderCommandService } from '../src/modules/sales-orders/sales-order-command.service'
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
  let countryRegionId: string
  let createdTwdExchangeRate = false
  let cnyWasEnabled = false
  let issuanceVoucherMediaAssetId: string
  let productId: string
  let provinceStateId: string
  let salesOrderId: string
  let splitSourceLineId: string
  let concurrentSourceLineId: string
  let twdCurrencyId: string
  let twdWasEnabled = false
  let prisma: PrismaService
  let commands: PurchaseOrderCommandService
  let mutations: PurchaseOrderMutationService
  let queries: PurchaseOrderQueryService
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
      }],
      agreedTotalAmount: '300',
      depositDueAmount: '0',
      balanceDueAmount: '300',
      issuanceVoucher: { mediaAssetId: issuanceVoucherMediaAssetId },
      remark: null,
    })
    salesOrderId = salesOrder.id
    const firstSourceId = salesOrder.lines[0]?.id
    const secondSourceId = salesOrder.lines[1]?.id
    if (typeof firstSourceId !== 'string' || typeof secondSourceId !== 'string') {
      throw new Error('Sales source lines were not persisted')
    }
    splitSourceLineId = firstSourceId
    concurrentSourceLineId = secondSourceId

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
    commands = new PurchaseOrderCommandService(
      prisma,
      numbering,
      new AuditService(),
      new PurchaseOrderCreateDependencyService(dictionaryLookup, accessControl),
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
          await transaction.salesOrderDocument.deleteMany({
            where: { salesOrderId },
          })
          await transaction.salesOrderLine.deleteMany({
            where: { salesOrderId },
          })
          await transaction.salesOrder.deleteMany({ where: { id: salesOrderId } })
          // READY 媒体的引用检查同样是 deferred；必须与凭证和订单一起在
          // `SET CONSTRAINTS` 前删除，否则夹具清理会留下媒体与地区业务数据。
          await transaction.mediaAsset.deleteMany({
            where: { id: issuanceVoucherMediaAssetId },
          })
          await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_documents" ENABLE TRIGGER "sales_order_documents_invariants_trigger"',
          )
        }
        if (productId !== undefined) {
          await transaction.product.deleteMany({ where: { id: productId } })
        }
        if (issuanceVoucherMediaAssetId !== undefined) {
          await transaction.mediaAsset.deleteMany({
            where: { id: issuanceVoucherMediaAssetId },
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
    for (const toStatus of ['ORDERED', 'PREPARING', 'SHIPPED', 'SIGNED'] as const) {
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
    await commands.create(context(), linkedInput(splitSourceLineId, 1))
    await expect(commands.create(context(), linkedInput(splitSourceLineId, 1)))
      .rejects.toMatchObject({ code: 'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED' })

    await mutations.updateOrderStatus({
      actorUserId, requestId: `purchase-cancel-release-${suffix}`,
    }, first, { toStatus: 'CANCELLED', reason: '释放来源数量' })
    await expect(commands.create(context(), linkedInput(splitSourceLineId, 1)))
      .resolves.toEqual(expect.any(String))
    const aggregate = await prisma.purchaseOrderLine.aggregate({
      where: {
        sourceSalesOrderLineId: splitSourceLineId,
        purchaseOrder: { orderStatus: { not: 'CANCELLED' } },
      },
      _sum: { quantity: true },
    })
    expect(aggregate._sum.quantity).toBe(2)
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
  })
})
