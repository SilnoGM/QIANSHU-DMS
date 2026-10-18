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

export interface ProductOptionCategoryFacetInput {
  readonly supplierValue: string
  /**
   * 不含关键词、分类、产品头与未分类条件的基础产品条件；facet 只统计该范围，
   * 这样切换左侧分类时各分类计数保持稳定。
   */
  readonly productWhere: Prisma.ProductWhereInput
}

/**
 * 选品左栏 facet 从分类目录读取，包含 0 项分类/产品头；产品计数仍按
 * ACTIVE + 供应商（以及采购侧成本条件）等基础条件实时聚合。
 */
export async function readProductOptionCategoryFacets(
  prisma: PrismaService,
  input: ProductOptionCategoryFacetInput,
): Promise<ProductOptionCategoryFacets> {
  const productWhere: Prisma.ProductWhereInput = {
    ...input.productWhere,
    supplierValue: input.supplierValue,
  }
  const [categories, unclassifiedCount] = await Promise.all([
    prisma.productCategory.findMany({
      where: { supplierValue: input.supplierValue },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        name: true,
        _count: {
          select: { products: { where: productWhere } },
        },
        productHeads: {
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: {
            name: true,
            _count: {
              select: { products: { where: productWhere } },
            },
          },
        },
      },
    }),
    prisma.product.count({
      where: { ...productWhere, categoryId: null },
    }),
  ])

  return {
    categories: categories.map(category => ({
      name: category.name,
      count: category._count.products,
      productHeads: category.productHeads.map(head => ({
        name: head.name,
        count: head._count.products,
      })),
    })),
    unclassifiedCount,
  }
}
