import { Prisma } from '../../generated/prisma/client'
import type {
  ProductStatus as ProductStatusValue,
} from '../../generated/prisma/enums'
import {
  PRODUCT_RESPONSE_SELECT,
  type ProductQueryRow,
} from './product-query.mapper'

export interface ProductUpdateLockRecord {
  readonly id: string
  readonly name: string
  readonly categoryId: string | null
  readonly categoryName: string | null
  readonly productHeadId: string | null
  readonly productHeadName: string | null
  readonly productNo: string
  readonly status: ProductStatusValue
  readonly supplierValue: string
  readonly sortOrder: number
  readonly twdSalePriceAmount: string | null
  readonly twdSalePriceCurrency: string
  readonly myrSalePriceAmount: string | null
  readonly myrSalePriceCurrency: string
  readonly purchaseCostAmount: string | null
  readonly purchaseCostCurrency: string
  readonly attributes: unknown
  readonly remark: string | null
  readonly version: number
}

export interface ProductUpdateRecordData {
  readonly name?: string
  readonly categoryId?: string | null
  readonly productHeadId?: string | null
  readonly status?: ProductStatusValue
  readonly supplierValue?: string
  readonly sortOrder?: number
  readonly twdSalePriceAmount?: string | null
  readonly twdSalePriceCurrency?: string
  readonly myrSalePriceAmount?: string | null
  readonly myrSalePriceCurrency?: string
  readonly purchaseCostAmount?: string | null
  readonly purchaseCostCurrency?: string
  readonly attributes?: readonly Readonly<{ title: string; value: string }>[]
  readonly remark?: string | null
}

/**
 * 乐观锁比较前先锁定 Product。`trim_scale` 只移除数据库 DECIMAL(30,4) 的无意义
 * 尾零，使后续 minorUnit 校验看到金额的真实有效小数位，而不是存储列固定 scale。
 */
export async function readProductForUpdate(
  transaction: Prisma.TransactionClient,
  productId: string,
): Promise<ProductUpdateLockRecord | null> {
  const rows = await transaction.$queryRaw<ProductUpdateLockRecord[]>(Prisma.sql`
    SELECT
      product."id",
      product."name",
      product."category_id" AS "categoryId",
      category."name" AS "categoryName",
      product."product_head_id" AS "productHeadId",
      head."name" AS "productHeadName",
      product."product_no" AS "productNo",
      product."status",
      product."supplier_value" AS "supplierValue",
      product."sort_order" AS "sortOrder",
      CASE WHEN product."twd_sale_price_amount" IS NULL THEN NULL
        ELSE trim_scale(product."twd_sale_price_amount")::text END AS "twdSalePriceAmount",
      product."twd_sale_price_currency" AS "twdSalePriceCurrency",
      CASE WHEN product."myr_sale_price_amount" IS NULL THEN NULL
        ELSE trim_scale(product."myr_sale_price_amount")::text END AS "myrSalePriceAmount",
      product."myr_sale_price_currency" AS "myrSalePriceCurrency",
      CASE WHEN product."purchase_cost_amount" IS NULL THEN NULL
        ELSE trim_scale(product."purchase_cost_amount")::text END AS "purchaseCostAmount",
      product."purchase_cost_currency" AS "purchaseCostCurrency",
      product."attributes",
      product."remark",
      product."version"
    FROM "products" AS product
    LEFT JOIN "product_categories" AS category
      ON category."id" = product."category_id"
    LEFT JOIN "product_heads" AS head
      ON head."id" = product."product_head_id"
    WHERE product."id" = CAST(${productId} AS uuid)
    FOR UPDATE OF product
  `)
  return rows[0] ?? null
}

/** 只写调用方显式选出的差异字段；审计操作者和 version 始终由服务端维护。 */
export async function updateProductRecord(
  transaction: Prisma.TransactionClient,
  input: {
    readonly productId: string
    readonly actorUserId: string
    readonly data: ProductUpdateRecordData
  },
): Promise<void> {
  const data: Prisma.ProductUncheckedUpdateInput = {
    ...input.data,
    attributes: input.data.attributes?.map(attribute => ({
      title: attribute.title,
      value: attribute.value,
    })),
    updatedByUserId: input.actorUserId,
    version: { increment: 1 },
  }

  await transaction.product.update({
    where: { id: input.productId },
    data,
    select: { id: true },
  })
}

export async function readProductUpdateResponse(
  transaction: Prisma.TransactionClient,
  productId: string,
): Promise<ProductQueryRow | null> {
  return transaction.product.findUnique({
    where: { id: productId },
    select: PRODUCT_RESPONSE_SELECT,
  })
}
