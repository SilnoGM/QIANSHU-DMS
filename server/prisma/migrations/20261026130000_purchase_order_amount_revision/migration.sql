BEGIN;

-- 审核后金额修订：新增审计事件，并允许应付 due_amount 在严格条件下受控更新。
-- 旧值已由不可变的 purchase_order_amount_revisions 快照保存，不新增表。
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_AMOUNT_REVISED';

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
      -- 只允许已确认/已完成、无有效付款且未关闭的采购单修订金额；旧金额
      -- 保存在 purchase_order_amount_revisions，不能借本通道改写其他证据。
      SELECT * INTO order_row FROM purchase_orders WHERE id = NEW.purchase_order_id FOR UPDATE;
      SELECT count(*) INTO active_payment_count
        FROM purchase_order_payments
        WHERE purchase_order_id = NEW.purchase_order_id AND voided_at IS NULL;
      IF order_row.id IS NULL
        OR order_row.order_status NOT IN ('CONFIRMED','COMPLETED')
        OR active_payment_count <> 0
        OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
        RAISE EXCEPTION 'Purchase payable amount can only change before payment' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payables_immutable_check';
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

COMMIT;
