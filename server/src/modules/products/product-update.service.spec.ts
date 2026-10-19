import type { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  DictionaryTone,
  ProductStatus,
} from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type {
  AuditService,
  RecordAuditEventInput,
} from '../audit/audit.service'
import type {
  EffectiveCurrency,
} from '../currencies/currency-lookup.service'
import type {
  DictionaryLookupService,
  EffectiveDictionaryValue,
  StoredDictionaryValueResolution,
} from '../dictionaries/dictionary-lookup.service'
import type { ProductQueryRow } from './product-query.mapper'
import type { ProductUpdateLockRecord } from './product-update.persistence'
import { ProductUpdateService } from './product-update.service'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'

function createLock(
  overrides: Partial<ProductUpdateLockRecord> = {},
): ProductUpdateLockRecord {
  return {
    id: PRODUCT_ID,
    name: '原产品',
    categoryId: 'category-1',
    categoryName: '原分类',
    productHeadId: 'head-1',
    productHeadName: '原产品头',
    productNo: 'P202608130001',
    status: ProductStatus.INACTIVE,
    supplierValue: 'HISTORICAL',
    sortOrder: 10,
    twdSalePriceAmount: '10',
    twdSalePriceCurrency: 'TWD',
    myrSalePriceAmount: null,
    myrSalePriceCurrency: 'MYR',
    purchaseCostAmount: '5.5',
    purchaseCostCurrency: 'CNY',
    attributes: [{ title: '颜色', value: '红色' }],
    remark: null,
    version: 1,
    ...overrides,
  }
}

function createResponse(
  overrides: Partial<ProductQueryRow> = {},
): ProductQueryRow {
  return {
    id: PRODUCT_ID,
    name: '新产品',
    category: { id: 'category-1', name: '原分类' },
    productHead: { id: 'head-1', name: '原产品头' },
    productNo: 'P202608130001',
    status: ProductStatus.ACTIVE,
    supplierValue: 'SUPPLIER_A',
    sortOrder: 10,
    twdSalePriceAmount: { toString: () => '10.00' },
    twdSalePriceCurrency: 'TWD',
    myrSalePriceAmount: null,
    myrSalePriceCurrency: 'MYR',
    purchaseCostAmount: { toString: () => '5.50' },
    purchaseCostCurrency: 'CNY',
    attributes: [{ title: '颜色', value: '红色' }],
    remark: null,
    createdBy: { id: ACTOR_ID, displayName: '管理员' },
    updatedBy: { id: ACTOR_ID, displayName: '管理员' },
    version: 2,
    createdAt: new Date('2026-08-13T01:00:00.000Z'),
    updatedAt: new Date('2026-08-13T02:00:00.000Z'),
    ...overrides,
  }
}

interface Fixture {
  readonly service: ProductUpdateService
  readonly events: string[]
  readonly productUpdate: jest.Mock<Promise<{ id: string }>, [unknown]>
  readonly productFindUnique: jest.Mock<Promise<ProductQueryRow | null>, [unknown]>
  readonly requireEffectiveValue: jest.Mock<
    Promise<EffectiveDictionaryValue>,
    [Prisma.TransactionClient, { dictionaryCode: string; value: string }]
  >
  readonly requireEnabledCodes: jest.Mock<
    Promise<readonly EffectiveCurrency[]>,
    [Prisma.TransactionClient, readonly string[]]
  >
  readonly resolveStoredValueInTransaction: jest.Mock<
    Promise<StoredDictionaryValueResolution>,
    [Prisma.TransactionClient, { dictionaryCode: string; value: string }]
  >
  readonly auditRecord: jest.Mock<
    Promise<Record<string, never>>,
    [Prisma.TransactionClient, RecordAuditEventInput]
  >
  readonly resolveOrCreateInTransaction: jest.Mock<
    Promise<{ readonly categoryId: string, readonly productHeadId: string }>,
    [Prisma.TransactionClient, { readonly actorUserId: string, readonly requestId: string }, unknown]
  >
}

function createFixture(options: {
  readonly lock?: ProductUpdateLockRecord | null
  readonly response?: ProductQueryRow | null
} = {}): Fixture {
  const events: string[] = []
  let rawCall = 0
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>(() => {
    rawCall += 1
    if (rawCall === 1) {
      events.push('timeout')
      return Promise.resolve([])
    }
    events.push('product.lock')
    return Promise.resolve(options.lock === null
      ? []
      : [options.lock ?? createLock()])
  })
  const productUpdate = jest.fn<Promise<{ id: string }>, [unknown]>(() => {
    events.push('product.update')
    return Promise.resolve({ id: PRODUCT_ID })
  })
  const productFindUnique = jest.fn<
    Promise<ProductQueryRow | null>,
    [unknown]
  >(() => {
    events.push('product.response')
    return Promise.resolve(options.response === null
      ? null
      : options.response ?? createResponse())
  })
  const productMediaFindMany = jest.fn<Promise<unknown[]>, [unknown]>(() => {
    events.push('product.media')
    return Promise.resolve([])
  })
  const transactionClient = {
    $queryRaw: queryRaw,
    product: {
      aggregate: jest.fn(() => Promise.resolve({ _max: { sortOrder: 0 } })),
      update: productUpdate,
      findUnique: productFindUnique,
    },
    productMedia: { findMany: productMediaFindMany },
  } as unknown as Prisma.TransactionClient
  const transaction = jest.fn<
    Promise<unknown>,
    [operation: (client: Prisma.TransactionClient) => Promise<unknown>]
  >((operation) => {
    events.push('transaction')
    return operation(transactionClient)
  })
  const requireEffectiveValue = jest.fn<
    Promise<EffectiveDictionaryValue>,
    [Prisma.TransactionClient, { dictionaryCode: string; value: string }]
  >(() => {
    events.push('supplier')
    return Promise.resolve({
      dictionaryCode: 'service_provider.supplier',
      value: 'SUPPLIER_A',
      label: '供应商 A',
      tone: DictionaryTone.SUCCESS,
    })
  })
  const requireEnabledCodes = jest.fn<
    Promise<readonly EffectiveCurrency[]>,
    [Prisma.TransactionClient, readonly string[]]
  >((_transaction, codes) => {
    events.push('currency')
    return Promise.resolve([...new Set(codes)].sort().map(code => ({
      code,
      minorUnit: 2 as const,
    })))
  })
  const resolveStoredValueInTransaction = jest.fn<
    Promise<StoredDictionaryValueResolution>,
    [Prisma.TransactionClient, { dictionaryCode: string; value: string }]
  >((_transaction, input) => {
    events.push('supplier.resolve')
    return Promise.resolve({
      known: true as const,
      dictionaryCode: input.dictionaryCode,
      value: input.value,
      label: input.value === 'SUPPLIER_A' ? '供应商 A' : '历史供应商',
      tone: DictionaryTone.DEFAULT,
      typeEnabled: true,
      itemEnabled: true,
      effectiveEnabled: true,
    })
  })
  const auditRecord = jest.fn<
    Promise<Record<string, never>>,
    [Prisma.TransactionClient, RecordAuditEventInput]
  >(() => {
    events.push('audit')
    return Promise.resolve({})
  })
  const resolveOrCreateInTransaction = jest.fn<
    Promise<{ readonly categoryId: string, readonly productHeadId: string }>,
    [Prisma.TransactionClient, { readonly actorUserId: string, readonly requestId: string }, unknown]
  >(() => {
    events.push('taxonomy')
    return Promise.resolve({
      categoryId: 'category-2',
      productHeadId: 'head-2',
    })
  })

  return {
    service: new ProductUpdateService(
      { $transaction: transaction } as unknown as PrismaService,
      {
        requireEffectiveValue,
        resolveStoredValueInTransaction,
      } as unknown as DictionaryLookupService,
      { requireEnabledCodes },
      { record: auditRecord } as unknown as AuditService,
      { resolveOrCreateInTransaction } as unknown as import('./product-taxonomy.service').ProductTaxonomyService,
    ),
    events,
    productUpdate,
    productFindUnique,
    requireEffectiveValue,
    requireEnabledCodes,
    resolveStoredValueInTransaction,
    auditRecord,
    resolveOrCreateInTransaction,
  }
}

function updateProduct(fixture: Fixture, input: unknown) {
  return fixture.service.update({
    actorUserId: ACTOR_ID,
    requestId: 'request-1',
  }, PRODUCT_ID, input)
}

describe('ProductUpdateService', () => {
  it('locks, validates an Active target, writes, audits and returns one snapshot', async () => {
    const fixture = createFixture()

    await expect(updateProduct(fixture, {
      name: ' 新产品 ',
      status: ProductStatus.ACTIVE,
      supplierValue: 'SUPPLIER_A',
      expectedVersion: 1,
    })).resolves.toMatchObject({
      name: '新产品',
      status: ProductStatus.ACTIVE,
      supplier: { value: 'SUPPLIER_A' },
      version: 2,
    })

    expect(fixture.events).toEqual([
      'transaction',
      'timeout',
      'product.lock',
      'supplier',
      'currency',
      'taxonomy',
      'product.update',
      'audit',
      'product.response',
      'supplier.resolve',
      'product.media',
    ])
    expect(fixture.requireEnabledCodes).toHaveBeenCalledWith(
      expect.anything(),
      ['TWD', 'MYR', 'CNY'],
    )
    const updateCalls = fixture.productUpdate.mock.calls as unknown as Array<
      readonly [Record<string, unknown>]
    >
    expect(updateCalls[0]?.[0]).toMatchObject({
      data: {
        name: '新产品',
        categoryId: 'category-2',
        productHeadId: 'head-2',
        status: ProductStatus.ACTIVE,
        supplierValue: 'SUPPLIER_A',
        updatedByUserId: ACTOR_ID,
        version: { increment: 1 },
      },
    })

    const auditInput = fixture.auditRecord.mock.calls[0]?.[1]
    expect(auditInput).toEqual({
      eventType: AuditEventType.PRODUCT_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'PRODUCT',
      targetId: PRODUCT_ID,
      requestId: 'request-1',
      metadata: {
        productNo: 'P202608130001',
        changedFields: 'name,status,supplierValue',
        previousVersion: 1,
        version: 2,
        previousStatus: ProductStatus.INACTIVE,
        status: ProductStatus.ACTIVE,
      },
    })
    expect(JSON.stringify(auditInput)).not.toContain('SUPPLIER_A')
    expect(JSON.stringify(auditInput)).not.toContain('新产品')
  })

  it('rejects stale expectedVersion before no-op comparison and dependencies', async () => {
    const fixture = createFixture({
      lock: createLock({ version: 2 }),
    })

    await expect(updateProduct(fixture, {
      name: '原产品',
      expectedVersion: 1,
    })).rejects.toMatchObject({
      status: 409,
      code: 'PRODUCT_STATE_CHANGED',
    })
    expect(fixture.events).toEqual(['transaction', 'timeout', 'product.lock'])
  })

  it('returns a same-version no-op without dependency checks, write or audit', async () => {
    const fixture = createFixture({
      response: createResponse({
        name: '原产品',
        status: ProductStatus.INACTIVE,
        supplierValue: 'HISTORICAL',
        version: 1,
      }),
    })

    await expect(updateProduct(fixture, {
      name: ' 原产品 ',
      expectedVersion: 1,
    })).resolves.toMatchObject({ version: 1 })
    expect(fixture.events).toEqual([
      'transaction',
      'timeout',
      'product.lock',
      'product.response',
      'supplier.resolve',
      'product.media',
    ])
  })

  it('allows Active to Inactive without revalidating unchanged historical dependencies', async () => {
    const fixture = createFixture({
      lock: createLock({
        status: ProductStatus.ACTIVE,
        supplierValue: 'MISSING',
      }),
      response: createResponse({
        status: ProductStatus.INACTIVE,
        supplierValue: 'MISSING',
      }),
    })

    await expect(updateProduct(fixture, {
      status: ProductStatus.INACTIVE,
      expectedVersion: 1,
    })).resolves.toMatchObject({ status: ProductStatus.INACTIVE })
    expect(fixture.requireEffectiveValue).not.toHaveBeenCalled()
    expect(fixture.requireEnabledCodes).not.toHaveBeenCalled()
  })

  it('validates only actively changed dependencies on a non-Active target', async () => {
    const fixture = createFixture({
      response: createResponse({ status: ProductStatus.INACTIVE }),
    })

    await updateProduct(fixture, {
      supplierValue: 'SUPPLIER_A',
      purchaseCost: { amount: '7.20', currency: 'CNY' },
      expectedVersion: 1,
    })

    expect(fixture.requireEffectiveValue).toHaveBeenCalledTimes(1)
    expect(fixture.requireEnabledCodes).toHaveBeenCalledWith(
      expect.anything(),
      ['CNY'],
    )
  })

  it('returns PRODUCT_NOT_FOUND when the locked row does not exist', async () => {
    const fixture = createFixture({ lock: null })

    await expect(updateProduct(fixture, {
      name: '新产品',
      expectedVersion: 1,
    })).rejects.toMatchObject({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    })
    expect(fixture.productUpdate).not.toHaveBeenCalled()
  })
})
