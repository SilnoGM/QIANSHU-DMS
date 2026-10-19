import { randomUUID } from 'node:crypto'

import { ConfigService } from '@nestjs/config'

import type { Prisma } from '../src/generated/prisma/client'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuditService } from '../src/modules/audit/audit.service'
import type { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import type { MediaAssetService } from '../src/modules/media/media-asset.service'
import type { NumberingGeneratorService } from '../src/modules/numbering/numbering-generator.service'
import { SalesOrderCommandService } from '../src/modules/sales-orders/sales-order-command.service'
import { SalesOrderMutationService } from '../src/modules/sales-orders/sales-order-mutation.service'
import { SalesOrderAutomaticStateService } from '../src/modules/sales-orders/sales-order-automatic-state.service'
import { SalesOrderQueryService } from '../src/modules/sales-orders/sales-order-query.service'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for SalesOrder E2E tests')
  return value
}

describe('SalesOrder services with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
  const idempotencyKey = randomUUID()
  let actorUserId: string
  let cityId: string
  let countryRegionId: string
  let createdTwdExchangeRate = false
  let productId: string
  let issuanceVoucherMediaAssetId: string
  let paymentVoucherMediaAssetId: string
  let provinceStateId: string
  let twdCurrencyId: string
  let twdWasEnabled = false
  let prisma: PrismaService
  let commands: SalesOrderCommandService
  let mutations: SalesOrderMutationService

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: requireDatabaseUrl() }),
    )
    await prisma.onModuleInit()
    const twd = await prisma.currency.findUniqueOrThrow({
      where: { code: 'TWD' },
      select: { id: true, enabled: true, exchangeRate: { select: { id: true } } },
    })
    twdCurrencyId = twd.id
    twdWasEnabled = twd.enabled
    if (twd.exchangeRate === null) {
      await prisma.exchangeRate.create({
        data: {
          currencyId: twd.id,
          foreignUnitsPerCny: '4.500000000000',
        },
      })
      createdTwdExchangeRate = true
    }
    await prisma.currency.update({ where: { code: 'TWD' }, data: { enabled: true } })
    const actor = await prisma.user.create({
      data: {
        displayName: 'SalesOrder E2E',
        passwordChangedAt: new Date(),
        passwordHash: 'e2e-only-not-a-real-password-hash',
        username: `sales-order-e2e-${suffix.toLowerCase()}`,
        usernameNormalized: `sales-order-e2e-${suffix.toLowerCase()}`,
      },
      select: { id: true },
    })
    actorUserId = actor.id
    const createTemporaryVoucher = (name: string) => prisma.mediaAsset.create({
      data: {
        mediaType: 'DOCUMENT',
        status: 'UPLOADING',
        objectKey: `assets/sales-order-e2e-${suffix.toLowerCase()}-${name}.pdf`,
        originalFilename: `${name}.pdf`,
        uploadExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
        createdByUserId: actor.id,
      },
      select: { id: true },
    })
    issuanceVoucherMediaAssetId = (await createTemporaryVoucher('issuance')).id
    paymentVoucherMediaAssetId = (await createTemporaryVoucher('payment')).id
    const country = await prisma.region.create({
      data: {
        administrativeType: 'COUNTRY_REGION',
        code: `ZZ-${suffix}`,
        enabled: true,
        level: 'COUNTRY_REGION',
        name: `测试国家${suffix}`,
        normalizedName: `测试国家${suffix}`,
      },
      select: { id: true },
    })
    countryRegionId = country.id
    const province = await prisma.region.create({
      data: {
        administrativeType: 'PROVINCE_STATE',
        code: `ZZ-${suffix}-P`,
        enabled: true,
        level: 'PROVINCE_STATE',
        name: `测试省${suffix}`,
        normalizedName: `测试省${suffix}`,
        parentId: country.id,
      },
      select: { id: true },
    })
    provinceStateId = province.id
    const city = await prisma.region.create({
      data: {
        administrativeType: 'CITY',
        code: `ZZ-${suffix}-C`,
        enabled: true,
        level: 'CITY',
        name: `测试市${suffix}`,
        normalizedName: `测试市${suffix}`,
        parentId: province.id,
      },
      select: { id: true },
    })
    cityId = city.id
    const product = await prisma.product.create({
      data: {
        attributes: [{ title: '颜色', value: '红' }],
        createdByUserId: actor.id,
        name: `销售测试产品${suffix}`,
        productNo: `SO-P-${suffix}`,
        status: 'ACTIVE',
        // 产品快照测试只要求满足数据库的 ACTIVE 产品不变量；供应商字典有效性
        // 属于产品写服务边界，不在销售订单服务夹具中重复搭建。
        supplierValue: `SO-SUPPLIER-${suffix}`,
        twdSalePriceAmount: '60.00',
        updatedByUserId: actor.id,
      },
      select: { id: true },
    })
    productId = product.id

    const query = new SalesOrderQueryService(prisma)
    const numbering = {
      generateScoped: jest.fn().mockResolvedValue({
        number: `SO-E2E-${suffix}`,
        idempotentReplay: false,
      }),
    } as unknown as NumberingGeneratorService
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
    const dictionaryLookup = {
      requireEffectiveValue: jest.fn().mockResolvedValue({
        dictionaryCode: 'payment.method',
        label: '银行转账',
        tone: 'DEFAULT',
        value: 'BANK_TRANSFER',
      }),
    } as unknown as DictionaryLookupService
    commands = new SalesOrderCommandService(
      prisma,
      numbering,
      new AuditService(),
      media,
      query,
      { businessToday: () => '2026-08-20' },
    )
    mutations = new SalesOrderMutationService(
      prisma,
      new AuditService(),
      media,
      dictionaryLookup,
      query,
      new SalesOrderAutomaticStateService(new AuditService()),
      { now: () => new Date('2026-08-20T12:00:00.000Z') },
    )
  })

  afterAll(async () => {
    if (prisma === undefined) return
    try {
      /*
       * beforeAll 任一步骤都可能失败，因此清理不能依赖所有局部 ID 已赋值。
       * 统一按本测试唯一 suffix 反查并按 Restrict 外键的逆序删除，避免残留
       * Region/User 污染同一数据库内随后运行的独立 E2E 套件。
       */
      const orders = await prisma.salesOrder.findMany({
        where: { orderNo: `SO-E2E-${suffix}` },
        select: { id: true },
      })
      const salesOrderIds = orders.map(({ id }) => id)
      await prisma.$transaction(async (transaction) => {
        if (salesOrderIds.length > 0) {
          // 生产表采用 append-only/soft-void 语义。一次性 E2E 数据库只在本
          // 事务内精确停用四个删除门禁，恢复后再提交，不改变运行时边界。
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_documents" DISABLE TRIGGER "sales_order_documents_invariants_trigger"',
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_payments" DISABLE TRIGGER "sales_order_payments_invariants_trigger"',
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_status_history" DISABLE TRIGGER "sales_order_status_history_immutable_trigger"',
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_amount_revisions" DISABLE TRIGGER "sales_order_amount_revisions_immutable_trigger"',
          )
          const where = { salesOrderId: { in: salesOrderIds } }
          await transaction.salesOrderDocument.deleteMany({ where })
          await transaction.salesOrderAmountRevision.deleteMany({ where })
          await transaction.salesOrderStatusHistory.deleteMany({ where })
          await transaction.salesOrderPayment.deleteMany({ where })
          await transaction.salesOrderLine.deleteMany({ where })
          await transaction.salesOrder.deleteMany({
            where: { id: { in: salesOrderIds } },
          })
          // 凭证关联删除也会登记 deferred 媒体引用校验。必须在统一结算约束
          // 之前一并删除本夹具拥有的媒体，否则 READY 媒体会短暂成为孤儿。
          await transaction.mediaAsset.deleteMany({
            where: { id: { in: [
              issuanceVoucherMediaAssetId,
              paymentVoucherMediaAssetId,
            ] } },
          })
          // DELETE 会登记 deferred 汇总校验；订单已删除后先结算事件，才能
          // 在同一事务内安全恢复 payment 表的普通触发器。
          await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_amount_revisions" ENABLE TRIGGER "sales_order_amount_revisions_immutable_trigger"',
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_status_history" ENABLE TRIGGER "sales_order_status_history_immutable_trigger"',
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_payments" ENABLE TRIGGER "sales_order_payments_invariants_trigger"',
          )
          await transaction.$executeRawUnsafe(
            'ALTER TABLE "sales_order_documents" ENABLE TRIGGER "sales_order_documents_invariants_trigger"',
          )
        }
        await transaction.product.deleteMany({
          where: { productNo: `SO-P-${suffix}` },
        })
        await transaction.mediaAsset.deleteMany({
          where: { id: { in: [
            issuanceVoucherMediaAssetId,
            paymentVoucherMediaAssetId,
          ] } },
        })
        await transaction.region.deleteMany({
          where: { code: `ZZ-${suffix}-C` },
        })
        await transaction.region.deleteMany({
          where: { code: `ZZ-${suffix}-P` },
        })
        await transaction.region.deleteMany({
          where: { code: `ZZ-${suffix}` },
        })
        await transaction.auditEvent.deleteMany({
          where: { actorUser: { username: `sales-order-e2e-${suffix.toLowerCase()}` } },
        })
        await transaction.user.deleteMany({
          where: { username: `sales-order-e2e-${suffix.toLowerCase()}` },
        })
      })
      if (twdCurrencyId !== undefined) {
        await prisma.currency.update({
          where: { id: twdCurrencyId },
          data: { enabled: twdWasEnabled },
        })
        if (createdTwdExchangeRate) {
          await prisma.exchangeRate.delete({
            where: { currencyId: twdCurrencyId },
          })
        }
      }
    }
    finally {
      await prisma.onModuleDestroy()
    }
  })

  function commandInput() {
    return {
      orderDate: '2026-08-20',
      currencyCode: 'TWD',
      customer: {
        name: '王小明',
        phone: '0912345678',
        countryRegionId,
        provinceStateId,
        cityId,
        addressDetail: ' 测试路 100 号 ',
      },
      lines: [{
        lineType: 'CATALOG',
        productId,
        actualUnitPriceAmount: '50',
        quantity: 2,
      }],
      agreedTotalAmount: '100',
      depositDueAmount: '30',
      balanceDueAmount: '70',
      issuanceVoucher: { mediaAssetId: issuanceVoucherMediaAssetId },
      remark: null,
    }
  }

  it('creates one snapshot order idempotently and persists real payment derivation', async () => {
    const context = {
      actorUserId,
      idempotencyKey,
      requestId: `sales-order-create-${suffix}`,
    }
    const created = await commands.create(context, commandInput())
    expect(created).toMatchObject({
      orderNo: `SO-E2E-${suffix}`,
      currencyCode: 'TWD',
      customer: {
        addressDetail: '测试路100号',
        fullAddress: `测试国家${suffix}测试省${suffix}测试市${suffix}测试路100号`,
      },
      amounts: {
        lineSubtotalAmount: '100.00',
        agreedTotalAmount: '100.00',
        receivedAmount: '0.00',
      },
      paymentStatus: 'UNPAID',
    })
    await expect(commands.create(context, commandInput()))
      .resolves.toMatchObject({ id: created.id })
    expect(await prisma.salesOrder.count({
      where: { orderNo: `SO-E2E-${suffix}` },
    })).toBe(1)

    // 实际数据库中的采购覆盖为空时，手工履约请求也必须停留在待采购，
    // 不能依赖前端隐藏按钮或直接改状态来省略审核前提。
    await expect(mutations.updateFulfillmentStatus({
      actorUserId,
      requestId: `sales-order-unreviewed-${suffix}`,
    }, created.id, { toStatus: 'PREPARING' }))
      .rejects.toMatchObject({ code: 'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID' })
    await expect(prisma.salesOrder.findUniqueOrThrow({
      where: { id: created.id },
      select: { fulfillmentStatus: true, version: true },
    })).resolves.toEqual({ fulfillmentStatus: 'PENDING', version: 1 })

    await expect(mutations.recordPayment({ actorUserId, requestId: `sales-order-payment-${suffix}` }, created.id, {
      paymentType: 'DEPOSIT', amount: '30', receivedAt: '2026-08-20T10:00:00.000Z', paymentMethod: 'BANK_TRANSFER', remark: null, voucher: { mediaAssetId: paymentVoucherMediaAssetId },
    })).rejects.toMatchObject({ code: 'SALES_ORDER_RECEIPT_REVIEW_REQUIRED' })
    expect(await prisma.salesOrderPayment.count({ where: { salesOrderId: created.id } })).toBe(0)
  })
})
