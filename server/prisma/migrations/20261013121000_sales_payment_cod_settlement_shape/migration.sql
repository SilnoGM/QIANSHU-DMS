BEGIN;

SET LOCAL lock_timeout = '5s';

-- 代收回填收款的形状与新溯源列。
-- 每笔回填收款唯一锚定一条结算记录；结算记录可被取代，但回填只发生在完成批次（该批次随后锁定），
-- 因此锚点在本期语义下是稳定的。其他来源不得占用该列。
ALTER TABLE "sales_order_payments"
  ADD COLUMN "slh_reconciliation_settlement_id" UUID;

CREATE UNIQUE INDEX "sales_order_payments_reconciliation_settlement_key"
  ON "sales_order_payments"("slh_reconciliation_settlement_id");

ALTER TABLE "sales_order_payments"
  ADD CONSTRAINT "sales_order_payments_reconciliation_settlement_id_fkey"
  FOREIGN KEY ("slh_reconciliation_settlement_id") REFERENCES "slh_reconciliation_settlements"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 形状约束扩为三分支：新增 COD_SETTLEMENT——必须挂结算记录、收款方式固定为受控字典值、
-- 不得有汇率快照（回填是台币 1:1，不经汇率）、资金批次可空（结算金额为零的行没有入账批次）、
-- 本期不提供作废入口（作废列必须全空）；其余两种来源不得挂结算记录。
ALTER TABLE "sales_order_payments"
  DROP CONSTRAINT "sales_order_payments_posting_shape_check";

ALTER TABLE "sales_order_payments" ADD CONSTRAINT "sales_order_payments_posting_shape_check" CHECK (
  (origin = 'LEGACY' AND fund_posting_batch_id IS NULL AND fund_reversal_batch_id IS NULL AND exchange_rate_id IS NULL AND exchange_rate_version_snapshot IS NULL AND foreign_units_per_cny_snapshot IS NULL AND exchange_rate_captured_at IS NULL AND slh_reconciliation_settlement_id IS NULL)
  OR (origin = 'REVIEWED' AND fund_posting_batch_id IS NOT NULL AND exchange_rate_id IS NOT NULL AND exchange_rate_version_snapshot IS NOT NULL AND exchange_rate_version_snapshot > 0 AND foreign_units_per_cny_snapshot IS NOT NULL AND foreign_units_per_cny_snapshot > 0 AND exchange_rate_captured_at IS NOT NULL AND slh_reconciliation_settlement_id IS NULL
    AND ((voided_at IS NULL AND fund_reversal_batch_id IS NULL) OR (voided_at IS NOT NULL AND fund_reversal_batch_id IS NOT NULL)))
  OR (origin = 'COD_SETTLEMENT' AND payment_method = 'BILL_COD_SETTLEMENT' AND exchange_rate_id IS NULL AND exchange_rate_version_snapshot IS NULL AND foreign_units_per_cny_snapshot IS NULL AND exchange_rate_captured_at IS NULL AND fund_reversal_batch_id IS NULL AND voided_at IS NULL AND voided_by_user_id IS NULL AND void_reason IS NULL AND slh_reconciliation_settlement_id IS NOT NULL)
);

-- 新收款插入准入：财务审核收款（REVIEWED）与代收回填收款（COD_SETTLEMENT）之外的来源一律拒绝。
CREATE OR REPLACE FUNCTION "enforce_reviewed_sales_payment_insert"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origin NOT IN ('REVIEWED', 'COD_SETTLEMENT') THEN
    RAISE EXCEPTION 'New receipts require financial review or reconciliation write-back' USING ERRCODE = '23514', CONSTRAINT = 'sales_order_payments_review_required_check';
  END IF;
  RETURN NEW;
END;
$$;

-- 回填收款方式：只补缺失的受控字典值，已有标签、排序与启停选择原样保留。
DO $$
DECLARE type_id UUID; created_type BOOLEAN := false;
BEGIN
  SELECT id INTO type_id FROM dictionary_types WHERE code = 'payment.method';
  IF NOT FOUND THEN
    INSERT INTO dictionary_types(id,code,name,enabled) VALUES (gen_random_uuid(),'payment.method','付款方式',false) RETURNING id INTO type_id;
    created_type := true;
  END IF;
  INSERT INTO dictionary_items(id,dictionary_type_id,value,label,enabled,sort_order)
  SELECT gen_random_uuid(),type_id,'BILL_COD_SETTLEMENT','账单代收结算',true,50
  ON CONFLICT (dictionary_type_id,value) DO NOTHING;
  IF created_type THEN UPDATE dictionary_types SET enabled = true WHERE id = type_id; END IF;
END $$;

-- 数据不变量：新列与枚举值在本迁移前不应有数据；字典值必须存在且启用。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "sales_order_payments" WHERE "origin" = 'COD_SETTLEMENT') THEN
    RAISE EXCEPTION 'sales payment migration invariant mismatch: unexpected cod settlement rows';
  END IF;

  IF EXISTS (SELECT 1 FROM "sales_order_payments" WHERE "slh_reconciliation_settlement_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'sales payment migration invariant mismatch: settlement anchor must start empty';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "dictionary_items" AS item
    INNER JOIN "dictionary_types" AS type ON type."id" = item."dictionary_type_id"
    WHERE type."code" = 'payment.method'
      AND item."value" = 'BILL_COD_SETTLEMENT'
      AND item."enabled"
  ) THEN
    RAISE EXCEPTION 'sales payment migration invariant mismatch: cod settlement payment method';
  END IF;
END $$;

COMMIT;
