BEGIN;

-- 开票金额改为 Decimal 整数（NUMERIC(30,0)），并在数据库层强制：
-- 1) 每张申请单至少一条明细；
-- 2) sales_amount = 所有明细行 amount 之和。
--
-- 跨表汇总无法写成 CHECK，使用 DEFERRABLE INITIALLY DEFERRED 约束触发器，
-- 在事务提交时读取最终状态；退回重填时的删除/重建中间态不会误报。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM invoice_requests r
    WHERE NOT EXISTS (
      SELECT 1 FROM invoice_request_lines l WHERE l.request_id = r.id
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'invoice request without lines cannot be migrated; add at least one line first';
  END IF;

  IF EXISTS (
    SELECT 1 FROM invoice_requests r
    WHERE r.sales_amount <> (
      SELECT COALESCE(SUM(l.amount), 0)
      FROM invoice_request_lines l
      WHERE l.request_id = r.id
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'invoice request sales amount does not equal the sum of its lines; reconcile before migrating';
  END IF;
END $$;

ALTER TABLE invoice_requests
  ALTER COLUMN sales_amount TYPE NUMERIC(30,0) USING sales_amount::numeric(30,0),
  ALTER COLUMN tax_amount TYPE NUMERIC(30,0) USING tax_amount::numeric(30,0),
  ALTER COLUMN total_amount TYPE NUMERIC(30,0) USING total_amount::numeric(30,0);

ALTER TABLE invoice_request_lines
  ALTER COLUMN unit_price TYPE NUMERIC(30,0) USING unit_price::numeric(30,0),
  ALTER COLUMN amount TYPE NUMERIC(30,0) USING amount::numeric(30,0);

CREATE OR REPLACE FUNCTION enforce_invoice_request_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_request_id UUID;
  expected_sales NUMERIC(30,0);
  line_count INTEGER;
  line_sum NUMERIC(30,0);
BEGIN
  IF TG_TABLE_NAME = 'invoice_request_lines' THEN
    target_request_id := COALESCE(NEW.request_id, OLD.request_id);
  ELSE
    target_request_id := COALESCE(NEW.id, OLD.id);
  END IF;

  SELECT sales_amount INTO expected_sales
  FROM invoice_requests
  WHERE id = target_request_id;

  -- 申请单被删除时由生命周期触发器先拒绝；这里只处理仍存在的父单。
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::integer, COALESCE(SUM(amount), 0)
  INTO line_count, line_sum
  FROM invoice_request_lines
  WHERE request_id = target_request_id;

  IF line_count < 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'invoice request must have at least one line',
      CONSTRAINT = 'invoice_requests_line_count_check';
  END IF;

  IF expected_sales <> line_sum THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'invoice request sales amount must equal the sum of its lines',
      CONSTRAINT = 'invoice_requests_line_total_check';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER invoice_request_lines_totals_trigger
AFTER INSERT OR UPDATE OR DELETE ON invoice_request_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_invoice_request_totals();

CREATE CONSTRAINT TRIGGER invoice_requests_totals_trigger
AFTER INSERT OR UPDATE OF sales_amount ON invoice_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_invoice_request_totals();

COMMIT;
