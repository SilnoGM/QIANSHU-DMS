import type { Prisma } from '../../generated/prisma/client'

/**
 * 只读批量解析：返回被排除在货件唛头后缀之外的产品 ID。
 * 产品级标记只影响唛头展示；不改变金额、数量、货件构成或产品清单。
 */
export async function resolveExcludedProductIds(
  client: Pick<Prisma.TransactionClient, 'product'>,
  productIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const uniqueProductIds = [...new Set(productIds)]
  if (uniqueProductIds.length === 0) {
    return new Set()
  }
  const rows = await client.product.findMany({
    where: { id: { in: uniqueProductIds }, excludeFromShippingMark: true },
    select: { id: true },
  })
  return new Set(rows.map(row => row.id))
}
