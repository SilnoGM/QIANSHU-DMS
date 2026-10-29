BEGIN;

-- 原守卫每次触发都扫描全库销售行，一条历史超量数据会阻塞所有采购单写入。
-- 改为只校验本次写入实际影响到的销售行；违规行本身仍失败关闭。
CREATE OR REPLACE FUNCTION assert_sales_line_supply_quantity(target_sales_line_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  source_quantity integer;
  source_removed_at timestamptz;
  purchased_quantity bigint;
  claimed_quantity bigint;
BEGIN
  IF target_sales_line_id IS NULL THEN
    RETURN;
  END IF;

  SELECT line."quantity", line."removed_at"
  INTO source_quantity, source_removed_at
  FROM "sales_order_lines" AS line
  WHERE line."id" = target_sales_line_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(purchase_line."quantity"), 0)
  INTO purchased_quantity
  FROM "purchase_order_lines" AS purchase_line
  JOIN "purchase_orders" AS purchase_order
    ON purchase_order."id" = purchase_line."purchase_order_id"
  WHERE purchase_line."source_sales_order_line_id" = target_sales_line_id
    AND purchase_order."order_status" <> 'CANCELLED'::"purchase_order_status";

  SELECT COALESCE(SUM(claim."quantity"), 0)
  INTO claimed_quantity
  FROM "shipment_claim_lines" AS claim
  JOIN "shipment_storage_records" AS storage
    ON storage."id" = claim."storage_record_id"
  WHERE claim."sales_order_line_id" = target_sales_line_id
    AND storage."status" = 'CLAIMED'::"shipment_storage_status";

  IF purchased_quantity + claimed_quantity > source_quantity
    OR (
      source_removed_at IS NOT NULL
      AND (purchased_quantity > 0 OR claimed_quantity > 0)
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_source_quantity_check',
      MESSAGE = 'active purchase and claimed quantities exceed the source sales line quantity';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_purchase_order_source_quantity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_line_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'purchase_orders' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    FOR source_line_id IN
      SELECT DISTINCT purchase_line."source_sales_order_line_id"
      FROM "purchase_order_lines" AS purchase_line
      WHERE purchase_line."purchase_order_id" = NEW."id"
        AND purchase_line."source_sales_order_line_id" IS NOT NULL
    LOOP
      PERFORM assert_sales_line_supply_quantity(source_line_id);
    END LOOP;
  ELSIF TG_TABLE_NAME = 'purchase_order_lines' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      PERFORM assert_sales_line_supply_quantity(OLD."source_sales_order_line_id");
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      PERFORM assert_sales_line_supply_quantity(NEW."source_sales_order_line_id");
    END IF;
  ELSIF TG_TABLE_NAME = 'shipment_claim_lines' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      PERFORM assert_sales_line_supply_quantity(OLD."sales_order_line_id");
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      PERFORM assert_sales_line_supply_quantity(NEW."sales_order_line_id");
    END IF;
  ELSIF TG_TABLE_NAME = 'sales_order_lines' THEN
    IF TG_OP = 'DELETE' THEN
      PERFORM assert_sales_line_supply_quantity(OLD."id");
    ELSE
      PERFORM assert_sales_line_supply_quantity(NEW."id");
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 认领行触发器沿用上一版本已创建的定义；这里只补自校验。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'shipment_claim_lines_source_quantity_trigger'
      AND NOT tgisinternal
  )
  THEN
    CREATE CONSTRAINT TRIGGER "shipment_claim_lines_source_quantity_trigger"
    AFTER INSERT OR UPDATE OR DELETE ON "shipment_claim_lines"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_source_quantity"();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'assert_sales_line_supply_quantity'
  )
  THEN
    RAISE EXCEPTION 'row-scoped supply quantity guard is missing'
      USING ERRCODE = '23514', CONSTRAINT = 'sales_line_supply_guard_scope_check';
  END IF;
END $$;

COMMIT;
