import type { Prisma } from '../../generated/prisma/client'
import { ProductStatus } from '../../generated/prisma/enums'
import {
  createProductRecord,
  isProductNumberUniqueViolation,
  readProductByNumber,
} from './product-command.persistence'
import type { NormalizedProductCreateCommand } from './product-command.normalizer'

function normalizedCommand(): NormalizedProductCreateCommand {
  return {
    name: '山茶精华',
    status: ProductStatus.DRAFT,
    supplierValue: 'SUPPLIER_A',
    twdSalePrice: {
      amount: '1280.5000',
      currency: 'TWD',
      inputFractionDigits: 1,
    },
    myrSalePrice: {
      amount: null,
      currency: 'MYR',
      inputFractionDigits: 0,
    },
    purchaseCost: {
      amount: '88.1250',
      currency: 'CNY',
      inputFractionDigits: 3,
    },
    attributes: [
      { title: '容量', value: '30ml' },
      { title: '产地', value: '中国台湾' },
    ],
  }
}

describe('product command persistence', () => {
  it('creates the exact Product shape with audit fields and no legacy media writes', async () => {
    const created = { id: 'product-id' }
    const create = jest.fn<Promise<typeof created>, [unknown]>()
      .mockResolvedValue(created)
    const transaction = {
      product: { create },
    } as unknown as Prisma.TransactionClient
    const command = normalizedCommand()

    await expect(createProductRecord(transaction, {
      productNo: 'P202608120001',
      actorUserId: '11111111-1111-4111-8111-111111111111',
      command,
    })).resolves.toBe(created)

    const createInput = create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
      select: Record<string, unknown>
    }
    expect(createInput.data).toEqual({
      name: '山茶精华',
      productNo: 'P202608120001',
      status: ProductStatus.DRAFT,
      supplierValue: 'SUPPLIER_A',
      twdSalePriceAmount: '1280.5000',
      twdSalePriceCurrency: 'TWD',
      myrSalePriceAmount: null,
      myrSalePriceCurrency: 'MYR',
      purchaseCostAmount: '88.1250',
      purchaseCostCurrency: 'CNY',
      attributes: [
        { title: '容量', value: '30ml' },
        { title: '产地', value: '中国台湾' },
      ],
      createdByUserId: '11111111-1111-4111-8111-111111111111',
      updatedByUserId: '11111111-1111-4111-8111-111111111111',
      version: 1,
    })
    expect(createInput.select).toMatchObject({
      id: true,
      productNo: true,
      createdBy: { select: { id: true, displayName: true } },
      updatedBy: { select: { id: true, displayName: true } },
    })

    ;(command.attributes[0] as { title: string }).title = 'changed'
    expect((createInput.data.attributes as Array<{ title: string }>)[0]?.title)
      .toBe('容量')
  })

  it('reads by the issued product number with the shared response select', async () => {
    const row = { id: 'product-id' }
    const findUnique = jest.fn<Promise<typeof row>, [unknown]>()
      .mockResolvedValue(row)
    const transaction = {
      product: { findUnique },
    } as unknown as Prisma.TransactionClient

    await expect(readProductByNumber(transaction, 'P202608120001'))
      .resolves.toBe(row)
    const findUniqueInput = findUnique.mock.calls[0]?.[0] as {
      where: unknown
      select: Record<string, unknown>
    }
    expect(findUniqueInput.where).toEqual({ productNo: 'P202608120001' })
    expect(findUniqueInput.select).toMatchObject({
      id: true,
      productNo: true,
      attributes: true,
    })
  })

  it.each([
    [{ code: 'P2002', meta: { constraint: 'products_product_no_key' } }, true],
    [{ code: '23505', constraint: 'products_product_no_key' }, true],
    [{ code: 'P2002', meta: { target: ['productNo'] } }, true],
    [{ code: 'P2002', meta: { constraint: 'other_key' } }, false],
    [{ message: 'duplicate products_product_no_key secret-value' }, false],
  ])('recognizes only trusted product number uniqueness facts', (error, expected) => {
    expect(isProductNumberUniqueViolation(error)).toBe(expected)
  })
})
