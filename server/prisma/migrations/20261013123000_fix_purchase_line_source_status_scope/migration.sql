BEGIN;

-- 既有触发器缺陷修复：enforce_purchase_order_line_source 是全表扫描的延迟约束触发器，
-- 原实现在「有效采购」分支里要求来源销售单必须是 CONFIRMED，导致销售单合法进入
-- PENDING_RECONCILIATION / COMPLETED（已签收且已付清后的正常推进）后，任何一次采购单写入
-- 都会在提交时全局报「purchase order line source does not match its order and active sales line」。
-- 语义修正：有效采购（未取消）不得引用已取消的销售单；其余销售单状态（已确认/待对账/已完成）
-- 都允许继续挂靠。软移除行与跨单引用的校验保持不变。
CREATE OR REPLACE FUNCTION "enforce_purchase_order_line_source"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchase_order_lines" AS line
    JOIN "purchase_orders" AS purchase_order
      ON purchase_order."id" = line."purchase_order_id"
    LEFT JOIN "sales_order_lines" AS sales_line
      ON sales_line."id" = line."source_sales_order_line_id"
    LEFT JOIN "sales_orders" AS sales_order
      ON sales_order."id" = sales_line."sales_order_id"
    WHERE
      (
        purchase_order."purchase_type" = 'STOCK'
        AND line."source_sales_order_line_id" IS NOT NULL
      )
      OR
      (
        purchase_order."purchase_type" = 'SALES_LINKED'
        AND (
          line."source_sales_order_line_id" IS NULL
          OR sales_line."sales_order_id" <> purchase_order."sales_order_id"
          OR (
            purchase_order."order_status" <> 'CANCELLED'
            AND sales_order."order_status" = 'CANCELLED'
          )
          OR sales_line."line_type"::text <> line."line_type"::text
          OR (
            line."line_type" = 'CATALOG'
            AND sales_line."product_id" IS DISTINCT FROM line."product_id"
          )
          OR (
            purchase_order."order_status" <> 'CANCELLED'
            AND sales_line."removed_at" IS NOT NULL
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_lines_source_shape_check',
      MESSAGE = 'purchase order line source does not match its order and active sales line';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 数据不变量：修复后不再存在「有效采购引用已取消销售单」的行。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchase_order_lines" AS line
    JOIN "purchase_orders" AS purchase_order
      ON purchase_order."id" = line."purchase_order_id"
    LEFT JOIN "sales_order_lines" AS sales_line
      ON sales_line."id" = line."source_sales_order_line_id"
    LEFT JOIN "sales_orders" AS sales_order
      ON sales_order."id" = sales_line."sales_order_id"
    WHERE purchase_order."purchase_type" = 'SALES_LINKED'
      AND purchase_order."order_status" <> 'CANCELLED'
      AND line."source_sales_order_line_id" IS NOT NULL
      AND sales_order."order_status" = 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'purchase line source migration invariant mismatch: active purchase references cancelled sales order';
  END IF;
END $$;

COMMIT;
