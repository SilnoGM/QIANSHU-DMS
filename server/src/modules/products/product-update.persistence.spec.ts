import { Prisma } from '../../generated/prisma/client'
import {
  readProductForUpdate,
  updateProductRecord,
} from './product-update.persistence'

describe('product update persistence', () => {
  it('locks the Product row with a parameterized FOR UPDATE query', async () => {
    const queryRaw = jest.fn().mockResolvedValue([])
    const transaction = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient

    await readProductForUpdate(transaction, '11111111-1111-4111-8111-111111111111')

    const calls = queryRaw.mock.calls as unknown as Array<readonly [unknown]>
    const sql = calls[0]?.[0] as { strings: readonly string[] }
    expect(sql.strings.join('?')).toContain('FOR UPDATE')
    expect(sql.strings.join('?')).toContain('CAST(? AS uuid)')
  })

  it('updates only supplied business fields plus actor and version', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'product-id' })
    const transaction = { product: { update } } as unknown as Prisma.TransactionClient

    await updateProductRecord(transaction, {
      productId: '11111111-1111-4111-8111-111111111111',
      actorUserId: '22222222-2222-4222-8222-222222222222',
      data: { name: '新名称', attributes: [{ title: '颜色', value: '黑色' }] },
    })

    expect(update).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111' },
      data: {
        name: '新名称',
        attributes: [{ title: '颜色', value: '黑色' }],
        updatedByUserId: '22222222-2222-4222-8222-222222222222',
        version: { increment: 1 },
      },
      select: { id: true },
    })
  })
})
