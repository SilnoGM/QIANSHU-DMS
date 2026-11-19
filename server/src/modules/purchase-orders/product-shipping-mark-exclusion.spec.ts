import type { Prisma } from '../../generated/prisma/client'
import { resolveExcludedProductIds } from './product-shipping-mark-exclusion'

type ReadClient = Pick<Prisma.TransactionClient, 'product'>

function clientReturning(rows: readonly { id: string }[]) {
  const findMany = jest.fn(async () => rows)
  return {
    client: { product: { findMany } } as unknown as ReadClient,
    findMany,
  }
}

describe('resolveExcludedProductIds', () => {
  it('returns an empty set without querying when no product ids are given', async () => {
    const { client, findMany } = clientReturning([])

    await expect(resolveExcludedProductIds(client, [])).resolves.toEqual(new Set())
    expect(findMany).not.toHaveBeenCalled()
  })

  it('queries unique ids once and returns only the excluded products', async () => {
    const { client, findMany } = clientReturning([{ id: 'b' }])

    const result = await resolveExcludedProductIds(client, ['a', 'b', 'b'])

    expect(result).toEqual(new Set(['b']))
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, excludeFromShippingMark: true },
      select: { id: true },
    })
  })

  it('returns an empty set when no product carries the flag', async () => {
    const { client } = clientReturning([])

    await expect(resolveExcludedProductIds(client, ['a', 'c'])).resolves.toEqual(new Set())
  })
})
