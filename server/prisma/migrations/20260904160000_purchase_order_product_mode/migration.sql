BEGIN;

-- 产品类型由采购明细的历史事实回填。锁住订单与明细，防止检查、回填与约束生效之间出现并发写入。
LOCK TABLE "purchase_orders", "purchase_order_lines" IN ACCESS EXCLUSIVE MODE;

-- 无明细订单无法推导产品类型；未知类型也不允许被静默归入 CATALOG。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchase_orders" AS purchase_order
    LEFT JOIN "purchase_order_lines" AS purchase_line
      ON purchase_line."purchase_order_id" = purchase_order."id"
    GROUP BY purchase_order."id"
    HAVING
      COUNT(purchase_line."id") = 0
      OR COUNT(*) FILTER (
        WHERE purchase_line."id" IS NOT NULL
          AND purchase_line."line_type"::text NOT IN ('CATALOG', 'CUSTOM')
      ) > 0
  ) THEN
    RAISE EXCEPTION 'purchase order product mode migration invariant mismatch: unsupported historical lines';
  END IF;
END
$$;

-- 保存业务事实摘要，迁移结束前再次校验未改号、未改金额、未改状态、未改销售来源与未增删明细。
CREATE TEMP TABLE "purchase_order_product_mode_migration_baseline" ON COMMIT DROP AS
SELECT
  (SELECT COUNT(*) FROM "purchase_orders") AS "order_count",
  (SELECT COUNT(*) FROM "purchase_order_lines") AS "line_count",
  (
    SELECT MD5(COALESCE(STRING_AGG(
      CONCAT_WS(
        '|',
        purchase_order."id"::text,
        purchase_order."order_no",
        purchase_order."line_subtotal_amount"::text,
        purchase_order."purchase_total_amount"::text,
        purchase_order."order_status"::text,
        COALESCE(purchase_order."sales_order_id"::text, '<NULL>')
      ),
      E'\n' ORDER BY purchase_order."id"
    ), ''))
    FROM "purchase_orders" AS purchase_order
  ) AS "order_fact_digest";

CREATE TYPE "purchase_order_product_mode" AS ENUM ('CATALOG', 'CUSTOM', 'MIXED');

ALTER TABLE "purchase_orders"
  ADD COLUMN "product_mode" "purchase_order_product_mode",
  ADD COLUMN "custom_supplier_name" VARCHAR(128),
  ALTER COLUMN "supplier_value" DROP NOT NULL;

WITH "line_facts" AS (
  SELECT
    purchase_order."id" AS "purchase_order_id",
    BOOL_OR(purchase_line."line_type"::text = 'CATALOG') AS "has_catalog",
    BOOL_OR(purchase_line."line_type"::text = 'CUSTOM') AS "has_custom"
  FROM "purchase_orders" AS purchase_order
  INNER JOIN "purchase_order_lines" AS purchase_line
    ON purchase_line."purchase_order_id" = purchase_order."id"
  GROUP BY purchase_order."id"
)
UPDATE "purchase_orders" AS purchase_order
SET "product_mode" = CASE
  WHEN line_facts."has_catalog" AND line_facts."has_custom" THEN 'MIXED'::"purchase_order_product_mode"
  WHEN line_facts."has_custom" THEN 'CUSTOM'::"purchase_order_product_mode"
  ELSE 'CATALOG'::"purchase_order_product_mode"
END
FROM "line_facts" AS line_facts
WHERE line_facts."purchase_order_id" = purchase_order."id";

-- 历史回填会触发现有的延迟采购来源约束。下一次 ALTER TABLE 前仅结算该命名约束，
-- 避免非空数据库因 pending trigger events 拒绝修改 purchase_orders 的表结构。
SET CONSTRAINTS "purchase_orders_line_source_trigger" IMMEDIATE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchase_orders"
    WHERE "product_mode" IS NULL
  ) THEN
    RAISE EXCEPTION 'purchase order product mode migration invariant mismatch: incomplete backfill';
  END IF;
END
$$;

ALTER TABLE "purchase_orders"
  ALTER COLUMN "product_mode" SET NOT NULL,
  ADD CONSTRAINT "purchase_orders_supplier_value_nonblank_check"
    CHECK ("supplier_value" IS NULL OR BTRIM("supplier_value") <> ''),
  ADD CONSTRAINT "purchase_orders_custom_supplier_name_nonblank_check"
    CHECK ("custom_supplier_name" IS NULL OR BTRIM("custom_supplier_name") <> ''),
  ADD CONSTRAINT "purchase_orders_supplier_source_exactly_one_check"
    CHECK (
      ("supplier_value" IS NOT NULL AND "custom_supplier_name" IS NULL)
      OR
      ("supplier_value" IS NULL AND "custom_supplier_name" IS NOT NULL)
    );

CREATE INDEX "purchase_orders_custom_supplier_date_id_idx"
  ON "purchase_orders"("custom_supplier_name", "order_date" DESC, "id" DESC);

DO $$
DECLARE
  baseline RECORD;
  current_order_count BIGINT;
  current_line_count BIGINT;
  current_order_fact_digest TEXT;
BEGIN
  SELECT * INTO STRICT baseline
  FROM "purchase_order_product_mode_migration_baseline";

  SELECT COUNT(*) INTO current_order_count FROM "purchase_orders";
  SELECT COUNT(*) INTO current_line_count FROM "purchase_order_lines";
  SELECT MD5(COALESCE(STRING_AGG(
    CONCAT_WS(
      '|',
      purchase_order."id"::text,
      purchase_order."order_no",
      purchase_order."line_subtotal_amount"::text,
      purchase_order."purchase_total_amount"::text,
      purchase_order."order_status"::text,
      COALESCE(purchase_order."sales_order_id"::text, '<NULL>')
    ),
    E'\n' ORDER BY purchase_order."id"
  ), '')) INTO current_order_fact_digest
  FROM "purchase_orders" AS purchase_order;

  IF current_order_count <> baseline."order_count"
    OR current_line_count <> baseline."line_count"
    OR current_order_fact_digest <> baseline."order_fact_digest"
  THEN
    RAISE EXCEPTION 'purchase order product mode migration invariant mismatch: business facts changed';
  END IF;
END
$$;

COMMIT;
