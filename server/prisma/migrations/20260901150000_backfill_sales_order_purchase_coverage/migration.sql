BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- 校准期间阻止订单和明细并发写入，确保覆盖数量、状态更新与历史记录来自同一事实快照。
LOCK TABLE
  "sales_orders",
  "sales_order_lines",
  "purchase_orders",
  "purchase_order_lines",
  "sales_order_status_history"
IN SHARE ROW EXCLUSIVE MODE;

WITH "fully_covered_orders" AS (
  SELECT
    "sales_order"."id",
    "final_purchase"."changed_by_user_id"
  FROM "sales_orders" AS "sales_order"
  CROSS JOIN LATERAL (
    -- 运行时联动由最终完成覆盖的采购提交人触发；历史校准沿用最后一张有效销售关联采购单的创建人。
    SELECT "purchase_order"."created_by_user_id" AS "changed_by_user_id"
    FROM "purchase_orders" AS "purchase_order"
    WHERE "purchase_order"."sales_order_id" = "sales_order"."id"
      AND "purchase_order"."purchase_type" = 'SALES_LINKED'
      AND "purchase_order"."order_status" <> 'CANCELLED'
    ORDER BY
      "purchase_order"."created_at" DESC,
      "purchase_order"."id" DESC
    LIMIT 1
  ) AS "final_purchase"
  WHERE "sales_order"."order_status" = 'CONFIRMED'
    AND "sales_order"."fulfillment_status" = 'PENDING'
    AND EXISTS (
      SELECT 1
      FROM "sales_order_lines" AS "sales_line"
      WHERE "sales_line"."sales_order_id" = "sales_order"."id"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "sales_order_lines" AS "sales_line"
      WHERE "sales_line"."sales_order_id" = "sales_order"."id"
        AND COALESCE((
          SELECT SUM("purchase_line"."quantity")
          FROM "purchase_order_lines" AS "purchase_line"
          INNER JOIN "purchase_orders" AS "purchase_order"
            ON "purchase_order"."id" = "purchase_line"."purchase_order_id"
          WHERE "purchase_line"."source_sales_order_line_id" = "sales_line"."id"
            AND "purchase_order"."sales_order_id" = "sales_order"."id"
            AND "purchase_order"."purchase_type" = 'SALES_LINKED'
            AND "purchase_order"."order_status" <> 'CANCELLED'
        ), 0) < "sales_line"."quantity"
    )
),
"advanced_orders" AS (
  UPDATE "sales_orders" AS "sales_order"
  SET
    "fulfillment_status" = 'PREPARING',
    "version" = "sales_order"."version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
  FROM "fully_covered_orders" AS "covered"
  WHERE "sales_order"."id" = "covered"."id"
  RETURNING
    "sales_order"."id",
    "covered"."changed_by_user_id"
)
INSERT INTO "sales_order_status_history" (
  "sales_order_id",
  "dimension",
  "from_status",
  "to_status",
  "reason",
  "changed_by_user_id"
)
SELECT
  "advanced_order"."id",
  'FULFILLMENT',
  'PENDING',
  'PREPARING',
  '历史采购已覆盖全部销售产品，迁移校准',
  "advanced_order"."changed_by_user_id"
FROM "advanced_orders" AS "advanced_order";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sales_orders" AS "sales_order"
    WHERE "sales_order"."order_status" = 'CONFIRMED'
      AND "sales_order"."fulfillment_status" = 'PENDING'
      AND EXISTS (
        SELECT 1
        FROM "sales_order_lines" AS "sales_line"
        WHERE "sales_line"."sales_order_id" = "sales_order"."id"
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "sales_order_lines" AS "sales_line"
        WHERE "sales_line"."sales_order_id" = "sales_order"."id"
          AND COALESCE((
            SELECT SUM("purchase_line"."quantity")
            FROM "purchase_order_lines" AS "purchase_line"
            INNER JOIN "purchase_orders" AS "purchase_order"
              ON "purchase_order"."id" = "purchase_line"."purchase_order_id"
            WHERE "purchase_line"."source_sales_order_line_id" = "sales_line"."id"
              AND "purchase_order"."sales_order_id" = "sales_order"."id"
              AND "purchase_order"."purchase_type" = 'SALES_LINKED'
              AND "purchase_order"."order_status" <> 'CANCELLED'
          ), 0) < "sales_line"."quantity"
      )
  ) THEN
    RAISE EXCEPTION 'sales order purchase coverage migration invariant mismatch: backfill';
  END IF;
END;
$$;

COMMIT;
