import type { Prisma } from '../../generated/prisma/client'
import type { AccessControlService } from '../access-control/access-control.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import { normalizePurchaseOrderCreateCommand } from './purchase-order-command.normalizer'
import { PurchaseOrderCreateDependencyService } from './purchase-order-create-dependency.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SALES_ORDER_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const SOURCE_LINE_ID = '33333333-3333-4333-8333-333333333333'

function linkedCommand(line: Record<string, unknown> = {}) {
  return normalizePurchaseOrderCreateCommand({
    purchaseType: 'SALES_LINKED',
    salesOrderId: SALES_ORDER_ID,
    supplierValue: 'SUPPLIER_A',
    orderDate: '2026-08-27',
    lines: [{
      lineType: 'CATALOG',
      productId: PRODUCT_ID,
      sourceSalesOrderLineId: SOURCE_LINE_ID,
      actualPurchaseUnitPriceAmount: '10',
      quantity: 2,
      ...line,
    }],
    purchaseTotalAmount: '20',
    depositDueAmount: '5',
    balanceDueAmount: '15',
  }, '2026-08-27')
}

function stockCommand() {
  return normalizePurchaseOrderCreateCommand({
    purchaseType: 'STOCK',
    supplierValue: 'SUPPLIER_A',
    orderDate: '2026-08-27',
    lines: [{
      lineType: 'CUSTOM',
      name: '临时包装',
      description: '备货说明',
      referencePurchaseUnitPriceAmount: '10',
      actualPurchaseUnitPriceAmount: '10',
      quantity: 2,
    }],
    purchaseTotalAmount: '20',
    depositDueAmount: '0',
    balanceDueAmount: '20',
  }, '2026-08-27')
}

function setup() {
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ id: SOURCE_LINE_ID }]),
    currency: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ code: 'CNY' }),
    },
    salesOrder: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: SALES_ORDER_ID }),
    },
    salesOrderLine: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        id: SOURCE_LINE_ID,
        salesOrderId: SALES_ORDER_ID,
        lineType: 'CATALOG',
        productId: PRODUCT_ID,
        productNoSnapshot: 'P-001',
        productNameSnapshot: '销售快照产品',
        productAttributesSnapshot: [{ title: '颜色', value: '红' }],
        descriptionSnapshot: '销售行说明',
        quantity: 3,
      }]),
    },
    product: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        id: PRODUCT_ID,
        productNo: 'P-NEW',
        name: '当前产品名称',
        attributes: [{ title: '颜色', value: '蓝' }],
        status: 'ACTIVE',
        supplierValue: 'SUPPLIER_A',
        purchaseCostAmount: { toFixed: () => '12.3456' },
        purchaseCostCurrency: 'CNY',
      }]),
    },
    purchaseOrderLine: {
      groupBy: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([]),
    },
  }
  const dictionaryLookup = {
    requireEffectiveValue: jest.fn<Promise<unknown>, [unknown, unknown]>()
      .mockResolvedValue({
        dictionaryCode: 'service_provider.supplier',
        value: 'SUPPLIER_A',
        label: '供应商 A',
        tone: 'DEFAULT',
      }),
  }
  const accessControl = {
    getPermissionCodesInTransaction: jest.fn<Promise<string[]>, [unknown, string]>()
      .mockResolvedValue(['purchase-orders:create-stock']),
    hasAll: jest.fn<boolean, [readonly string[], readonly string[]]>(
      (granted, required) => required.every(code => granted.includes(code)),
    ),
  }
  const service = new PurchaseOrderCreateDependencyService(
    dictionaryLookup as unknown as DictionaryLookupService,
    accessControl as unknown as AccessControlService,
  )
  return { accessControl, dictionaryLookup, service, transaction }
}

describe('PurchaseOrderCreateDependencyService', () => {
  it('uses the sales snapshot but the current product purchase cost', async () => {
    const fixture = setup()
    const resolved = await fixture.service.requireDependencies(
      fixture.transaction as unknown as Prisma.TransactionClient,
      linkedCommand(),
      ACTOR_ID,
      { lockSalesLines: true },
    )

    expect(resolved.lines).toEqual([{
      lineNumber: 1,
      lineType: 'CATALOG',
      productId: PRODUCT_ID,
      sourceSalesOrderLineId: SOURCE_LINE_ID,
      productNoSnapshot: 'P-001',
      productNameSnapshot: '销售快照产品',
      productAttributesSnapshot: [{ title: '颜色', value: '红' }],
      descriptionSnapshot: '销售行说明',
      referencePurchaseUnitPriceAmount: '12.3456',
      actualPurchaseUnitPriceAmount: '10.0000',
      quantity: 2,
      lineTotalAmount: '20.0000',
    }])
    expect(fixture.transaction.$queryRaw).toHaveBeenCalledTimes(1)
    expect(fixture.dictionaryLookup.requireEffectiveValue).toHaveBeenCalledWith(
      fixture.transaction,
      { dictionaryCode: 'service_provider.supplier', value: 'SUPPLIER_A' },
    )
  })

  it('copies a linked CUSTOM sales snapshot while keeping both manual prices', async () => {
    const fixture = setup()
    fixture.transaction.salesOrderLine.findMany.mockResolvedValue([{
      id: SOURCE_LINE_ID,
      salesOrderId: SALES_ORDER_ID,
      lineType: 'CUSTOM',
      productId: null,
      productNoSnapshot: null,
      productNameSnapshot: '销售临时产品',
      productAttributesSnapshot: [],
      descriptionSnapshot: '销售临时说明',
      quantity: 3,
    }])
    fixture.transaction.product.findMany.mockResolvedValue([])
    const command = linkedCommand({
      lineType: 'CUSTOM',
      productId: undefined,
      referencePurchaseUnitPriceAmount: '10',
    })

    await expect(fixture.service.requireDependencies(
      fixture.transaction as unknown as Prisma.TransactionClient,
      command,
      ACTOR_ID,
      { lockSalesLines: false },
    )).resolves.toMatchObject({ lines: [{
      lineType: 'CUSTOM',
      productId: null,
      productNoSnapshot: null,
      productNameSnapshot: '销售临时产品',
      descriptionSnapshot: '销售临时说明',
      referencePurchaseUnitPriceAmount: '10.0000',
      actualPurchaseUnitPriceAmount: '10.0000',
    }] })
  })

  it('requires the system-only permission for STOCK and maps its manual CUSTOM snapshot', async () => {
    const fixture = setup()
    const resolved = await fixture.service.requireDependencies(
      fixture.transaction as unknown as Prisma.TransactionClient,
      stockCommand(),
      ACTOR_ID,
      { lockSalesLines: true },
    )
    expect(fixture.accessControl.getPermissionCodesInTransaction)
      .toHaveBeenCalledWith(fixture.transaction, ACTOR_ID)
    expect(resolved.lines).toMatchObject([{
      lineType: 'CUSTOM',
      sourceSalesOrderLineId: null,
      productNameSnapshot: '临时包装',
      descriptionSnapshot: '备货说明',
    }])

    fixture.accessControl.getPermissionCodesInTransaction.mockResolvedValue([])
    await expect(fixture.service.requireDependencies(
      fixture.transaction as unknown as Prisma.TransactionClient,
      stockCommand(),
      ACTOR_ID,
      { lockSalesLines: false },
    )).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it.each([
    ['PURCHASE_ORDER_PRODUCT_UNAVAILABLE', { status: 'DRAFT' }],
    ['PURCHASE_ORDER_PRODUCT_SUPPLIER_MISMATCH', { supplierValue: 'SUPPLIER_B' }],
    ['PURCHASE_ORDER_PRODUCT_COST_UNAVAILABLE', { purchaseCostAmount: null }],
    ['PURCHASE_ORDER_PRODUCT_COST_UNAVAILABLE', { purchaseCostCurrency: 'TWD' }],
  ])('rejects invalid current product dependency with %s', async (code, override) => {
    const fixture = setup()
    fixture.transaction.product.findMany.mockResolvedValue([{
      id: PRODUCT_ID,
      productNo: 'P-NEW',
      name: '当前产品名称',
      attributes: [],
      status: 'ACTIVE',
      supplierValue: 'SUPPLIER_A',
      purchaseCostAmount: { toFixed: () => '12.0000' },
      purchaseCostCurrency: 'CNY',
      ...override,
    }])

    await expect(fixture.service.requireDependencies(
      fixture.transaction as unknown as Prisma.TransactionClient,
      linkedCommand(),
      ACTOR_ID,
      { lockSalesLines: false },
    )).rejects.toMatchObject({ code })
  })

  it('rejects a source with mismatched type/product or sales order', async () => {
    for (const override of [
      { salesOrderId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
      { lineType: 'CUSTOM' },
      { productId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
    ]) {
      const fixture = setup()
      fixture.transaction.salesOrderLine.findMany.mockResolvedValue([{
        id: SOURCE_LINE_ID,
        salesOrderId: SALES_ORDER_ID,
        lineType: 'CATALOG',
        productId: PRODUCT_ID,
        productNoSnapshot: 'P-001',
        productNameSnapshot: '销售快照产品',
        productAttributesSnapshot: [],
        descriptionSnapshot: null,
        quantity: 3,
        ...override,
      }])
      await expect(fixture.service.requireDependencies(
        fixture.transaction as unknown as Prisma.TransactionClient,
        linkedCommand(),
        ACTOR_ID,
        { lockSalesLines: false },
      )).rejects.toMatchObject({ code: 'PURCHASE_ORDER_SOURCE_LINE_INVALID' })
    }
  })

  it('rejects cumulative active quantity above the sales line quantity', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrderLine.groupBy.mockResolvedValue([{
      sourceSalesOrderLineId: SOURCE_LINE_ID,
      _sum: { quantity: 2 },
    }])
    await expect(fixture.service.requireDependencies(
      fixture.transaction as unknown as Prisma.TransactionClient,
      linkedCommand(),
      ACTOR_ID,
      { lockSalesLines: true },
    )).rejects.toMatchObject({ code: 'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED' })
  })
})
