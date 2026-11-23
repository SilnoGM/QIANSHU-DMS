BEGIN;

-- 审核后修订采购金额允许在「定金已付、尾款未付」时继续调整尾款：
-- 定金已经产生不可变的资金事实，必须冻结；差额全部由尾款承担。
-- 定金应付仍然只允许在整单没有任何有效付款时修改。
CREATE OR REPLACE FUNCTION "enforce_purchase_payable_identity"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_row purchase_orders%ROWTYPE;
  issuer UUID;
  active_payment_count BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Purchase payables are immutable evidence' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payables_immutable_check';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- due_amount 是唯一受控可变字段；其余身份字段仍逐字节冻结。
    IF (to_jsonb(OLD) - ARRAY['closed_at','version','due_amount']) IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['closed_at','version','due_amount'])
      OR NEW.version <> OLD.version + 1 OR OLD.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Purchase payable identity cannot change' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payables_immutable_check';
    END IF;
    IF NEW.due_amount IS DISTINCT FROM OLD.due_amount THEN
      SELECT * INTO order_row FROM purchase_orders WHERE id = NEW.purchase_order_id FOR UPDATE;
      IF order_row.id IS NULL
        OR order_row.order_status NOT IN ('CONFIRMED','COMPLETED')
        OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
        RAISE EXCEPTION 'Purchase payable amount cannot change for this order state' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payables_immutable_check';
      END IF;
      IF NEW.payment_type = 'DEPOSIT' THEN
        -- 定金一旦有任何有效付款就不能再改约定金额，否则已付金额会超过应付金额。
        SELECT count(*) INTO active_payment_count
          FROM purchase_order_payments
          WHERE purchase_order_id = NEW.purchase_order_id AND voided_at IS NULL;
        IF active_payment_count <> 0 THEN
          RAISE EXCEPTION 'Paid deposit amount cannot change' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payables_immutable_check';
        END IF;
      ELSIF NEW.payment_type = 'BALANCE' THEN
        -- 定金已付时允许修订尾款：本阶段不能有付款，整单也不能出现非定金付款。
        SELECT count(*) INTO active_payment_count
          FROM purchase_order_payments
          WHERE payable_id = NEW.id AND voided_at IS NULL;
        IF active_payment_count <> 0 THEN
          RAISE EXCEPTION 'Paid balance amount cannot change' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payables_immutable_check';
        END IF;
        SELECT count(*) INTO active_payment_count
          FROM purchase_order_payments
          WHERE purchase_order_id = NEW.purchase_order_id AND voided_at IS NULL AND payment_type <> 'DEPOSIT';
        IF active_payment_count <> 0 THEN
          RAISE EXCEPTION 'Purchase payable amount can only change when only deposit is paid' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payables_immutable_check';
        END IF;
      ELSE
        RAISE EXCEPTION 'Unknown purchase payable stage' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payables_immutable_check';
      END IF;
    END IF;
  ELSE
    SELECT * INTO order_row FROM purchase_orders WHERE id = NEW.purchase_order_id FOR UPDATE;
    SELECT issuer_user_id INTO issuer FROM sales_orders WHERE id = order_row.sales_order_id;
    IF order_row.id IS NULL OR order_row.order_status <> 'CONFIRMED' OR NEW.closed_at IS NOT NULL OR NEW.version <> 1
      OR NEW.due_amount IS DISTINCT FROM (CASE WHEN NEW.payment_type = 'DEPOSIT' THEN order_row.deposit_due_amount ELSE order_row.balance_due_amount END)
      OR (order_row.purchase_type = 'STOCK' AND (NEW.account_owner_type <> 'COMPANY' OR NEW.owner_user_id IS NOT NULL))
      OR (order_row.purchase_type = 'SALES_LINKED' AND (NEW.account_owner_type <> 'USER' OR NEW.owner_user_id IS DISTINCT FROM issuer)) THEN
      RAISE EXCEPTION 'Purchase payable must freeze reviewed order identity' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payables_identity_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- MigrationSelfCheck
DO $$
DECLARE
  function_source text;
BEGIN
  SELECT pg_get_functiondef(procedure_entry.oid)
  INTO function_source
  FROM pg_proc AS procedure_entry
  JOIN pg_namespace AS namespace_entry ON namespace_entry.oid = procedure_entry.pronamespace
  WHERE namespace_entry.nspname = current_schema()
    AND procedure_entry.proname = 'enforce_purchase_payable_identity';

  IF function_source IS NULL
    OR position('Paid deposit amount cannot change' IN function_source) = 0
    OR position('only deposit is paid' IN function_source) = 0
    OR position('active_payment_count' IN function_source) = 0 THEN
    RAISE EXCEPTION 'purchase payable revision migration invariant mismatch: trigger function';
  END IF;
END;
$$;

COMMIT;
