import { Prisma, type Prisma as PrismaTypes } from '../../generated/prisma/client'

interface AwaitingPurchaseReviewRow {
  readonly salesOrderId: string
  readonly pendingReviewOrderCount: number
}

/**
 * 一次读取全部「采购审核中」的待采购订单，供列表分桶、停留原因与状态计数共用。
 *
 * 判定口径（必须与采购覆盖推进服务 `purchase-orders/sales-order-purchase-coverage.service.ts`
 * 保持一致，否则「为什么还停在待采购」会与真实推进规则漂移）：
 * - 有效采购 = `SALES_LINKED` 且 `orderStatus != CANCELLED`，审核中数量只预占余额；
 * - 已审核采购 = `CONFIRMED/COMPLETED`，只有它才推进销售履约状态；
 * - 只有每条销售明细都被有效采购占满、且至少一条明细尚未被已审核采购覆盖，
 *   同时存在指向这些明细的审核中采购单，才属于「采购审核中」。
 *   最后一条是兜底：已审核已全量覆盖却没推进属于历史漂移，不在界面显示停留原因。
 *
 * 结果只含订单 ID 与审核中采购单数量，不返回采购单标识或金额，避免读接口外泄
 * 采购域数据；调用方只用它构造 `id IN (...)` 过滤与提示文案。
 */
export async function readAwaitingPurchaseReviewSalesOrders(
  client: PrismaTypes.TransactionClient,
): Promise<ReadonlyMap<string, number>> {
  const rows = await client.$queryRaw<AwaitingPurchaseReviewRow[]>(Prisma.sql`
    WITH pending_sales_orders AS (
      -- 只有待采购订单才可能进入本分桶；先收窄候选集，避免每次列表请求聚合全量销售明细。
      SELECT sales_order."id"
      FROM "sales_orders" AS sales_order
      WHERE sales_order."order_status" = CAST('CONFIRMED' AS "sales_order_status")
        AND sales_order."fulfillment_status" = CAST('PENDING' AS "sales_order_fulfillment_status")
    ),
    source_sales_lines AS (
      SELECT
        sales_line."id",
        sales_line."sales_order_id",
        sales_line."quantity"
      FROM "sales_order_lines" AS sales_line
      INNER JOIN pending_sales_orders AS pending
        ON pending."id" = sales_line."sales_order_id"
      WHERE sales_line."removed_at" IS NULL
    ),
    purchased_by_line AS (
      SELECT
        purchase_line."source_sales_order_line_id" AS "sales_order_line_id",
        SUM(purchase_line."quantity")::bigint AS "active_quantity",
        COALESCE(SUM(purchase_line."quantity") FILTER (
          WHERE purchase_order."order_status" IN (
            CAST('CONFIRMED' AS "purchase_order_status"),
            CAST('COMPLETED' AS "purchase_order_status")
          )
        ), 0)::bigint AS "approved_quantity"
      FROM "purchase_order_lines" AS purchase_line
      INNER JOIN "purchase_orders" AS purchase_order
        ON purchase_order."id" = purchase_line."purchase_order_id"
      WHERE purchase_line."source_sales_order_line_id" IS NOT NULL
        AND purchase_order."purchase_type" = CAST('SALES_LINKED' AS "purchase_order_type")
        AND purchase_order."order_status" <> CAST('CANCELLED' AS "purchase_order_status")
      GROUP BY purchase_line."source_sales_order_line_id"
    ),
    coverage_by_sales_order AS (
      SELECT
        source_line."sales_order_id",
        COUNT(*)::int AS "line_count",
        COUNT(*) FILTER (
          WHERE source_line."quantity" - COALESCE(purchased."active_quantity", 0) > 0
        )::int AS "remaining_line_count",
        COUNT(*) FILTER (
          WHERE COALESCE(purchased."approved_quantity", 0) >= source_line."quantity"
        )::int AS "approved_line_count"
      FROM source_sales_lines AS source_line
      LEFT JOIN purchased_by_line AS purchased
        ON purchased."sales_order_line_id" = source_line."id"
      GROUP BY source_line."sales_order_id"
    ),
    awaiting_by_sales_order AS (
      SELECT
        purchase_order."sales_order_id",
        COUNT(DISTINCT purchase_order."id")::int AS "pending_review_order_count"
      FROM "purchase_orders" AS purchase_order
      INNER JOIN "purchase_order_lines" AS purchase_line
        ON purchase_line."purchase_order_id" = purchase_order."id"
      INNER JOIN source_sales_lines AS source_line
        ON source_line."id" = purchase_line."source_sales_order_line_id"
      WHERE purchase_order."purchase_type" = CAST('SALES_LINKED' AS "purchase_order_type")
        AND purchase_order."order_status" = CAST('PENDING_REVIEW' AS "purchase_order_status")
      GROUP BY purchase_order."sales_order_id"
    )
    SELECT
      pending."id" AS "salesOrderId",
      awaiting."pending_review_order_count" AS "pendingReviewOrderCount"
    FROM pending_sales_orders AS pending
    INNER JOIN coverage_by_sales_order AS coverage
      ON coverage."sales_order_id" = pending."id"
    INNER JOIN awaiting_by_sales_order AS awaiting
      ON awaiting."sales_order_id" = pending."id"
    WHERE coverage."line_count" > 0
      AND coverage."remaining_line_count" = 0
      AND coverage."approved_line_count" < coverage."line_count"
  `)
  return new Map(rows.map(row => [row.salesOrderId, row.pendingReviewOrderCount] as const))
}
