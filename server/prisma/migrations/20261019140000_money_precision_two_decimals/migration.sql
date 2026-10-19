BEGIN;

-- 销售域、产品价格、包装费用统一收窄为两位小数。
--
-- 1) 先移除会在收窄过程中被独立舍入破坏的勾稽约束；收窄后按整单重算，
--    再恢复约束。这里不依赖“历史数据恰好都是两位”，生产库若有四位数据也能收敛。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sales_orders o
    WHERE NOT EXISTS (
      SELECT 1 FROM sales_order_lines l
      WHERE l.sales_order_id = o.id AND l.removed_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order without active lines cannot be narrowed to two decimals';
  END IF;
END $$;

-- PostgreSQL 不允许修改被列级触发器定义引用的列；先摘除两条触发器，
-- 收窄并重算数据后按原定义恢复。
DROP TRIGGER "sales_orders_line_subtotal_trigger" ON "sales_orders";
DROP TRIGGER "sales_orders_payment_summary_trigger" ON "sales_orders";

ALTER TABLE sales_orders
  DROP CONSTRAINT sales_orders_agreed_total_matches_lines_check,
  DROP CONSTRAINT sales_orders_payment_terms_sum_check,
  DROP CONSTRAINT sales_orders_amount_scales_check;

ALTER TABLE sales_order_lines
  DROP CONSTRAINT sales_order_lines_amount_scales_check;

ALTER TABLE sales_order_payments
  DROP CONSTRAINT sales_order_payments_amount_positive_check;

ALTER TABLE sales_receipt_requests
  DROP CONSTRAINT sales_receipt_requests_amount_check;

ALTER TABLE sales_order_amount_revisions
  DROP CONSTRAINT sales_order_amount_revisions_old_sum_check,
  DROP CONSTRAINT sales_order_amount_revisions_new_sum_check,
  DROP CONSTRAINT sales_order_amount_revisions_changed_check;

-- 2) 金额列统一 NUMERIC(30,2)。所有表达式显式 ROUND，避免 PostgreSQL
--    在隐式收窄时按不同规则处理。
ALTER TABLE products
  ALTER COLUMN twd_sale_price_amount TYPE NUMERIC(30,2) USING ROUND(twd_sale_price_amount, 2),
  ALTER COLUMN myr_sale_price_amount TYPE NUMERIC(30,2) USING ROUND(myr_sale_price_amount, 2),
  ALTER COLUMN purchase_cost_amount TYPE NUMERIC(30,2) USING ROUND(purchase_cost_amount, 2);

ALTER TABLE sales_orders
  ALTER COLUMN line_subtotal_amount TYPE NUMERIC(30,2) USING ROUND(line_subtotal_amount, 2),
  ALTER COLUMN agreed_total_amount TYPE NUMERIC(30,2) USING ROUND(agreed_total_amount, 2),
  ALTER COLUMN deposit_due_amount TYPE NUMERIC(30,2) USING ROUND(deposit_due_amount, 2),
  ALTER COLUMN balance_due_amount TYPE NUMERIC(30,2) USING ROUND(balance_due_amount, 2);

ALTER TABLE sales_order_lines
  ALTER COLUMN standard_unit_price_amount TYPE NUMERIC(30,2) USING ROUND(standard_unit_price_amount, 2),
  ALTER COLUMN actual_unit_price_amount TYPE NUMERIC(30,2) USING ROUND(actual_unit_price_amount, 2),
  ALTER COLUMN line_total_amount TYPE NUMERIC(30,2) USING ROUND(line_total_amount, 2);

ALTER TABLE sales_order_payments
  ALTER COLUMN amount TYPE NUMERIC(30,2) USING ROUND(amount, 2);

ALTER TABLE sales_receipt_requests
  ALTER COLUMN amount TYPE NUMERIC(30,2) USING ROUND(amount, 2);

ALTER TABLE sales_order_amount_revisions
  ALTER COLUMN old_line_subtotal_amount TYPE NUMERIC(30,2) USING ROUND(old_line_subtotal_amount, 2),
  ALTER COLUMN old_agreed_total_amount TYPE NUMERIC(30,2) USING ROUND(old_agreed_total_amount, 2),
  ALTER COLUMN old_deposit_due_amount TYPE NUMERIC(30,2) USING ROUND(old_deposit_due_amount, 2),
  ALTER COLUMN old_balance_due_amount TYPE NUMERIC(30,2) USING ROUND(old_balance_due_amount, 2),
  ALTER COLUMN new_line_subtotal_amount TYPE NUMERIC(30,2) USING ROUND(new_line_subtotal_amount, 2),
  ALTER COLUMN new_agreed_total_amount TYPE NUMERIC(30,2) USING ROUND(new_agreed_total_amount, 2),
  ALTER COLUMN new_deposit_due_amount TYPE NUMERIC(30,2) USING ROUND(new_deposit_due_amount, 2),
  ALTER COLUMN new_balance_due_amount TYPE NUMERIC(30,2) USING ROUND(new_balance_due_amount, 2);

ALTER TABLE packaging_cost_requests
  ALTER COLUMN amount TYPE NUMERIC(30,2) USING ROUND(amount, 2);

ALTER TABLE slh_reconciliation_settlements
  ALTER COLUMN sales_amount TYPE NUMERIC(30,2) USING ROUND(sales_amount, 2);

-- 3) 行金额以两位单价乘数量重算，再按有效明细汇总订单金额。
--    行小计、订单小计、定金/尾款在同一个事务内恢复到新的勾稽关系。
UPDATE sales_order_lines
SET standard_unit_price_amount = ROUND(standard_unit_price_amount, 2),
    actual_unit_price_amount = ROUND(actual_unit_price_amount, 2),
    line_total_amount = ROUND(actual_unit_price_amount, 2) * quantity;

UPDATE sales_orders o
SET line_subtotal_amount = COALESCE((
  SELECT SUM(l.line_total_amount)
  FROM sales_order_lines l
  WHERE l.sales_order_id = o.id AND l.removed_at IS NULL
), 0);

UPDATE sales_orders
SET agreed_total_amount = line_subtotal_amount,
    deposit_due_amount = LEAST(deposit_due_amount, line_subtotal_amount),
    balance_due_amount = line_subtotal_amount - LEAST(deposit_due_amount, line_subtotal_amount);

-- 付款状态是派生快照；整单金额收窄后重算一次，避免残留四位状态。
UPDATE sales_orders o
SET payment_status = CASE
  WHEN COALESCE((
    SELECT SUM(p.amount) FROM sales_order_payments p
    WHERE p.sales_order_id = o.id AND p.voided_at IS NULL
  ), 0) = 0 THEN 'UNPAID'::sales_order_payment_status
  WHEN COALESCE((
    SELECT SUM(p.amount) FROM sales_order_payments p
    WHERE p.sales_order_id = o.id AND p.voided_at IS NULL
  ), 0) < o.agreed_total_amount THEN 'PARTIALLY_PAID'::sales_order_payment_status
  ELSE 'PAID'::sales_order_payment_status
END;

-- 4) 金额变更历史不可变触发器在迁移窗口内临时关闭；只做两位收敛与勾稽重算。
ALTER TABLE sales_order_amount_revisions
  DISABLE TRIGGER sales_order_amount_revisions_immutable_trigger;

UPDATE sales_order_amount_revisions
SET old_agreed_total_amount = old_line_subtotal_amount,
    old_deposit_due_amount = LEAST(old_deposit_due_amount, old_line_subtotal_amount),
    old_balance_due_amount = old_line_subtotal_amount - LEAST(old_deposit_due_amount, old_line_subtotal_amount),
    new_agreed_total_amount = new_line_subtotal_amount,
    new_deposit_due_amount = LEAST(new_deposit_due_amount, new_line_subtotal_amount),
    new_balance_due_amount = new_line_subtotal_amount - LEAST(new_deposit_due_amount, new_line_subtotal_amount);

ALTER TABLE sales_order_amount_revisions
  ENABLE TRIGGER sales_order_amount_revisions_immutable_trigger;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sales_order_amount_revisions
    WHERE ROW(
      old_line_subtotal_amount, old_agreed_total_amount,
      old_deposit_due_amount, old_balance_due_amount
    ) IS NOT DISTINCT FROM ROW(
      new_line_subtotal_amount, new_agreed_total_amount,
      new_deposit_due_amount, new_balance_due_amount
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order amount revision becomes a no-op after two-decimal narrowing; clean the revision explicitly before migrating';
  END IF;
END $$;

-- 5) 收款审批的一致性触发器会重算人民币入账金额。金额收窄后若与历史
--    资金批次不再相等，迁移失败关闭，交由财务人工确认后再迁移。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sales_receipt_requests r
    JOIN sales_order_payments p ON p.id = r.approved_payment_id
    JOIN fund_posting_batches b ON b.id = p.fund_posting_batch_id
    WHERE r.status = 'APPROVED'
      AND b.business_amount <> ROUND(r.amount / p.foreign_units_per_cny_snapshot, 2)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'receipt posting business amount would change after two-decimal narrowing; reconcile the affected receipts first';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sales_orders o
    WHERE EXISTS (
      SELECT 1 FROM sales_receipt_requests r
      WHERE r.sales_order_id = o.id AND r.status = 'PENDING_REVIEW'
    )
    AND (
      o.order_status = 'CANCELLED'
      OR o.agreed_total_amount < (
        SELECT COALESCE(SUM(r.amount), 0)
        FROM sales_receipt_requests r
        WHERE r.sales_order_id = o.id AND r.status = 'PENDING_REVIEW'
      ) + (
        SELECT COALESCE(SUM(p.amount), 0)
        FROM sales_order_payments p
        WHERE p.sales_order_id = o.id AND p.voided_at IS NULL
      )
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'pending receipt reservation would exceed the two-decimal order total; reconcile the affected sales order first';
  END IF;
END $$;

-- 先把本事务内已排队的延迟触发器检查提前执行，避免后续 DDL 被 pending trigger events 阻塞。
SET CONSTRAINTS ALL IMMEDIATE;

-- 6) 恢复并收紧约束。
ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_amount_scales_check CHECK (
    scale(line_subtotal_amount) <= 2
    AND scale(agreed_total_amount) <= 2
    AND scale(deposit_due_amount) <= 2
    AND scale(balance_due_amount) <= 2
  ),
  ADD CONSTRAINT sales_orders_agreed_total_matches_lines_check
    CHECK (agreed_total_amount = line_subtotal_amount),
  ADD CONSTRAINT sales_orders_payment_terms_sum_check
    CHECK (agreed_total_amount = deposit_due_amount + balance_due_amount);

ALTER TABLE sales_order_lines
  ADD CONSTRAINT sales_order_lines_amount_scales_check CHECK (
    (standard_unit_price_amount IS NULL OR scale(standard_unit_price_amount) <= 2)
    AND scale(actual_unit_price_amount) <= 2
    AND scale(line_total_amount) <= 2
  );

ALTER TABLE sales_order_payments
  ADD CONSTRAINT sales_order_payments_amount_positive_check
    CHECK (amount > 0 AND scale(amount) <= 2);

ALTER TABLE sales_receipt_requests
  ADD CONSTRAINT sales_receipt_requests_amount_check
    CHECK (amount > 0 AND scale(amount) <= 2 AND currency_code IN ('TWD', 'MYR'));

ALTER TABLE sales_order_amount_revisions
  ADD CONSTRAINT sales_order_amount_revisions_old_sum_check
    CHECK (
      old_line_subtotal_amount = old_agreed_total_amount
      AND old_agreed_total_amount = old_deposit_due_amount + old_balance_due_amount
    ),
  ADD CONSTRAINT sales_order_amount_revisions_new_sum_check
    CHECK (
      new_line_subtotal_amount = new_agreed_total_amount
      AND new_agreed_total_amount = new_deposit_due_amount + new_balance_due_amount
    ),
  ADD CONSTRAINT sales_order_amount_revisions_changed_check
    CHECK (
      ROW(
        old_line_subtotal_amount, old_agreed_total_amount,
        old_deposit_due_amount, old_balance_due_amount
      ) IS DISTINCT FROM ROW(
        new_line_subtotal_amount, new_agreed_total_amount,
        new_deposit_due_amount, new_balance_due_amount
      )
    );

ALTER TABLE slh_reconciliation_settlements
  ADD CONSTRAINT slh_reconciliation_settlements_sales_scale_check
    CHECK (sales_amount IS NULL OR scale(sales_amount) <= 2);

-- 7) 触发器函数内的金额变量同步为两位口径。
CREATE OR REPLACE FUNCTION "enforce_sales_order_line_subtotal"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_order_id UUID;
  expected_subtotal NUMERIC(30, 2);
  actual_subtotal NUMERIC(30, 2);
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

CREATE OR REPLACE FUNCTION "enforce_sales_order_payment_summary"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_order_id UUID;
  agreed_total NUMERIC(30, 2);
  received_total NUMERIC(30, 2);
  current_status "sales_order_payment_status";
  expected_status "sales_order_payment_status";
BEGIN
  IF TG_TABLE_NAME = 'sales_orders' THEN
    target_order_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    target_order_id := OLD."sales_order_id";
  ELSE
    target_order_id := NEW."sales_order_id";
  END IF;

  SELECT "agreed_total_amount", "payment_status"
  INTO agreed_total, current_status
  FROM "sales_orders"
  WHERE "id" = target_order_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(sum("amount"), 0)
  INTO received_total
  FROM "sales_order_payments"
  WHERE "sales_order_id" = target_order_id
    AND "voided_at" IS NULL;

  IF received_total > agreed_total THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order received amount exceeds agreed total',
      CONSTRAINT = 'sales_order_payments_total_check';
  END IF;

  expected_status := CASE
    WHEN received_total = 0 THEN 'UNPAID'::"sales_order_payment_status"
    WHEN received_total < agreed_total
      THEN 'PARTIALLY_PAID'::"sales_order_payment_status"
    ELSE 'PAID'::"sales_order_payment_status"
  END;

  IF current_status <> expected_status THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order payment status does not match payments',
      CONSTRAINT = 'sales_orders_payment_status_summary_check';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "sales_orders_line_subtotal_trigger"
AFTER INSERT OR UPDATE OF "line_subtotal_amount" ON "sales_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_line_subtotal"();

CREATE CONSTRAINT TRIGGER "sales_orders_payment_summary_trigger"
AFTER INSERT OR UPDATE OF "agreed_total_amount", "payment_status" ON "sales_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_payment_summary"();

COMMIT;
