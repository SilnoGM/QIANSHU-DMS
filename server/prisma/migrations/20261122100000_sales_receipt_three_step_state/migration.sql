BEGIN;

-- 表外收款三步流转的状态证据：发送水单与确认收到的处理人和时间。
-- 入账（第三步）继续复用 reviewed_*，历史 APPROVED 行保持 version = 2 且新列为 NULL。
ALTER TABLE "sales_receipt_requests"
  ADD COLUMN "voucher_sent_by_user_id" UUID,
  ADD COLUMN "voucher_sent_at" TIMESTAMPTZ(6),
  ADD COLUMN "confirmed_by_user_id" UUID,
  ADD COLUMN "confirmed_at" TIMESTAMPTZ(6);

ALTER TABLE "sales_receipt_requests"
  ADD CONSTRAINT "sales_receipt_requests_voucher_sent_by_user_id_fkey"
    FOREIGN KEY ("voucher_sent_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "sales_receipt_requests_confirmed_by_user_id_fkey"
    FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 每个在途状态都要求前一步的证据齐全；终态只校验与业务事实一致。
-- APPROVED 的 version 允许 2（历史一次性审核）或 4（新三步流转），不迁移历史行。
ALTER TABLE "sales_receipt_requests" DROP CONSTRAINT "sales_receipt_requests_state_check";
ALTER TABLE "sales_receipt_requests"
  ADD CONSTRAINT "sales_receipt_requests_state_check" CHECK (
    (status = 'PENDING_REVIEW' AND voucher_sent_by_user_id IS NULL AND voucher_sent_at IS NULL AND confirmed_by_user_id IS NULL AND confirmed_at IS NULL AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND review_remark IS NULL AND approved_payment_id IS NULL AND version = 1)
    OR (status = 'PENDING_CONFIRM' AND voucher_sent_by_user_id IS NOT NULL AND voucher_sent_at IS NOT NULL AND confirmed_by_user_id IS NULL AND confirmed_at IS NULL AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND review_remark IS NULL AND approved_payment_id IS NULL AND version = 2)
    OR (status = 'PENDING_POSTING' AND voucher_sent_by_user_id IS NOT NULL AND voucher_sent_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND review_remark IS NULL AND approved_payment_id IS NULL AND version = 3)
    OR (status = 'REJECTED' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_remark IS NOT NULL AND length(btrim(review_remark)) > 0 AND approved_payment_id IS NULL AND version BETWEEN 2 AND 4)
    OR (status = 'APPROVED' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND approved_payment_id IS NOT NULL AND version IN (2, 4))
  );

-- 时间证据必须与状态顺序一致；历史行的新列为 NULL，自动通过。
ALTER TABLE "sales_receipt_requests" DROP CONSTRAINT "sales_receipt_requests_time_check";
ALTER TABLE "sales_receipt_requests"
  ADD CONSTRAINT "sales_receipt_requests_time_check" CHECK (
    received_at <= submitted_at
    AND (voucher_sent_at IS NULL OR voucher_sent_at >= submitted_at)
    AND (confirmed_at IS NULL OR (voucher_sent_at IS NOT NULL AND confirmed_at >= voucher_sent_at))
    AND (reviewed_at IS NULL OR reviewed_at >= submitted_at)
    AND (reviewed_at IS NULL OR confirmed_at IS NULL OR reviewed_at >= confirmed_at)
  );

-- 状态只允许沿流水线前进一步或驳回；version 必须逐次递增，禁止一次事务跳过中间态。
CREATE OR REPLACE FUNCTION "enforce_sales_receipt_request_invariants"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE order_row sales_orders%ROWTYPE; parent_row sales_receipt_requests%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Receipt request evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_immutable_check';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- 先判证据是否被越权改写，再判版本与状态推进，保证错误码指向真正的违规动作。
    IF (to_jsonb(OLD) - ARRAY['status','voucher_sent_by_user_id','voucher_sent_at','confirmed_by_user_id','confirmed_at','reviewed_by_user_id','reviewed_at','review_remark','approved_payment_id','version','updated_at']) IS DISTINCT FROM
       (to_jsonb(NEW) - ARRAY['status','voucher_sent_by_user_id','voucher_sent_at','confirmed_by_user_id','confirmed_at','reviewed_by_user_id','reviewed_at','review_remark','approved_payment_id','version','updated_at']) THEN
      RAISE EXCEPTION 'Receipt request evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_immutable_check';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Receipt request version must advance by one' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_version_check';
    END IF;
    IF NOT (
      (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('PENDING_CONFIRM', 'REJECTED'))
      OR (OLD.status = 'PENDING_CONFIRM' AND NEW.status IN ('PENDING_POSTING', 'REJECTED'))
      OR (OLD.status = 'PENDING_POSTING' AND NEW.status IN ('APPROVED', 'REJECTED'))
    ) THEN
      RAISE EXCEPTION 'Receipt request status transition is not allowed' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_transition_check';
    END IF;
  ELSE
    SELECT * INTO order_row FROM sales_orders WHERE id = NEW.sales_order_id FOR UPDATE;
    IF NEW.status <> 'PENDING_REVIEW' OR NEW.account_owner_user_id IS DISTINCT FROM order_row.issuer_user_id OR NEW.currency_code IS DISTINCT FROM order_row.currency_code THEN
      RAISE EXCEPTION 'Receipt request must freeze its order identity' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_order_identity_check';
    END IF;
    IF NEW.resubmitted_from_id IS NOT NULL THEN
      SELECT * INTO parent_row FROM sales_receipt_requests WHERE id = NEW.resubmitted_from_id;
      IF NOT FOUND OR parent_row.status <> 'REJECTED' OR parent_row.sales_order_id <> NEW.sales_order_id THEN
        RAISE EXCEPTION 'Receipt resubmission requires a rejected request in the same order' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_resubmission_check';
      END IF;
      IF EXISTS (SELECT 1 FROM sales_receipt_requests r WHERE r.voucher_media_asset_id = NEW.voucher_media_asset_id)
        AND parent_row.voucher_media_asset_id <> NEW.voucher_media_asset_id THEN
        RAISE EXCEPTION 'Receipt voucher belongs to an unrelated request' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_voucher_reuse_check';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 额度与取消资格同样扩展为三步在途状态：只统计 PENDING_REVIEW 会让已发群或已确认到账的
-- 收款脱离订单占用，数据库层失去最后一道保护。
CREATE OR REPLACE FUNCTION "enforce_sales_receipt_consistency"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE order_id UUID; invalid BOOLEAN; target_batch_id UUID; target_batch fund_posting_batches%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME IN ('fund_posting_batches', 'fund_ledger_entries') THEN
    IF TG_TABLE_NAME = 'fund_posting_batches' THEN target_batch_id := NEW.id; ELSE target_batch_id := NEW.batch_id; END IF;
    SELECT * INTO target_batch FROM fund_posting_batches WHERE id = target_batch_id;
    -- 非收款来源仍走原资金规则；伪造其他来源冲正收款批次也必须进入本域校验。
    IF target_batch.business_source_code_snapshot <> 'SALES_RECEIPT'
      AND NOT EXISTS (SELECT 1 FROM fund_posting_batches original WHERE original.id = target_batch.reversal_of_batch_id AND original.business_source_code_snapshot = 'SALES_RECEIPT') THEN
      RETURN NEW;
    END IF;
    SELECT r.sales_order_id INTO order_id
    FROM sales_receipt_requests r JOIN sales_order_payments p ON p.id = r.approved_payment_id
    WHERE r.id::text = target_batch.business_id AND r.status = 'APPROVED' AND p.origin = 'REVIEWED'
      AND ((target_batch.kind = 'BUSINESS' AND p.fund_posting_batch_id = target_batch.id)
        OR (target_batch.kind = 'REVERSAL' AND p.fund_reversal_batch_id = target_batch.id AND p.voided_at IS NOT NULL));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Receipt fund posting requires its approved payment association' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_posting_consistency_check';
    END IF;
  ELSIF TG_TABLE_NAME = 'sales_orders' THEN order_id := NEW.id;
  ELSE order_id := NEW.sales_order_id;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM sales_receipt_requests r
    LEFT JOIN sales_order_payments p ON p.id = r.approved_payment_id
    LEFT JOIN fund_posting_batches b ON b.id = p.fund_posting_batch_id
    LEFT JOIN exchange_rates rate ON rate.id = p.exchange_rate_id
    LEFT JOIN currencies currency ON currency.id = rate.currency_id
    WHERE r.sales_order_id = order_id AND r.status = 'APPROVED' AND (
      p.id IS NULL OR p.origin <> 'REVIEWED' OR p.sales_order_id <> r.sales_order_id
      OR p.amount <> r.amount OR p.payment_type <> r.payment_type OR p.received_at <> r.received_at
      OR p.payment_method IS DISTINCT FROM r.payment_method OR p.remark IS DISTINCT FROM r.remark
      OR b.id IS NULL OR b.kind <> 'BUSINESS' OR b.business_source_code_snapshot <> 'SALES_RECEIPT'
      OR b.posting_type_code_snapshot <> 'ORDER_SETTLEMENT' OR b.consumer_code <> 'SALES_RECEIPT.APPROVE'
      OR b.business_id <> r.id::text OR b.user_id IS DISTINCT FROM r.account_owner_user_id
      OR b.actor_user_id IS DISTINCT FROM r.reviewed_by_user_id OR p.created_by_user_id <> r.reviewed_by_user_id
      OR currency.code IS DISTINCT FROM r.currency_code OR b.business_amount <> round(r.amount / p.foreign_units_per_cny_snapshot, 2)
      OR b.business_category_snapshot <> 'REVENUE' OR b.business_amount <= 0
      OR COALESCE((SELECT sum(e.amount) FROM fund_ledger_entries e WHERE e.batch_id = b.id), 0) <> b.business_amount
      OR (SELECT count(*) FROM fund_ledger_entries e WHERE e.batch_id = b.id) <> (SELECT count(DISTINCT e.account_id) FROM fund_ledger_entries e WHERE e.batch_id = b.id)
      OR (SELECT count(*) FROM fund_ledger_entries e WHERE e.batch_id = b.id) <> (SELECT count(DISTINCT e.account_target) FROM fund_ledger_entries e WHERE e.batch_id = b.id)
      OR EXISTS (SELECT 1 FROM fund_ledger_entries e JOIN fund_accounts account ON account.id = e.account_id WHERE e.batch_id = b.id AND (
        e.direction <> 'CREDIT'
        OR (e.account_target = 'USER' AND (account.owner_type <> 'USER' OR account.user_id IS DISTINCT FROM r.account_owner_user_id))
        OR (e.account_target = 'COMPANY' AND (account.owner_type <> 'COMPANY' OR account.user_id IS NOT NULL))))
      OR (p.voided_at IS NULL AND EXISTS (SELECT 1 FROM fund_posting_batches reversal WHERE reversal.reversal_of_batch_id = b.id))
      OR NOT EXISTS (SELECT 1 FROM sales_order_documents d WHERE d.payment_id = p.id AND d.sales_order_id = r.sales_order_id AND d.media_asset_id = r.voucher_media_asset_id AND d.title = r.voucher_title AND d.detached_at IS NULL AND d.document_type = 'PAYMENT_VOUCHER')
    )
  ) OR EXISTS (
    SELECT 1 FROM sales_order_payments p WHERE p.sales_order_id = order_id AND p.origin = 'REVIEWED'
      AND NOT EXISTS (SELECT 1 FROM sales_receipt_requests r WHERE r.approved_payment_id = p.id AND r.status = 'APPROVED' AND r.sales_order_id = p.sales_order_id)
  ) INTO invalid;
  IF invalid THEN
    RAISE EXCEPTION 'Receipt approval and posting must be complete in one transaction' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_posting_consistency_check';
  END IF;
  IF EXISTS (
    SELECT 1 FROM sales_order_payments p LEFT JOIN fund_posting_batches reversal ON reversal.id = p.fund_reversal_batch_id
    JOIN fund_posting_batches original ON original.id = p.fund_posting_batch_id
    WHERE p.sales_order_id = order_id AND p.origin = 'REVIEWED' AND p.voided_at IS NOT NULL AND (
      reversal.id IS NULL OR reversal.kind <> 'REVERSAL' OR reversal.reversal_of_batch_id <> original.id
      OR reversal.business_amount <> -original.business_amount OR reversal.consumer_code <> 'SALES_RECEIPT.VOID'
      OR reversal.business_source_id <> original.business_source_id OR reversal.business_source_code_snapshot <> 'SALES_RECEIPT'
      OR reversal.posting_type_id <> original.posting_type_id OR reversal.posting_type_code_snapshot <> original.posting_type_code_snapshot
      OR reversal.rule_version_id <> original.rule_version_id OR reversal.rule_revision_snapshot <> original.rule_revision_snapshot
      OR reversal.user_id IS DISTINCT FROM original.user_id OR reversal.currency <> original.currency
      OR reversal.business_category_snapshot <> original.business_category_snapshot OR reversal.business_id <> original.business_id
      OR reversal.user_share_rate_snapshot IS DISTINCT FROM original.user_share_rate_snapshot
      OR reversal.company_share_rate_snapshot IS DISTINCT FROM original.company_share_rate_snapshot
      OR reversal.actor_user_id IS DISTINCT FROM p.voided_by_user_id OR reversal.reversal_reason IS DISTINCT FROM p.void_reason
      OR (SELECT count(*) FROM fund_posting_batches b WHERE b.reversal_of_batch_id = original.id) <> 1
      -- 双向匹配和数量/总额同时校验，避免额外分录、重复映射或零份额伪造分录。
      OR (SELECT count(*) FROM fund_ledger_entries e WHERE e.batch_id = original.id) <> (SELECT count(*) FROM fund_ledger_entries re WHERE re.batch_id = reversal.id)
      OR COALESCE((SELECT sum(re.amount) FROM fund_ledger_entries re WHERE re.batch_id = reversal.id), 0) <> original.business_amount
      OR EXISTS (SELECT 1 FROM fund_ledger_entries e WHERE e.batch_id = original.id AND NOT EXISTS (
        SELECT 1 FROM fund_ledger_entries re WHERE re.batch_id = reversal.id AND re.account_id = e.account_id
          AND re.account_target = e.account_target AND re.amount_strategy = e.amount_strategy AND re.amount = e.amount AND re.direction <> e.direction))
      OR EXISTS (SELECT 1 FROM fund_ledger_entries re WHERE re.batch_id = reversal.id AND NOT EXISTS (
        SELECT 1 FROM fund_ledger_entries e WHERE e.batch_id = original.id AND e.account_id = re.account_id
          AND e.account_target = re.account_target AND e.amount_strategy = re.amount_strategy AND e.amount = re.amount AND e.direction <> re.direction))
    )
  ) THEN
    RAISE EXCEPTION 'Receipt void requires exact original posting reversal' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_reversal_consistency_check';
  END IF;
  IF EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = order_id
    AND EXISTS (SELECT 1 FROM sales_receipt_requests r WHERE r.sales_order_id = o.id AND r.status IN ('PENDING_REVIEW','PENDING_CONFIRM','PENDING_POSTING'))
    AND (o.order_status = 'CANCELLED' OR o.agreed_total_amount <
      COALESCE((SELECT sum(amount) FROM sales_receipt_requests r WHERE r.sales_order_id = o.id AND r.status IN ('PENDING_REVIEW','PENDING_CONFIRM','PENDING_POSTING')),0)
      + COALESCE((SELECT sum(amount) FROM sales_order_payments p WHERE p.sales_order_id = o.id AND p.voided_at IS NULL),0))) THEN
    RAISE EXCEPTION 'Pending receipts reserve order receivable amount' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_reserved_amount_check';
  END IF;
  RETURN NEW;
END;
$$;

-- 失败关闭：列、外键、两条 CHECK 与触发器函数任一缺失都整体回滚。
DO $$
DECLARE
  column_count integer;
  constraint_count integer;
BEGIN
  SELECT count(*) INTO column_count
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'sales_receipt_requests'
    AND (table_name, column_name) IN (
      ('sales_receipt_requests', 'voucher_sent_by_user_id'),
      ('sales_receipt_requests', 'voucher_sent_at'),
      ('sales_receipt_requests', 'confirmed_by_user_id'),
      ('sales_receipt_requests', 'confirmed_at')
    );
  IF column_count <> 4 THEN
    RAISE EXCEPTION 'sales receipt three-step columns expected 4, found %', column_count;
  END IF;

  SELECT count(*) INTO constraint_count
  FROM pg_constraint
  WHERE conrelid = 'sales_receipt_requests'::regclass
    AND conname IN (
      'sales_receipt_requests_state_check',
      'sales_receipt_requests_time_check',
      'sales_receipt_requests_voucher_sent_by_user_id_fkey',
      'sales_receipt_requests_confirmed_by_user_id_fkey'
    );
  IF constraint_count <> 4 THEN
    RAISE EXCEPTION 'sales receipt three-step constraints expected 4, found %', constraint_count;
  END IF;

  IF to_regprocedure('enforce_sales_receipt_request_invariants()') IS NULL THEN
    RAISE EXCEPTION 'sales receipt invariants trigger function is missing';
  END IF;
  IF to_regprocedure('enforce_sales_receipt_consistency()') IS NULL THEN
    RAISE EXCEPTION 'sales receipt consistency trigger function is missing';
  END IF;
END
$$;

COMMIT;
