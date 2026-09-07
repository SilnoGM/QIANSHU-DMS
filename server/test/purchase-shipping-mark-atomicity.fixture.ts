import { randomBytes, randomUUID } from 'node:crypto'

import type { Prisma } from '../src/generated/prisma/client'
import type { PrismaService } from '../src/infrastructure/database/prisma.service'
import type { AccessControlService } from '../src/modules/access-control/access-control.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { NumberingCommandService } from '../src/modules/numbering/numbering-command.service'
import { NumberingGeneratorService } from '../src/modules/numbering/numbering-generator.service'
import { NumberingQueryService } from '../src/modules/numbering/numbering-query.service'
import { PurchaseOrderCommandService } from '../src/modules/purchase-orders/purchase-order-command.service'
import { PurchaseOrderCreateDependencyService } from '../src/modules/purchase-orders/purchase-order-create-dependency.service'
import { PurchaseOrderMutationService } from '../src/modules/purchase-orders/purchase-order-mutation.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import type { MediaAssetService } from '../src/modules/media/media-asset.service'
import { SalesOrderPurchaseCoverageService } from '../src/modules/purchase-orders/sales-order-purchase-coverage.service'
import { PurchaseShippingMarkResolverService } from '../src/modules/purchase-shipping-marks/purchase-shipping-mark-resolver.service'
import { PurchaseShippingMarksService } from '../src/modules/purchase-shipping-marks/purchase-shipping-marks.service'
import { IsolatedNumberingPrismaService } from './numbering-e2e-database'
import { createPurchaseShippingMarkDatabase, createTestShippingMarkRule } from './purchase-shipping-mark-e2e-database'

export const MARK_CONSUMER = 'PURCHASE_ORDER.SHIPPING_MARK'

export async function createAtomicityFixture() {
  const database = await createPurchaseShippingMarkDatabase()
  const prisma = new IsolatedNumberingPrismaService(database) as unknown as PrismaService
  try {
    await prisma.onModuleInit()
    const actor = await prisma.user.create({ data: {
      username: 'mark-atomicity', usernameNormalized: 'mark-atomicity',
      displayName: 'Mark atomicity', passwordChangedAt: new Date(),
      passwordHash: 'e2e-only-not-a-real-password-hash',
    } })
    await prisma.currency.updateMany({ where: { code: 'CNY' }, data: { enabled: true } })
    const audit = new AuditService()
    const numberingCommands = new NumberingCommandService(prisma, audit, new NumberingQueryService(prisma))
    const configContext = { actorUserId: actor.id, requestId: randomUUID() }
    const purchaseRule = await numberingCommands.create(configContext, {
      ruleCode: 'PURCHASE_ORDER', purpose: 'BUSINESS', name: 'Purchase order',
      resetPolicy: 'NEVER',
      segments: [{ type: 'FIXED', value: 'PO' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }],
    })
    const published = await numberingCommands.publish(configContext, purchaseRule.id, {
      expectedVersion: purchaseRule.version, draftRevision: 1,
    })
    await numberingCommands.enable(configContext, purchaseRule.id, { expectedVersion: published.version })
    const customRule = await createTestShippingMarkRule(prisma, actor.id, 'CUSTOM_MARK')
    const lookup = new DictionaryLookupService(prisma)
    const resolver = new PurchaseShippingMarkResolverService(prisma, lookup)
    const numbering = new NumberingGeneratorService(prisma)
    // 仅替代身份权限查询；采购依赖校验、规则解析、两类发号与审计均使用正式实现。
    const access = {
      getPermissionCodesInTransaction: () => Promise.resolve(['purchase-orders:create-stock']),
      hasAll: () => true,
    } as unknown as AccessControlService
    const dependencies = new PurchaseOrderCreateDependencyService(lookup, access)
    const salesProgress = new SalesOrderPurchaseCoverageService(audit)
    const bindings = new PurchaseShippingMarksService(prisma, lookup, audit)
    const fixture = {
      prisma, actor, audit, numberingCommands, configContext, customRule,
      resolver, numbering, dependencies, salesProgress, bindings,
      context: (idempotencyKey = randomUUID()) => ({
        actorUserId: actor.id, idempotencyKey, requestId: randomUUID(),
      }),
      async dispose() {
        await prisma.onModuleDestroy()
        await database.dispose()
      },
    }
    return fixture
  }
  catch (error) {
    await prisma.onModuleDestroy()
    await database.dispose()
    throw error
  }
}

export type AtomicityFixture = Awaited<ReturnType<typeof createAtomicityFixture>>

export function createCommands(
  fixture: AtomicityFixture,
  wrap?: (transaction: Prisma.TransactionClient) => Prisma.TransactionClient,
  afterCommit?: () => void,
) {
  const prisma = wrap === undefined && afterCommit === undefined ? fixture.prisma : {
    purchaseOrder: fixture.prisma.purchaseOrder,
    $transaction: async <T>(action: (transaction: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) => {
      const result = await fixture.prisma.$transaction(transaction => action(wrap?.(transaction) ?? transaction), options)
      if (options?.isolationLevel === 'Serializable') afterCommit?.()
      return result
    },
  } as unknown as PrismaService
  return new PurchaseOrderCommandService(
    prisma, fixture.numbering, fixture.audit, fixture.dependencies,
    fixture.resolver, { businessToday: () => '2026-09-07' },
  )
}

export function createReviewMutations(fixture: AtomicityFixture) {
  const lookup = new DictionaryLookupService(fixture.prisma)
  return new PurchaseOrderMutationService(
    fixture.prisma, fixture.audit, lookup, {} as MediaAssetService,
    new PurchaseOrderQueryService(fixture.prisma, lookup), fixture.salesProgress,
  )
}

export async function customInput(fixture: AtomicityFixture) {
  const resolution = await fixture.resolver.read({ productMode: 'CUSTOM' })
  if (resolution.resolutionToken === null) throw new Error('Custom fixture rule is unavailable')
  return {
    purchaseType: 'STOCK', productMode: 'CUSTOM', customSupplierName: 'Custom supplier',
    orderDate: '2026-09-07', expectedShippingMarkResolution: resolution.resolutionToken,
    lines: [{ lineType: 'CUSTOM', name: 'Custom item', referencePurchaseUnitPriceAmount: '10',
      actualPurchaseUnitPriceAmount: '10', quantity: 1 }],
    purchaseTotalAmount: '10', depositDueAmount: '0', balanceDueAmount: '10',
  }
}

export async function prepareCatalog(fixture: AtomicityFixture) {
  const { prisma, actor } = fixture
  const supplierValue = 'MARK_SUPPLIER'
  const type = await prisma.dictionaryType.findUniqueOrThrow({ where: { code: 'service_provider.supplier' } })
  await prisma.dictionaryItem.create({ data: { dictionaryTypeId: type.id, value: supplierValue, label: 'Mark supplier', enabled: true } })
  await prisma.dictionaryType.update({ where: { id: type.id }, data: { enabled: true } })
  const rule = await createTestShippingMarkRule(prisma, actor.id, 'CATALOG_MARK')
  await fixture.bindings.save(fixture.configContext, supplierValue, { ruleId: rule.id, expectedVersion: 0 })
  const product = await prisma.product.create({ data: {
    productNo: 'ATOMIC_PRODUCT', name: 'Atomic product', status: 'ACTIVE',
    supplierValue, purchaseCostAmount: '10', purchaseCostCurrency: 'CNY',
    createdByUserId: actor.id, updatedByUserId: actor.id,
  } })
  const resolution = await fixture.resolver.read({ productMode: 'CATALOG', supplierValue })
  if (resolution.resolutionToken === null) throw new Error('Catalog fixture rule is unavailable')
  return {
    supplierValue, rule,
    input: {
      purchaseType: 'STOCK', productMode: 'CATALOG', supplierValue,
      orderDate: '2026-09-07', expectedShippingMarkResolution: resolution.resolutionToken,
      lines: [{ lineType: 'CATALOG', productId: product.id, actualPurchaseUnitPriceAmount: '10', quantity: 1 }],
      purchaseTotalAmount: '10', depositDueAmount: '0', balanceDueAmount: '10',
    },
  }
}

export async function atomicFacts(prisma: Pick<Prisma.TransactionClient, 'numberingIssuance' | 'numberingPeriodState' | 'purchaseOrder' | 'purchaseOrderLine' | 'auditEvent'>) {
  const [ledger, periods, orders, lines, audits] = await Promise.all([
    prisma.numberingIssuance.findMany({ where: { consumerCode: MARK_CONSUMER }, orderBy: { id: 'asc' } }),
    prisma.numberingPeriodState.findMany({ where: { rule: { purpose: 'SHIPPING_MARK' } }, orderBy: { id: 'asc' } }),
    prisma.purchaseOrder.findMany({ orderBy: { id: 'asc' } }),
    prisma.purchaseOrderLine.findMany({ orderBy: { id: 'asc' } }),
    prisma.auditEvent.findMany({ where: { eventType: { in: ['PURCHASE_ORDER_CREATED', 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED'] } }, orderBy: { id: 'asc' } }),
  ])
  return { ledger, periods, orders, lines, audits }
}

export async function prepareSalesSource(fixture: AtomicityFixture) {
  const { prisma, actor } = fixture
  const regions: string[] = []
  for (const level of ['COUNTRY_REGION', 'PROVINCE_STATE', 'CITY'] as const) {
    const region = await prisma.region.create({ data: {
      code: level, name: level, normalizedName: level, administrativeType: level,
      level, enabled: true, parentId: regions.at(-1),
    } })
    regions.push(region.id)
  }
  const source = await prisma.salesOrder.create({ data: {
    orderNo: 'ATOMIC_SALES', createIdempotencyKeyHash: randomBytes(32),
    createRequestFingerprintHash: randomBytes(32), orderDate: new Date('2026-09-07'),
    issuerUserId: actor.id, currencyCode: 'TWD', customerName: 'Customer', customerPhone: '12345678',
    customerCountryRegionId: regions[0], customerProvinceStateId: regions[1], customerCityId: regions[2],
    customerCountryRegionCodeSnapshot: 'COUNTRY_REGION', customerProvinceStateCodeSnapshot: 'PROVINCE_STATE', customerCityCodeSnapshot: 'CITY',
    customerCountryRegionNameSnapshot: 'Country', customerProvinceStateNameSnapshot: 'Province', customerCityNameSnapshot: 'City',
    customerAddressDetail: 'Road1', customerFullAddressSnapshot: 'CountryProvinceCityRoad1',
    lineSubtotalAmount: '10', agreedTotalAmount: '10', depositDueAmount: '0', balanceDueAmount: '10',
    orderStatus: 'CONFIRMED', fulfillmentStatus: 'PENDING', paymentStatus: 'UNPAID',
    lines: { create: { lineNumber: 1, lineType: 'CUSTOM', productNameSnapshot: 'Custom item',
      actualUnitPriceAmount: '10', quantity: 1, lineTotalAmount: '10' } },
  }, include: { lines: true } })
  const request = await customInput(fixture)
  return {
    source,
    input: { ...request, purchaseType: 'SALES_LINKED', salesOrderId: source.id,
      lines: [{ ...request.lines[0], sourceSalesOrderLineId: source.lines[0].id }] },
  }
}
