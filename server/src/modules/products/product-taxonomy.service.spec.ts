import type { Prisma } from '../../generated/prisma/client'
import { AuditEventType } from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AuditService, RecordAuditEventInput } from '../audit/audit.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import { ProductTaxonomyService } from './product-taxonomy.service'

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const CONTEXT = {
  actorUserId: ACTOR_ID,
  requestId: 'request-taxonomy-1',
}

function createFixture() {
  const productCategory = {
    aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
    create: jest.fn().mockResolvedValue({
      id: 'category-id',
      name: '分类',
      supplierValue: 'SUPPLIER_A',
    }),
    findUnique: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({ id: 'category-id' }),
    delete: jest.fn().mockResolvedValue({ id: 'category-id' }),
  }
  const productHead = {
    aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
    create: jest.fn().mockResolvedValue({
      id: 'head-id',
      name: '产品头',
      categoryId: 'category-id',
    }),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({ id: 'head-id' }),
    delete: jest.fn().mockResolvedValue({ id: 'head-id' }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  }
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    productCategory,
    productHead,
  } as unknown as Prisma.TransactionClient
  const prisma = {
    $transaction: jest.fn(async (operation: (client: Prisma.TransactionClient) => Promise<unknown>) =>
      operation(transaction)),
  } as unknown as PrismaService
  const auditRecord = jest.fn<
    Promise<Record<string, never>>,
    [Prisma.TransactionClient, RecordAuditEventInput]
  >().mockResolvedValue({})
  const dictionaryLookup = {
    requireEffectiveValue: jest.fn().mockResolvedValue({
      dictionaryCode: 'service_provider.supplier',
      value: 'SUPPLIER_A',
      label: '供应商 A',
      tone: 'SUCCESS',
    }),
  } as unknown as DictionaryLookupService

  return {
    auditRecord,
    mocks: { productCategory, productHead },
    service: new ProductTaxonomyService(
      prisma,
      dictionaryLookup,
      { record: auditRecord } as unknown as AuditService,
    ),
    transaction,
  }
}

describe('ProductTaxonomyService', () => {
  it('resolves or creates category and head inside the caller transaction with audit', async () => {
    const fixture = createFixture()

    await expect(fixture.service.resolveOrCreateInTransaction(
      fixture.transaction,
      CONTEXT,
      {
        categoryName: '分类',
        productHeadName: '产品头',
        supplierValue: 'SUPPLIER_A',
      },
    )).resolves.toEqual({
      categoryId: 'category-id',
      productHeadId: 'head-id',
    })

    expect(fixture.auditRecord).toHaveBeenCalledTimes(2)
    expect(fixture.auditRecord.mock.calls.map(call => call[1].eventType)).toEqual([
      AuditEventType.PRODUCT_CATEGORY_CREATED,
      AuditEventType.PRODUCT_HEAD_CREATED,
    ])
    expect(fixture.mocks.productCategory.create).toHaveBeenCalledWith({
      data: { name: '分类', supplierValue: 'SUPPLIER_A', sortOrder: 10 },
      select: { id: true, name: true, supplierValue: true },
    })
    expect(fixture.mocks.productHead.create).toHaveBeenCalledWith({
      data: { categoryId: 'category-id', name: '产品头', sortOrder: 10 },
      select: { id: true, name: true, categoryId: true },
    })
  })

  it('does not audit or recreate when both taxonomy rows already exist', async () => {
    const fixture = createFixture()
    fixture.mocks.productCategory.findUnique.mockResolvedValue({
      id: 'existing-category',
      name: '分类',
      supplierValue: 'SUPPLIER_A',
    })
    fixture.mocks.productHead.findUnique.mockResolvedValue({
      id: 'existing-head',
      name: '产品头',
      categoryId: 'existing-category',
    })

    await expect(fixture.service.resolveOrCreateInTransaction(
      fixture.transaction,
      CONTEXT,
      {
        categoryName: '分类',
        productHeadName: '产品头',
        supplierValue: 'SUPPLIER_A',
      },
    )).resolves.toEqual({
      categoryId: 'existing-category',
      productHeadId: 'existing-head',
    })

    expect(fixture.auditRecord).not.toHaveBeenCalled()
    expect(fixture.mocks.productCategory.create).not.toHaveBeenCalled()
    expect(fixture.mocks.productHead.create).not.toHaveBeenCalled()
  })

  it('deletes an empty category and its empty heads but blocks referenced categories', async () => {
    const blocked = createFixture()
    blocked.mocks.productCategory.findUnique.mockResolvedValue({
      id: 'category-id',
      name: '分类',
      supplierValue: 'SUPPLIER_A',
      _count: { products: 2, productHeads: 1 },
    })

    await expect(blocked.service.deleteCategory(CONTEXT, 'category-id'))
      .rejects.toMatchObject({
        code: 'PRODUCT_CATEGORY_IN_USE',
        status: 409,
      })
    expect(blocked.mocks.productHead.deleteMany).not.toHaveBeenCalled()

    const empty = createFixture()
    empty.mocks.productCategory.findUnique.mockResolvedValue({
      id: 'category-id',
      name: '分类',
      supplierValue: 'SUPPLIER_A',
      _count: { products: 0, productHeads: 1 },
    })
    empty.mocks.productHead.findMany.mockResolvedValue([{ id: 'head-id' }])

    await expect(empty.service.deleteCategory(CONTEXT, 'category-id'))
      .resolves.toBeUndefined()
    expect(empty.mocks.productHead.deleteMany).toHaveBeenCalledWith({
      where: { categoryId: 'category-id' },
    })
    expect(empty.mocks.productCategory.delete).toHaveBeenCalledWith({
      where: { id: 'category-id' },
    })
    expect(empty.auditRecord.mock.calls[0]?.[1]).toMatchObject({
      eventType: AuditEventType.PRODUCT_CATEGORY_DELETED,
      metadata: { deletedHeadCount: 1 },
    })
  })

  it('maps scoped name conflicts to a stable 409 without leaking database text', async () => {
    const fixture = createFixture()
    fixture.mocks.productCategory.update.mockRejectedValue({
      code: '23505',
      constraint: 'product_categories_supplier_value_name_key',
    })
    fixture.mocks.productCategory.findUnique.mockResolvedValue({
      id: 'category-id',
      name: '旧分类',
      supplierValue: 'SUPPLIER_A',
    })

    await expect(fixture.service.renameCategory(CONTEXT, 'category-id', {
      name: '新分类',
    })).rejects.toMatchObject({
      code: 'PRODUCT_CATEGORY_NAME_CONFLICT',
      status: 409,
      publicMessage: '当前供应商下已存在同名分类',
    })
  })
})
