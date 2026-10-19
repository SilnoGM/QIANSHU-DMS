BEGIN;

-- 汇率统一四位小数；全流程金流费率单独三位小数。
-- 先做失败关闭检查：收款审批的人民币入账金额若会因汇率收窄而变化，
-- 不允许迁移静默改写历史资金事实。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM slh_reconciliation_settlements
    WHERE payment_fee_rate > 0 AND ROUND(payment_fee_rate, 3) = 0
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'payment fee rate would round to zero at three decimals';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sales_receipt_requests r
    JOIN sales_order_payments p ON p.id = r.approved_payment_id
    JOIN fund_posting_batches b ON b.id = p.fund_posting_batch_id
    WHERE r.status = 'APPROVED'
      AND b.business_amount <> ROUND(r.amount / ROUND(p.foreign_units_per_cny_snapshot, 4), 2)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'receipt posting business amount would change after four-decimal rate narrowing; reconcile the affected receipts first';
  END IF;
END $$;

ALTER TABLE exchange_rates
  ALTER COLUMN foreign_units_per_cny TYPE NUMERIC(30,4)
    USING ROUND(foreign_units_per_cny, 4);

ALTER TABLE sales_order_payments
  ALTER COLUMN foreign_units_per_cny_snapshot TYPE NUMERIC(30,4)
    USING ROUND(foreign_units_per_cny_snapshot, 4);

ALTER TABLE slh_bills
  ALTER COLUMN foreign_units_per_cny_snapshot TYPE NUMERIC(30,4)
    USING ROUND(foreign_units_per_cny_snapshot, 4),
  ALTER COLUMN embedded_foreign_units_per_cny TYPE NUMERIC(30,4)
    USING ROUND(embedded_foreign_units_per_cny, 4);

ALTER TABLE slh_reconciliation_settlements
  ALTER COLUMN foreign_units_per_cny TYPE NUMERIC(30,4)
    USING ROUND(foreign_units_per_cny, 4),
  ALTER COLUMN payment_fee_rate TYPE NUMERIC(30,3)
    USING ROUND(payment_fee_rate, 3);

ALTER TABLE invoice_requests
  ALTER COLUMN foreign_units_per_cny_snapshot TYPE NUMERIC(30,4)
    USING ROUND(foreign_units_per_cny_snapshot, 4);

-- 汇率形状约束要求内嵌汇率与快照完全一致；两者按同一规则收敛后重新校验。
ALTER TABLE slh_bills
  ADD CONSTRAINT slh_bills_rate_scale_check CHECK (
    (foreign_units_per_cny_snapshot IS NULL OR scale(foreign_units_per_cny_snapshot) <= 4)
    AND (embedded_foreign_units_per_cny IS NULL OR scale(embedded_foreign_units_per_cny) <= 4)
  );

ALTER TABLE exchange_rates
  ADD CONSTRAINT exchange_rates_rate_scale_check CHECK (scale(foreign_units_per_cny) <= 4);

ALTER TABLE sales_order_payments
  ADD CONSTRAINT sales_order_payments_rate_scale_check CHECK (
    foreign_units_per_cny_snapshot IS NULL OR scale(foreign_units_per_cny_snapshot) <= 4
  );

ALTER TABLE slh_reconciliation_settlements
  ADD CONSTRAINT slh_reconciliation_settlements_rate_scale_check CHECK (
    scale(foreign_units_per_cny) <= 4 AND scale(payment_fee_rate) <= 3
  );

ALTER TABLE invoice_requests
  ADD CONSTRAINT invoice_requests_rate_scale_check CHECK (
    foreign_units_per_cny_snapshot IS NULL OR scale(foreign_units_per_cny_snapshot) <= 4
  );

COMMIT;
