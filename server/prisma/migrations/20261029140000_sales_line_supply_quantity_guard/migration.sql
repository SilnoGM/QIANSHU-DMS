BEGIN;

-- 销售行的备货占用必须同时包含采购数量与寄仓认领数量：
-- 采购（含审核中）和调货认领都不能超过销售明细数量，二者合计也不能超过。
CREATE OR REPLACE FUNCTION "enforce_purchase_order_source_quantity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sales_order_lines" AS sales_line
    LEFT JOIN (
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
    LEFT JOIN (
      SELECT
        claim."sales_order_line_id",
        SUM(claim."quantity") AS claimed_quantity
      FROM "shipment_claim_lines" AS claim
      JOIN "shipment_storage_records" AS storage
        ON storage."id" = claim."storage_record_id"
      WHERE storage."status" = 'CLAIMED'::"shipment_storage_status"
      GROUP BY claim."sales_order_line_id"
    ) AS claimed
      ON claimed."sales_order_line_id" = sales_line."id"
    WHERE
      COALESCE(purchased."purchased_quantity", 0)
        + COALESCE(claimed."claimed_quantity", 0) > sales_line."quantity"
      OR (
        sales_line."removed_at" IS NOT NULL
        AND (
          COALESCE(purchased."purchased_quantity", 0) > 0
          OR COALESCE(claimed."claimed_quantity", 0) > 0
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_source_quantity_check',
      MESSAGE = 'active purchase and claimed quantities exceed the source sales line quantity';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 认领行只追加；新增时同样在提交前校验“采购 + 认领 ≤ 销售行数量”。
CREATE CONSTRAINT TRIGGER "shipment_claim_lines_source_quantity_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "shipment_claim_lines"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_source_quantity"();

-- 自校验：函数已包含认领表，认领触发器存在。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'shipment_claim_lines_source_quantity_trigger'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'shipment claim source quantity trigger is missing'
      USING ERRCODE = '23514', CONSTRAINT = 'sales_line_supply_quantity_guard_check';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'enforce_purchase_order_source_quantity'
      AND prosrc LIKE '%shipment_claim_lines%'
  ) THEN
    RAISE EXCEPTION 'source quantity guard does not include claimed quantities'
      USING ERRCODE = '23514', CONSTRAINT = 'sales_line_supply_quantity_guard_check';
  END IF;
END $$;

COMMIT;
