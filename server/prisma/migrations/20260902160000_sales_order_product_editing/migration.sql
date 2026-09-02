BEGIN;

ALTER TYPE "audit_event_type" ADD VALUE 'SALES_ORDER_PRODUCTS_CHANGED';

ALTER TABLE "sales_order_lines" ADD COLUMN "removed_at" TIMESTAMPTZ(6);

-- 销售产品允许业务软移除；订单产品小计和至少一行约束只认当前有效明细。
CREATE OR REPLACE FUNCTION "enforce_sales_order_line_subtotal"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_order_id UUID;
  expected_subtotal NUMERIC(30, 4);
  actual_subtotal NUMERIC(30, 4);
  line_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'sales_orders' THEN
    target_order_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    target_order_id := OLD."sales_order_id";
  ELSE
    target_order_id := NEW."sales_order_id";
  END IF;

  SELECT "line_subtotal_amount"
  INTO expected_subtotal
  FROM "sales_orders"
  WHERE "id" = target_order_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*)::integer, COALESCE(sum("line_total_amount"), 0)
  INTO line_count, actual_subtotal
  FROM "sales_order_lines"
  WHERE "sales_order_id" = target_order_id
    AND "removed_at" IS NULL;

  IF line_count < 1 OR expected_subtotal <> actual_subtotal THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order line subtotal does not match active lines',
      CONSTRAINT = 'sales_order_lines_subtotal_check';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 已取消采购保留历史来源；任何有效采购都不得继续引用已软移除的销售明细。
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
          OR sales_order."order_status" <> 'CONFIRMED'
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

-- 直接更新销售数量或软移除时也必须在提交前重新验证有效采购覆盖。
CREATE OR REPLACE FUNCTION "enforce_purchase_order_source_quantity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sales_order_lines" AS sales_line
    JOIN (
      SELECT
        line."source_sales_order_line_id",
        SUM(line."quantity") AS purchased_quantity
      FROM "purchase_order_lines" AS line
      JOIN "purchase_orders" AS purchase_order
        ON purchase_order."id" = line."purchase_order_id"
      WHERE
        line."source_sales_order_line_id" IS NOT NULL
        AND purchase_order."order_status" <> 'CANCELLED'
      GROUP BY line."source_sales_order_line_id"
    ) AS purchased
      ON purchased."source_sales_order_line_id" = sales_line."id"
    WHERE purchased."purchased_quantity" > sales_line."quantity"
      OR (
        sales_line."removed_at" IS NOT NULL
        AND purchased."purchased_quantity" > 0
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_source_quantity_check',
      MESSAGE = 'active purchase quantity exceeds or references a removed source sales line';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "sales_order_lines_source_quantity_trigger"
AFTER UPDATE OF "quantity", "removed_at" ON "sales_order_lines"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_source_quantity"();

COMMIT;
