BEGIN;

-- 仅从本次审核生成应付；历史采购付款保留原事实，不推测分摊，也不补扣资金。
CREATE TABLE purchase_order_payables (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL,
  payment_type purchase_order_payment_type NOT NULL,
  due_amount DECIMAL(30,2) NOT NULL,
  account_owner_type fund_account_owner_type NOT NULL,
  owner_user_id UUID,
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ(6),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT purchase_order_payables_pkey PRIMARY KEY(id),
  CONSTRAINT purchase_order_payables_purchase_order_id_fkey FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT purchase_order_payables_owner_user_id_fkey FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT purchase_order_payables_created_by_user_id_fkey FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT purchase_order_payables_shape_check CHECK (payment_type IN ('DEPOSIT','BALANCE') AND due_amount >= 0 AND due_amount < 'Infinity'::numeric AND version > 0
    AND ((account_owner_type = 'USER' AND owner_user_id IS NOT NULL) OR (account_owner_type = 'COMPANY' AND owner_user_id IS NULL)))
);
CREATE UNIQUE INDEX purchase_order_payables_order_type_key ON purchase_order_payables(purchase_order_id, payment_type);

ALTER TABLE purchase_order_payments
  ADD COLUMN payable_id UUID,
  ADD COLUMN fund_posting_batch_id UUID,
  ADD COLUMN fund_reversal_batch_id UUID,
  ADD COLUMN idempotency_key_hash BYTEA,
  ADD COLUMN request_fingerprint_hash BYTEA,
  ADD CONSTRAINT purchase_order_payments_payable_id_fkey FOREIGN KEY(payable_id) REFERENCES purchase_order_payables(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT purchase_order_payments_fund_posting_batch_id_fkey FOREIGN KEY(fund_posting_batch_id) REFERENCES fund_posting_batches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT purchase_order_payments_fund_reversal_batch_id_fkey FOREIGN KEY(fund_reversal_batch_id) REFERENCES fund_posting_batches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT purchase_order_payments_posting_shape_check CHECK (
    (payable_id IS NULL AND fund_posting_batch_id IS NULL AND fund_reversal_batch_id IS NULL AND idempotency_key_hash IS NULL AND request_fingerprint_hash IS NULL)
    OR (payable_id IS NOT NULL AND fund_posting_batch_id IS NOT NULL AND idempotency_key_hash IS NOT NULL AND request_fingerprint_hash IS NOT NULL
      AND octet_length(idempotency_key_hash) = 32 AND octet_length(request_fingerprint_hash) = 32
      AND ((voided_at IS NULL AND fund_reversal_batch_id IS NULL) OR (voided_at IS NOT NULL AND fund_reversal_batch_id IS NOT NULL)))
  );
CREATE UNIQUE INDEX purchase_order_payments_posting_batch_key ON purchase_order_payments(fund_posting_batch_id);
CREATE UNIQUE INDEX purchase_order_payments_reversal_batch_key ON purchase_order_payments(fund_reversal_batch_id);
CREATE UNIQUE INDEX purchase_order_payments_idempotency_key ON purchase_order_payments(idempotency_key_hash);

CREATE FUNCTION enforce_purchase_payable_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE order_row purchase_orders%ROWTYPE; issuer UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Purchase payables are immutable evidence' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payables_immutable_check';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD) - ARRAY['closed_at','version']) IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['closed_at','version'])
      OR NEW.version <> OLD.version + 1 OR OLD.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Purchase payable identity cannot change' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payables_immutable_check';
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
CREATE TRIGGER purchase_order_payables_identity_trigger BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_payables
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_payable_identity();

CREATE FUNCTION enforce_purchase_payable_payment_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.payable_id IS NULL THEN
      RAISE EXCEPTION 'New purchase payments require a payable and fund posting' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payments_payable_required_check';
    END IF;
  ELSE
    IF TG_OP = 'DELETE' OR OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
      OR (to_jsonb(OLD) - ARRAY['voided_at','voided_by_user_id','void_reason','fund_reversal_batch_id']) IS DISTINCT FROM
         (to_jsonb(NEW) - ARRAY['voided_at','voided_by_user_id','void_reason','fund_reversal_batch_id']) THEN
      RAISE EXCEPTION 'Purchase payment facts can only be voided once' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_payments_immutable_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_order_payments_identity_trigger BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_payments
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_payable_payment_identity();

-- 所有跨域断言都在事务末读取最终状态；审核、应付、实付、资金及审计可以原子落库。
CREATE FUNCTION enforce_purchase_payable_consistency() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE order_id UUID; target_batch_id UUID; target_batch fund_posting_batches%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME IN ('fund_posting_batches','fund_ledger_entries') THEN
    IF TG_TABLE_NAME = 'fund_posting_batches' THEN target_batch_id := NEW.id; ELSE target_batch_id := NEW.batch_id; END IF;
    SELECT * INTO target_batch FROM fund_posting_batches WHERE id = target_batch_id;
    IF target_batch.business_source_code_snapshot IS DISTINCT FROM 'PURCHASE_PAYMENT'
      AND NOT EXISTS (SELECT 1 FROM fund_posting_batches b WHERE b.id = target_batch.reversal_of_batch_id AND b.business_source_code_snapshot = 'PURCHASE_PAYMENT') THEN RETURN NEW; END IF;
    SELECT p.purchase_order_id INTO order_id FROM purchase_order_payments p
      WHERE p.id::text = target_batch.business_id AND p.payable_id IS NOT NULL
        AND ((target_batch.kind = 'BUSINESS' AND p.fund_posting_batch_id = target_batch.id)
          OR (target_batch.kind = 'REVERSAL' AND p.fund_reversal_batch_id = target_batch.id AND p.voided_at IS NOT NULL));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase fund posting requires its payment association' USING ERRCODE = '23514', CONSTRAINT = 'purchase_payable_posting_consistency_check';
    END IF;
  ELSIF TG_TABLE_NAME = 'purchase_orders' THEN
    order_id := NEW.id;
    IF OLD.order_status = 'PENDING_REVIEW' AND NEW.order_status = 'CONFIRMED'
      AND (SELECT count(*) FROM purchase_order_payables WHERE purchase_order_id = order_id) <> 2 THEN
      RAISE EXCEPTION 'Purchase review requires deposit and balance payables' USING ERRCODE = '23514', CONSTRAINT = 'purchase_payable_review_consistency_check';
    END IF;
  ELSE order_id := NEW.purchase_order_id;
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_order_payables WHERE purchase_order_id = order_id) AND (
    (SELECT count(*) FROM purchase_order_payables WHERE purchase_order_id = order_id) <> 2
    OR EXISTS (SELECT 1 FROM purchase_order_payables q JOIN purchase_orders o ON o.id = q.purchase_order_id WHERE o.id = order_id AND (
      q.due_amount <> CASE WHEN q.payment_type = 'DEPOSIT' THEN o.deposit_due_amount ELSE o.balance_due_amount END
      OR o.order_status = 'PENDING_REVIEW' OR (q.closed_at IS NOT NULL) <> (o.order_status = 'CANCELLED')
      OR COALESCE((SELECT sum(p.amount) FROM purchase_order_payments p WHERE p.payable_id = q.id AND p.voided_at IS NULL),0) > q.due_amount
      OR (o.order_status = 'CANCELLED' AND EXISTS (SELECT 1 FROM purchase_order_payments p WHERE p.payable_id = q.id AND p.voided_at IS NULL))
    ))
    OR (SELECT count(DISTINCT (account_owner_type, owner_user_id)) FROM purchase_order_payables WHERE purchase_order_id = order_id) <> 1
  ) THEN
    RAISE EXCEPTION 'Purchase payable stages must match the reviewed order' USING ERRCODE = '23514', CONSTRAINT = 'purchase_payable_order_consistency_check';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_order_payments p
    LEFT JOIN purchase_order_payables q ON q.id = p.payable_id
    LEFT JOIN fund_posting_batches b ON b.id = p.fund_posting_batch_id
    WHERE p.purchase_order_id = order_id AND p.payable_id IS NOT NULL AND (
      q.id IS NULL OR q.purchase_order_id <> p.purchase_order_id OR q.payment_type <> p.payment_type
      OR b.id IS NULL OR b.kind <> 'BUSINESS' OR b.business_source_code_snapshot <> 'PURCHASE_PAYMENT'
      OR b.posting_type_code_snapshot <> 'PURCHASE_PAYMENT' OR b.business_category_snapshot <> 'COST'
      OR b.business_id <> p.id::text OR b.business_amount <> p.amount OR b.currency <> 'CNY'
      OR b.user_id IS DISTINCT FROM q.owner_user_id OR b.actor_user_id IS DISTINCT FROM p.created_by_user_id
      OR (q.account_owner_type = 'USER' AND b.consumer_code <> 'PURCHASE_PAYMENT.PAY')
      OR (q.account_owner_type = 'COMPANY' AND (b.consumer_code <> 'PURCHASE_PAYMENT.STOCK_PAY'
        OR (SELECT count(*) FROM fund_ledger_entries e WHERE e.batch_id = b.id) <> 1
        OR NOT EXISTS (SELECT 1 FROM fund_ledger_entries e WHERE e.batch_id = b.id AND e.account_target = 'COMPANY' AND e.amount_strategy = 'COMPANY_REMAINDER' AND e.amount = p.amount)))
      OR COALESCE((SELECT sum(e.amount) FROM fund_ledger_entries e WHERE e.batch_id = b.id),0) <> p.amount
      OR (SELECT count(*) FROM fund_ledger_entries e WHERE e.batch_id = b.id) <> (SELECT count(DISTINCT e.account_target) FROM fund_ledger_entries e WHERE e.batch_id = b.id)
      OR EXISTS (SELECT 1 FROM fund_ledger_entries e JOIN fund_accounts account ON account.id = e.account_id WHERE e.batch_id = b.id AND (
        e.direction <> 'DEBIT'
        OR (e.account_target = 'USER' AND (account.owner_type <> 'USER' OR account.user_id IS DISTINCT FROM q.owner_user_id))
        OR (e.account_target = 'COMPANY' AND (account.owner_type <> 'COMPANY' OR account.user_id IS NOT NULL))))
      OR (p.voided_at IS NULL AND EXISTS (SELECT 1 FROM fund_posting_batches r WHERE r.reversal_of_batch_id = b.id))
    )
  ) THEN
    RAISE EXCEPTION 'Purchase payment and fund posting must match' USING ERRCODE = '23514', CONSTRAINT = 'purchase_payable_posting_consistency_check';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_order_payments p JOIN fund_posting_batches b ON b.id = p.fund_posting_batch_id
    LEFT JOIN fund_posting_batches r ON r.id = p.fund_reversal_batch_id
    WHERE p.purchase_order_id = order_id AND p.payable_id IS NOT NULL AND p.voided_at IS NOT NULL AND (
      r.id IS NULL OR r.kind <> 'REVERSAL' OR r.reversal_of_batch_id <> b.id OR r.business_amount <> -b.business_amount
      OR r.consumer_code <> 'PURCHASE_PAYMENT.VOID' OR r.business_source_id <> b.business_source_id OR r.business_source_code_snapshot <> 'PURCHASE_PAYMENT'
      OR r.posting_type_id <> b.posting_type_id OR r.posting_type_code_snapshot <> b.posting_type_code_snapshot
      OR r.rule_version_id <> b.rule_version_id OR r.rule_revision_snapshot <> b.rule_revision_snapshot
      OR r.user_id IS DISTINCT FROM b.user_id OR r.currency <> b.currency OR r.business_id <> b.business_id OR r.business_category_snapshot <> b.business_category_snapshot
      OR r.user_share_rate_snapshot IS DISTINCT FROM b.user_share_rate_snapshot OR r.company_share_rate_snapshot IS DISTINCT FROM b.company_share_rate_snapshot
      OR r.actor_user_id IS DISTINCT FROM p.voided_by_user_id OR r.reversal_reason IS DISTINCT FROM p.void_reason
      OR (SELECT count(*) FROM fund_posting_batches reversal WHERE reversal.reversal_of_batch_id = b.id) <> 1
      OR (SELECT count(*) FROM fund_ledger_entries e WHERE e.batch_id = b.id) <> (SELECT count(*) FROM fund_ledger_entries e WHERE e.batch_id = r.id)
      OR COALESCE((SELECT sum(e.amount) FROM fund_ledger_entries e WHERE e.batch_id = r.id),0) <> b.business_amount
      OR EXISTS (SELECT 1 FROM fund_ledger_entries e WHERE e.batch_id = b.id AND NOT EXISTS (
        SELECT 1 FROM fund_ledger_entries re WHERE re.batch_id = r.id AND re.account_id = e.account_id AND re.account_target = e.account_target
          AND re.amount_strategy = e.amount_strategy AND re.amount = e.amount AND re.direction <> e.direction))
      OR EXISTS (SELECT 1 FROM fund_ledger_entries re WHERE re.batch_id = r.id AND NOT EXISTS (
        SELECT 1 FROM fund_ledger_entries e WHERE e.batch_id = b.id AND e.account_id = re.account_id AND e.account_target = re.account_target
          AND e.amount_strategy = re.amount_strategy AND e.amount = re.amount AND e.direction <> re.direction))
    )
  ) THEN
    RAISE EXCEPTION 'Purchase payment void requires exact original reversal' USING ERRCODE = '23514', CONSTRAINT = 'purchase_payable_reversal_consistency_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER purchase_order_payables_consistency_trigger AFTER INSERT OR UPDATE ON purchase_order_payables DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_purchase_payable_consistency();
CREATE CONSTRAINT TRIGGER purchase_order_payments_payable_consistency_trigger AFTER INSERT OR UPDATE ON purchase_order_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_purchase_payable_consistency();
CREATE CONSTRAINT TRIGGER purchase_orders_payable_consistency_trigger AFTER UPDATE ON purchase_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_purchase_payable_consistency();
CREATE CONSTRAINT TRIGGER fund_posting_batches_purchase_consistency_trigger AFTER INSERT ON fund_posting_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_purchase_payable_consistency();
CREATE CONSTRAINT TRIGGER fund_ledger_entries_purchase_consistency_trigger AFTER INSERT ON fund_ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_purchase_payable_consistency();

COMMIT;
