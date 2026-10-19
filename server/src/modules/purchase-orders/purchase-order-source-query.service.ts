import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  DictionaryLookupService,
} from '../dictionaries/dictionary-lookup.service'
import { normalizeDictionaryItemValue } from '../dictionaries/dictionary.normalizer'
import { readProductOptionCategoryFacets } from '../products/product-option-category-facets'
import { formatPurchaseOrderAmountUnits, normalizePurchaseOrderReferenceAmount, parsePurchaseOrderAmountUnits } from './domain/purchase-order-decimal'
import {
  PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS,
  type PurchaseOrderSourceSalesOrderView,
} from './domain/purchase-order-source-sales-order-view'
import type {
  PurchaseOrderSourceProductMode,
} from './dto/purchase-order-query.dto'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'

export interface PurchaseOrderProductOptionsInput {
  readonly supplierValue: string
  readonly keyword?: string
  readonly categoryName?: string
  readonly productHeadName?: string
  readonly unclassified?: boolean
  readonly page?: number
  readonly pageSize?: number
}

export interface PurchaseOrderSourceSalesOrdersInput {
  readonly view: PurchaseOrderSourceSalesOrderView
  readonly productMode: PurchaseOrderSourceProductMode
  readonly supplierValue?: string
  readonly salesOrderId?: string
  readonly keyword?: string
  readonly page?: number
  readonly pageSize?: number
}

export interface PurchaseOrderSourceSalesOrderLinesInput {
  readonly productMode: PurchaseOrderSourceProductMode
  readonly supplierValue?: string
}

interface NormalizedSourceProductFilter {
  readonly productMode: PurchaseOrderSourceProductMode
  readonly supplierValue: string | null
}

function fixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
}

function attributes(value: unknown): readonly Record<string, unknown>[] {
  if (
    !Array.isArray(value)
    || value.some(item => (
      typeof item !== 'object' || item === null || Array.isArray(item)
    ))
  ) {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'PURCHASE_ORDER_STATE_CHANGED',
      '产品属性状态已变化，请重试',
    )
  }
  return value as readonly Record<string, unknown>[]
}

function unavailableSupplier(): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PURCHASE_ORDER_SUPPLIER_UNAVAILABLE',
    '供应商当前不可用',
  )
}

interface SourceSalesOrderCountRow {
  readonly view: PurchaseOrderSourceSalesOrderView
  readonly count: bigint | number
}

interface SourceSalesOrderPageRow {
  readonly id: string
  readonly lineIds: readonly string[]
  readonly remainingQuantity: bigint | number
}

function safeCount(value: bigint | number): number {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'PURCHASE_ORDER_STATE_CHANGED',
      '销售订单采购事实已变化，请重试',
    )
  }
  return count
}

function invalidSourceProductMode(): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PURCHASE_ORDER_PRODUCT_MODE_INVALID',
    '采购产品类型无效',
  )
}

function invalidSourceSupplier(): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID',
    '供应商来源与采购产品类型不匹配',
  )
}

function sourceSalesOrderFactsSql(input: {
  readonly keyword: string | undefined
  readonly productMode: PurchaseOrderSourceProductMode
  readonly salesOrderId: string | undefined
  readonly supplierValue: string | null
}): Prisma.Sql {
  const keyword = input.keyword
  const keywordFilter = keyword === undefined || keyword.length === 0
    ? Prisma.empty
    : Prisma.sql`
        AND (
          strpos(lower(source_order."order_no"), lower(${keyword})) > 0
          OR strpos(lower(source_order."customer_name"), lower(${keyword})) > 0
        )
      `
  const salesOrderFilter = input.salesOrderId === undefined
    ? Prisma.empty
    : Prisma.sql`AND source_order."id" = CAST(${input.salesOrderId} AS uuid)`
  const targetProductFilter = input.productMode === 'CATALOG'
    ? Prisma.sql`
        source_line."line_type" = CAST(${input.productMode} AS sales_order_line_type)
        AND source_product."supplier_value" = ${input.supplierValue}
      `
    : Prisma.sql`
        source_line."line_type" = CAST(${input.productMode} AS sales_order_line_type)
      `

  /*
   * 同一个目录产品允许在销售订单中出现多行，因此必须先按
   * source_sales_order_line_id 聚合，再逐销售明细计算剩余数量；禁止按 product_id 合并。
   */
  return Prisma.sql`
    WITH source_sales_order_lines AS (
      SELECT
        source_line."id",
        source_line."sales_order_id",
        source_line."line_type",
        source_line."product_id",
        source_line."quantity"
      FROM "sales_order_lines" AS source_line
      WHERE source_line."removed_at" IS NULL
    ),
    purchased_by_line AS (
      SELECT
        purchase_line."source_sales_order_line_id",
        COALESCE(SUM(purchase_line."quantity"), 0)::bigint AS "purchased_quantity"
      FROM "purchase_order_lines" AS purchase_line
      INNER JOIN "purchase_orders" AS purchase_order
        ON purchase_order."id" = purchase_line."purchase_order_id"
      WHERE purchase_line."source_sales_order_line_id" IS NOT NULL
        AND purchase_order."purchase_type" = 'SALES_LINKED'::purchase_order_type
        AND purchase_order."order_status" <> 'CANCELLED'::purchase_order_status
      GROUP BY purchase_line."source_sales_order_line_id"
    ),
    target_source_sales_order_lines AS (
      SELECT
        source_line."id",
        source_line."sales_order_id",
        source_line."quantity",
        COALESCE(purchased."purchased_quantity", 0)::bigint
          AS "purchased_quantity"
      FROM source_sales_order_lines AS source_line
      LEFT JOIN "products" AS source_product
        ON source_product."id" = source_line."product_id"
      LEFT JOIN purchased_by_line AS purchased
        ON purchased."source_sales_order_line_id" = source_line."id"
      WHERE ${targetProductFilter}
    ),
    target_remaining_lines AS (
      SELECT
        target_line."id",
        target_line."sales_order_id",
        (
          target_line."quantity" - target_line."purchased_quantity"
        )::bigint AS "remaining_quantity"
      FROM target_source_sales_order_lines AS target_line
      WHERE target_line."quantity" - target_line."purchased_quantity" > 0
    ),
    target_facts_by_order AS (
      SELECT
        target_line."sales_order_id",
        ARRAY_AGG(target_line."id" ORDER BY target_line."id") AS "target_line_ids",
        SUM(target_line."remaining_quantity")::bigint
          AS "target_remaining_quantity"
      FROM target_remaining_lines AS target_line
      GROUP BY target_line."sales_order_id"
    ),
    active_purchase_by_order AS (
      SELECT
        purchase_order."sales_order_id",
        COUNT(DISTINCT purchase_order."id")::bigint AS "active_purchase_order_count"
      FROM "purchase_orders" AS purchase_order
      WHERE purchase_order."sales_order_id" IS NOT NULL
        AND purchase_order."purchase_type" = 'SALES_LINKED'::purchase_order_type
        AND purchase_order."order_status" <> 'CANCELLED'::purchase_order_status
      GROUP BY purchase_order."sales_order_id"
    ),
    order_purchase_facts AS (
      SELECT
        source_order."id" AS "sales_order_id",
        source_order."order_date",
        source_order."fulfillment_status",
        target_facts."target_line_ids",
        target_facts."target_remaining_quantity",
        COALESCE(active_purchase."active_purchase_order_count", 0)::bigint
          AS "active_purchase_order_count",
        COALESCE(SUM(COALESCE(purchased."purchased_quantity", 0)), 0)::bigint
          AS "purchased_quantity",
        COALESCE(SUM(GREATEST(
          source_line."quantity" - COALESCE(purchased."purchased_quantity", 0),
          0
        )), 0)::bigint AS "remaining_quantity"
      FROM "sales_orders" AS source_order
      INNER JOIN source_sales_order_lines AS source_line
        ON source_line."sales_order_id" = source_order."id"
      INNER JOIN target_facts_by_order AS target_facts
        ON target_facts."sales_order_id" = source_order."id"
      LEFT JOIN purchased_by_line AS purchased
        ON purchased."source_sales_order_line_id" = source_line."id"
      LEFT JOIN active_purchase_by_order AS active_purchase
        ON active_purchase."sales_order_id" = source_order."id"
      WHERE source_order."order_status" = 'CONFIRMED'::sales_order_status
        AND source_order."fulfillment_status" IN (
          'PENDING'::sales_order_fulfillment_status,
          'PREPARING'::sales_order_fulfillment_status,
          'LAND_TRANSIT'::sales_order_fulfillment_status,
          'WAREHOUSE_ARRIVED'::sales_order_fulfillment_status
        )
        ${salesOrderFilter}
        ${keywordFilter}
      GROUP BY
        source_order."id",
        source_order."order_date",
        source_order."fulfillment_status",
        target_facts."target_line_ids",
        target_facts."target_remaining_quantity",
        active_purchase."active_purchase_order_count"
    ),
    classified_source_orders AS (
      SELECT
        facts."sales_order_id",
        facts."order_date",
        facts."target_line_ids",
        facts."target_remaining_quantity",
        CASE
          WHEN facts."fulfillment_status" = 'PENDING'::sales_order_fulfillment_status
            AND facts."active_purchase_order_count" = 0
            AND facts."purchased_quantity" = 0
            AND facts."remaining_quantity" > 0
            THEN 'UNPURCHASED'
          WHEN facts."active_purchase_order_count" > 0
            AND facts."purchased_quantity" > 0
            AND facts."remaining_quantity" > 0
            THEN 'PARTIALLY_PURCHASED'
          ELSE NULL
        END AS "source_view"
      FROM order_purchase_facts AS facts
    )
  `
}

@Injectable()
export class PurchaseOrderSourceQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryLookup: DictionaryLookupService,
  ) {}

  async productOptions(input: PurchaseOrderProductOptionsInput) {
    if (
      input.unclassified === true
      && (input.categoryName !== undefined || input.productHeadName !== undefined)
    ) {
      throw new ApiException(
        422,
        'VALIDATION_FAILED',
        '请求参数校验失败',
        { categoryName: ['未分类筛选不能与分类/产品头筛选同时使用'] },
      )
    }
    let supplierValue: string
    try {
      supplierValue = normalizeDictionaryItemValue(input.supplierValue)
    }
    catch {
      return unavailableSupplier()
    }
    const supplier = await this.dictionaryLookup.resolveStoredValue({
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      value: supplierValue,
    })
    if (supplier.known !== true || !supplier.effectiveEnabled) {
      return unavailableSupplier()
    }
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const keyword = input.keyword?.trim().normalize('NFKC')
    const facetWhere: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      supplierValue,
      purchaseCostAmount: { not: null },
      purchaseCostCurrency: 'CNY',
    }
    const where: Prisma.ProductWhereInput = {
      ...facetWhere,
      ...(input.categoryName === undefined
        ? {}
        : { category: { is: { name: input.categoryName } } }),
      ...(input.productHeadName === undefined
        ? {}
        : { productHead: { is: { name: input.productHeadName } } }),
      ...(input.unclassified === true ? { categoryId: null } : {}),
      ...(keyword === undefined || keyword.length === 0
        ? {}
        : { OR: [
            { productNo: { contains: keyword, mode: 'insensitive' } },
            { name: { contains: keyword, mode: 'insensitive' } },
          ] }),
    }
    const [total, rows, facets] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [
          { category: { sortOrder: 'asc' } },
          { category: { name: 'asc' } },
          { productHead: { sortOrder: 'asc' } },
          { productHead: { name: 'asc' } },
          { sortOrder: 'asc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          productNo: true,
          name: true,
          category: { select: { name: true } },
          productHead: { select: { name: true } },
          attributes: true,
          supplierValue: true,
          purchaseCostAmount: true,
          purchaseCostCurrency: true,
          media: {
            where: {
              kind: 'IMAGE',
              isPrimary: true,
              detachedAt: null,
              mediaAsset: { is: { status: 'READY' } },
            },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            take: 2,
            select: { id: true },
          },
        },
      }),
      readProductOptionCategoryFacets(this.prisma, {
        supplierValue,
        productWhere: facetWhere,
      }),
    ])
    return {
      items: rows.map((row) => {
        if (row.purchaseCostAmount === null) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'PURCHASE_ORDER_STATE_CHANGED',
            '产品采购成本已变化，请重试',
          )
        }
        if (row.media.length > 1) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'PURCHASE_ORDER_STATE_CHANGED',
            '产品主图状态已变化，请重试',
          )
        }
        const mainImage = row.media[0]
        return {
          id: row.id,
          productNo: row.productNo,
          name: row.name,
          categoryName: row.category?.name ?? null,
          productHeadName: row.productHead?.name ?? null,
          attributes: attributes(row.attributes),
          supplierValue: row.supplierValue,
          referencePurchaseUnitPriceAmount: normalizePurchaseOrderReferenceAmount(fixed4(row.purchaseCostAmount)),
          currencyCode: 'CNY' as const,
          mainImage: mainImage === undefined
            ? null
            : {
                id: mainImage.id,
                contentUrl:
                  `/api/purchase-orders/product-options/${row.id}/main-image/${mainImage.id}/content`,
              },
        }
      }),
      categories: facets.categories,
      unclassifiedCount: facets.unclassifiedCount,
      page,
      pageSize,
      total,
    }
  }

  async salesOrders(input: PurchaseOrderSourceSalesOrdersInput) {
    const filter = await this.requireSourceProductFilter(input)
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const keyword = input.keyword?.trim().normalize('NFKC')
    const factsSql = sourceSalesOrderFactsSql({
      ...filter,
      keyword,
      salesOrderId: input.salesOrderId,
    })
    const [countRows, pageRows] = await Promise.all([
      this.prisma.$queryRaw<SourceSalesOrderCountRow[]>(Prisma.sql`
        ${factsSql}
        SELECT
          classified."source_view" AS "view",
          COUNT(*)::bigint AS "count"
        FROM classified_source_orders AS classified
        WHERE classified."source_view" IS NOT NULL
        GROUP BY classified."source_view"
      `),
      this.prisma.$queryRaw<SourceSalesOrderPageRow[]>(Prisma.sql`
        ${factsSql}
        SELECT
          classified."sales_order_id" AS "id",
          classified."target_line_ids" AS "lineIds",
          classified."target_remaining_quantity" AS "remainingQuantity"
        FROM classified_source_orders AS classified
        WHERE classified."source_view" = ${input.view}
        ORDER BY classified."order_date" DESC, classified."sales_order_id" DESC
        LIMIT ${pageSize}
        OFFSET ${(page - 1) * pageSize}
      `),
    ])
    const countByView = new Map<PurchaseOrderSourceSalesOrderView, number>()
    for (const row of countRows) {
      if (PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS.includes(row.view)) {
        countByView.set(row.view, safeCount(row.count))
      }
    }
    const counts = PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS.map(value => ({
      value,
      count: countByView.get(value) ?? 0,
    }))
    const pageIds = pageRows.map(row => row.id)
    const targetLineIds = [...new Set(pageRows.flatMap(row => row.lineIds))]
    const pageFactById = new Map(pageRows.map(row => [row.id, row]))
    const unorderedRows = pageIds.length === 0
      ? []
      : await this.prisma.salesOrder.findMany({
        where: {
          id: { in: pageIds },
          lines: { some: { id: { in: targetLineIds }, removedAt: null } },
        },
        select: {
          id: true,
          orderNo: true,
          orderDate: true,
          issuer: { select: { id: true, displayName: true } },
          customerName: true,
          lineSubtotalAmount: true,
          orderStatus: true,
          fulfillmentStatus: true,
          paymentStatus: true,
          lines: {
            where: { id: { in: targetLineIds }, removedAt: null },
            orderBy: { lineNumber: 'asc' },
            select: {
              id: true,
              productId: true,
              productNameSnapshot: true,
              quantity: true,
              product: {
                select: {
                  media: {
                    where: {
                      kind: 'IMAGE',
                      isPrimary: true,
                      detachedAt: null,
                      mediaAsset: { is: { status: 'READY' } },
                    },
                    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                    take: 1,
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      })
    const rowById = new Map(unorderedRows.map(row => [row.id, row]))
    const rows = pageIds.flatMap((id) => {
      const row = rowById.get(id)
      return row === undefined ? [] : [row]
    })
    return {
      view: input.view,
      counts,
      items: rows.map((row) => {
        const pageFact = pageFactById.get(row.id)
        if (pageFact === undefined) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'PURCHASE_ORDER_STATE_CHANGED',
            '销售订单采购事实已变化，请重试',
          )
        }
        const targetLines = row.lines.filter(line => (
          pageFact.lineIds.includes(line.id)
        ))
        // 图片 URL 必须留在采购权限域，不能复用要求 sales-orders:read 的销售列表内容端点。
        // CUSTOM 行没有目录产品，或目录产品当前没有有效主图时，明确返回 null 供公共组件降级展示。
        const previews = targetLines.map((line) => {
          const mainImage = line.product?.media[0]
          return {
            lineId: line.id,
            productName: line.productNameSnapshot,
            mainImage: line.productId === null || mainImage === undefined
              ? null
              : {
                  id: mainImage.id,
                  contentUrl:
                    `/api/purchase-orders/source-sales-orders/${row.id}/lines/${line.id}/main-image/${mainImage.id}/content`,
                },
          }
        })
        return {
          id: row.id,
          orderNo: row.orderNo,
          orderDate: row.orderDate.toISOString().slice(0, 10),
          issuer: row.issuer,
          customerName: row.customerName,
          salesTotalAmount: fixed4(row.lineSubtotalAmount),
          orderStatus: row.orderStatus,
          fulfillmentStatus: row.fulfillmentStatus,
          paymentStatus: row.paymentStatus,
          lineSummary: {
            lineCount: targetLines.length,
            totalQuantity: safeCount(pageFact.remainingQuantity),
            previews,
          },
        }
      }),
      page,
      pageSize,
      total: countByView.get(input.view) ?? 0,
    }
  }

  async salesOrderLines(
    salesOrderId: string,
    input: PurchaseOrderSourceSalesOrderLinesInput,
  ) {
    const filter = await this.requireSourceProductFilter(input)
    const salesOrder = await this.prisma.salesOrder.findFirst({
      where: {
        id: salesOrderId,
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: {
          in: ['PENDING', 'PREPARING', 'LAND_TRANSIT', 'WAREHOUSE_ARRIVED'],
        },
      },
      select: { id: true, orderNo: true, customerName: true },
    })
    if (salesOrder === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'PURCHASE_ORDER_SOURCE_ORDER_NOT_FOUND',
        '销售来源订单不存在或当前不可用',
      )
    }
    const lines = await this.prisma.salesOrderLine.findMany({
      where: {
        salesOrderId,
        removedAt: null,
        lineType: filter.productMode,
        ...(filter.productMode === 'CATALOG'
          ? { product: { is: { supplierValue: filter.supplierValue as string } } }
          : {}),
      },
      orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        lineNumber: true,
        lineType: true,
        productId: true,
        productNoSnapshot: true,
        productNameSnapshot: true,
        productAttributesSnapshot: true,
        descriptionSnapshot: true,
        quantity: true,
      },
    })
    const sourceIds = lines.map(line => line.id)
    const purchasedRows = sourceIds.length === 0
      ? []
      : await this.prisma.purchaseOrderLine.findMany({
          where: {
            sourceSalesOrderLineId: { in: sourceIds },
            purchaseOrder: { orderStatus: { not: 'CANCELLED' } },
          },
          orderBy: [
            { purchaseOrder: { createdAt: 'asc' } },
            { purchaseOrderId: 'asc' },
            { lineNumber: 'asc' },
            { id: 'asc' },
          ],
          select: {
            id: true,
            sourceSalesOrderLineId: true,
            referencePurchaseUnitPriceAmount: true,
            actualPurchaseUnitPriceAmount: true,
            quantity: true,
            lineTotalAmount: true,
            descriptionSnapshot: true,
          },
        })
    const purchasedBySource = new Map<string, typeof purchasedRows>()
    for (const row of purchasedRows) {
      if (row.sourceSalesOrderLineId === null) {
        continue
      }
      const rows = purchasedBySource.get(row.sourceSalesOrderLineId) ?? []
      rows.push(row)
      purchasedBySource.set(row.sourceSalesOrderLineId, rows)
    }
    const items = lines.map((line) => {
      const purchasedLines = purchasedBySource.get(line.id) ?? []
      const purchasedQuantity = purchasedLines.reduce(
        (sum, purchasedLine) => sum + purchasedLine.quantity,
        0,
      )
      return {
        id: line.id,
        lineNumber: line.lineNumber,
        lineType: line.lineType,
        productId: line.productId,
        productNo: line.productNoSnapshot,
        productName: line.productNameSnapshot,
        productAttributes: attributes(line.productAttributesSnapshot),
        description: line.descriptionSnapshot,
        quantity: line.quantity,
        purchasedQuantity,
        remainingQuantity: Math.max(0, line.quantity - purchasedQuantity),
        purchasedLines: purchasedLines.map(purchasedLine => ({
          id: purchasedLine.id,
          referencePurchaseUnitPriceAmount:
            fixed4(purchasedLine.referencePurchaseUnitPriceAmount),
          actualPurchaseUnitPriceAmount:
            formatPurchaseOrderAmountUnits(parsePurchaseOrderAmountUnits(fixed4(purchasedLine.actualPurchaseUnitPriceAmount))),
          quantity: purchasedLine.quantity,
          lineTotalAmount: formatPurchaseOrderAmountUnits(parsePurchaseOrderAmountUnits(fixed4(purchasedLine.lineTotalAmount))),
          description: purchasedLine.descriptionSnapshot,
        })),
      }
    })
    if (!items.some(line => line.remainingQuantity > 0)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'PURCHASE_ORDER_STATE_CHANGED',
        '销售订单已无符合当前条件的剩余可采购产品',
      )
    }
    return {
      salesOrder,
      items,
    }
  }

  private async requireSourceProductFilter(
    input: PurchaseOrderSourceSalesOrderLinesInput,
  ): Promise<NormalizedSourceProductFilter> {
    if (input.productMode !== 'CATALOG' && input.productMode !== 'CUSTOM') {
      return invalidSourceProductMode()
    }
    if (input.productMode === 'CUSTOM') {
      if (input.supplierValue !== undefined) return invalidSourceSupplier()
      return Object.freeze({ productMode: 'CUSTOM', supplierValue: null })
    }
    if (input.supplierValue === undefined) return invalidSourceSupplier()
    let supplierValue: string
    try {
      supplierValue = normalizeDictionaryItemValue(input.supplierValue)
    }
    catch {
      return invalidSourceSupplier()
    }
    const supplier = await this.dictionaryLookup.resolveStoredValue({
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      value: supplierValue,
    })
    if (supplier.known !== true || !supplier.effectiveEnabled) {
      return unavailableSupplier()
    }
    return Object.freeze({ productMode: 'CATALOG', supplierValue })
  }
}
