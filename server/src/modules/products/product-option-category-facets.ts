import type { Prisma } from '../../generated/prisma/client'
import type { PrismaService } from '../../infrastructure/database/prisma.service'

export interface ProductOptionCategoryHeadFacet {
  readonly name: string
  readonly count: number
}

export interface ProductOptionCategoryFacet {
  readonly name: string
  readonly count: number
  readonly productHeads: readonly ProductOptionCategoryHeadFacet[]
}

export interface ProductOptionCategoryFacets {
  readonly categories: readonly ProductOptionCategoryFacet[]
  readonly unclassifiedCount: number
}

/**
 * 选品左栏的分类/产品头 facet。分类与产品头是自由文本，没有字典表；
 * 这里按 (category, head) 分组一次取出两级计数，忽略关键词与已选分类，
 * 但仍受调用方传入的 status/供应商/采购成本等基础条件约束。
 */
export async function readProductOptionCategoryFacets(
  prisma: PrismaService,
  where: Prisma.ProductWhereInput,
): Promise<ProductOptionCategoryFacets> {
  const rows = await prisma.product.groupBy({
    by: ['categoryName', 'productHeadName'],
    where,
    orderBy: [
      { categoryName: 'asc' },
      { productHeadName: 'asc' },
    ],
    _count: { _all: true },
  })
  const categories = new Map<string, {
    count: number
    productHeads: ProductOptionCategoryHeadFacet[]
  }>()
  let unclassifiedCount = 0
  for (const row of rows) {
    if (row.categoryName === null) {
      unclassifiedCount += row._count._all
      continue
    }
    const category = categories.get(row.categoryName) ?? {
      count: 0,
      productHeads: [],
    }
    category.count += row._count._all
    if (row.productHeadName !== null) {
      category.productHeads.push({
        name: row.productHeadName,
        count: row._count._all,
      })
    }
    categories.set(row.categoryName, category)
  }
  return {
    categories: [...categories.entries()].map(([name, category]) => ({
      name,
      count: category.count,
      productHeads: category.productHeads,
    })),
    unclassifiedCount,
  }
}
