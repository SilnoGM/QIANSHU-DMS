BEGIN;

-- CreateEnum
CREATE TYPE "sales_receipt_request_status" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "sales_order_payment_origin" AS ENUM ('LEGACY', 'REVIEWED');

-- AlterTable
ALTER TABLE "sales_order_payments" ADD COLUMN     "exchange_rate_captured_at" TIMESTAMPTZ(6),
ADD COLUMN     "exchange_rate_id" UUID,
ADD COLUMN     "exchange_rate_version_snapshot" INTEGER,
ADD COLUMN     "foreign_units_per_cny_snapshot" DECIMAL(30,12),
ADD COLUMN     "fund_posting_batch_id" UUID,
ADD COLUMN     "fund_reversal_batch_id" UUID,
ADD COLUMN     "origin" "sales_order_payment_origin" NOT NULL DEFAULT 'LEGACY';

-- 旧收款仅标记来源，不补造审核或资金流水；新收款默认进入受审约束。
ALTER TABLE "sales_order_payments" ALTER COLUMN "origin" SET DEFAULT 'REVIEWED';

-- CreateTable
CREATE TABLE "sales_receipt_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sales_order_id" UUID NOT NULL,
    "account_owner_user_id" UUID NOT NULL,
    "payment_type" "sales_order_payment_type" NOT NULL,
    "amount" DECIMAL(30,4) NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "payment_method" VARCHAR(64) NOT NULL,
    "payment_method_name_snapshot" VARCHAR(128) NOT NULL,
    "remark" VARCHAR(500),
    "voucher_media_asset_id" UUID NOT NULL,
    "voucher_title" VARCHAR(128) NOT NULL,
    "status" "sales_receipt_request_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "submitted_by_user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_remark" VARCHAR(500),
    "approved_payment_id" UUID,
    "resubmitted_from_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key_hash" BYTEA NOT NULL,
    "request_fingerprint_hash" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_receipt_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_receipt_requests_approved_payment_key" ON "sales_receipt_requests"("approved_payment_id");

-- CreateIndex
CREATE INDEX "sales_receipt_requests_status_submitted_id_idx" ON "sales_receipt_requests"("status", "submitted_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "sales_receipt_requests_order_status_idx" ON "sales_receipt_requests"("sales_order_id", "status");

-- CreateIndex
CREATE INDEX "sales_receipt_requests_voucher_idx" ON "sales_receipt_requests"("voucher_media_asset_id");

-- CreateIndex
CREATE INDEX "sales_receipt_requests_owner_submitted_id_idx" ON "sales_receipt_requests"("account_owner_user_id", "submitted_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sales_receipt_requests_submitter_idempotency_key" ON "sales_receipt_requests"("submitted_by_user_id", "idempotency_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_payments_posting_batch_key" ON "sales_order_payments"("fund_posting_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_payments_reversal_batch_key" ON "sales_order_payments"("fund_reversal_batch_id");

-- AddForeignKey
ALTER TABLE "sales_order_payments" ADD CONSTRAINT "sales_order_payments_fund_posting_batch_id_fkey" FOREIGN KEY ("fund_posting_batch_id") REFERENCES "fund_posting_batches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_order_payments" ADD CONSTRAINT "sales_order_payments_fund_reversal_batch_id_fkey" FOREIGN KEY ("fund_reversal_batch_id") REFERENCES "fund_posting_batches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_order_payments" ADD CONSTRAINT "sales_order_payments_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_receipt_requests" ADD CONSTRAINT "sales_receipt_requests_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_receipt_requests" ADD CONSTRAINT "sales_receipt_requests_account_owner_user_id_fkey" FOREIGN KEY ("account_owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_receipt_requests" ADD CONSTRAINT "sales_receipt_requests_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_receipt_requests" ADD CONSTRAINT "sales_receipt_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_receipt_requests" ADD CONSTRAINT "sales_receipt_requests_voucher_media_asset_id_fkey" FOREIGN KEY ("voucher_media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_receipt_requests" ADD CONSTRAINT "sales_receipt_requests_approved_payment_id_fkey" FOREIGN KEY ("approved_payment_id") REFERENCES "sales_order_payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_receipt_requests" ADD CONSTRAINT "sales_receipt_requests_resubmitted_from_id_fkey" FOREIGN KEY ("resubmitted_from_id") REFERENCES "sales_receipt_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "sales_receipt_requests"
  ADD CONSTRAINT "sales_receipt_requests_amount_check" CHECK (amount > 0 AND currency_code IN ('TWD', 'MYR')),
  ADD CONSTRAINT "sales_receipt_requests_hash_check" CHECK (octet_length(idempotency_key_hash) = 32 AND octet_length(request_fingerprint_hash) = 32),
  ADD CONSTRAINT "sales_receipt_requests_state_check" CHECK (
    (status = 'PENDING_REVIEW' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND review_remark IS NULL AND approved_payment_id IS NULL AND version = 1)
    OR (status = 'REJECTED' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_remark IS NOT NULL AND length(btrim(review_remark)) > 0 AND approved_payment_id IS NULL AND version = 2)
    OR (status = 'APPROVED' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND approved_payment_id IS NOT NULL AND version = 2)
  ),
  ADD CONSTRAINT "sales_receipt_requests_time_check" CHECK (received_at <= submitted_at AND (reviewed_at IS NULL OR reviewed_at >= submitted_at));

CREATE UNIQUE INDEX "sales_receipt_requests_original_voucher_key" ON "sales_receipt_requests" (voucher_media_asset_id) WHERE resubmitted_from_id IS NULL;

ALTER TABLE "sales_order_payments" ADD CONSTRAINT "sales_order_payments_posting_shape_check" CHECK (
  (origin = 'LEGACY' AND fund_posting_batch_id IS NULL AND fund_reversal_batch_id IS NULL AND exchange_rate_id IS NULL AND exchange_rate_version_snapshot IS NULL AND foreign_units_per_cny_snapshot IS NULL AND exchange_rate_captured_at IS NULL)
  OR (origin = 'REVIEWED' AND fund_posting_batch_id IS NOT NULL AND exchange_rate_id IS NOT NULL AND exchange_rate_version_snapshot IS NOT NULL AND exchange_rate_version_snapshot > 0 AND foreign_units_per_cny_snapshot IS NOT NULL AND foreign_units_per_cny_snapshot > 0 AND exchange_rate_captured_at IS NOT NULL
    AND ((voided_at IS NULL AND fund_reversal_batch_id IS NULL) OR (voided_at IS NOT NULL AND fund_reversal_batch_id IS NOT NULL)))
);

CREATE FUNCTION "enforce_sales_receipt_request_invariants"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE order_row sales_orders%ROWTYPE; parent_row sales_receipt_requests%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Receipt request evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_immutable_check';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'PENDING_REVIEW' OR NEW.status = 'PENDING_REVIEW'
      OR (to_jsonb(OLD) - ARRAY['status','reviewed_by_user_id','reviewed_at','review_remark','approved_payment_id','version','updated_at']) IS DISTINCT FROM
         (to_jsonb(NEW) - ARRAY['status','reviewed_by_user_id','reviewed_at','review_remark','approved_payment_id','version','updated_at']) THEN
      RAISE EXCEPTION 'Receipt request evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_immutable_check';
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
CREATE TRIGGER "sales_receipt_requests_invariants_trigger" BEFORE INSERT OR UPDATE OR DELETE ON "sales_receipt_requests"
FOR EACH ROW EXECUTE FUNCTION "enforce_sales_receipt_request_invariants"();

-- 已经入账的事实只允许一次完整作废，不开放汇率或批次的后补修改。
CREATE OR REPLACE FUNCTION "enforce_sales_order_payment_invariants"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sales order payments must be voided instead of deleted' USING ERRCODE = '23514', CONSTRAINT = 'sales_order_payments_soft_void_check';
  END IF;
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR
    (to_jsonb(OLD) - ARRAY['voided_at','voided_by_user_id','void_reason','fund_reversal_batch_id']) IS DISTINCT FROM
    (to_jsonb(NEW) - ARRAY['voided_at','voided_by_user_id','void_reason','fund_reversal_batch_id']) THEN
    RAISE EXCEPTION 'Sales order payment facts are immutable' USING ERRCODE = '23514', CONSTRAINT = 'sales_order_payments_immutable_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_reviewed_sales_payment_insert"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origin <> 'REVIEWED' THEN
    RAISE EXCEPTION 'New receipts require financial review' USING ERRCODE = '23514', CONSTRAINT = 'sales_order_payments_review_required_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "sales_order_payments_review_required_trigger" BEFORE INSERT ON "sales_order_payments"
FOR EACH ROW EXECUTE FUNCTION "enforce_reviewed_sales_payment_insert"();

-- 在事务末读最终状态，允许入账、正式收款、凭证、审核结论按依赖顺序创建。
CREATE FUNCTION "enforce_sales_receipt_consistency"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
    AND EXISTS (SELECT 1 FROM sales_receipt_requests r WHERE r.sales_order_id = o.id AND r.status = 'PENDING_REVIEW')
    AND (o.order_status = 'CANCELLED' OR o.agreed_total_amount <
      COALESCE((SELECT sum(amount) FROM sales_receipt_requests r WHERE r.sales_order_id = o.id AND r.status = 'PENDING_REVIEW'),0)
      + COALESCE((SELECT sum(amount) FROM sales_order_payments p WHERE p.sales_order_id = o.id AND p.voided_at IS NULL),0))) THEN
    RAISE EXCEPTION 'Pending receipts reserve order receivable amount' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_reserved_amount_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "sales_receipt_requests_consistency_trigger" AFTER INSERT OR UPDATE ON "sales_receipt_requests" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_sales_receipt_consistency"();
CREATE CONSTRAINT TRIGGER "sales_order_payments_receipt_consistency_trigger" AFTER INSERT OR UPDATE ON "sales_order_payments" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_sales_receipt_consistency"();
CREATE CONSTRAINT TRIGGER "sales_orders_receipt_consistency_trigger" AFTER UPDATE ON "sales_orders" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_sales_receipt_consistency"();
CREATE CONSTRAINT TRIGGER "fund_posting_batches_receipt_consistency_trigger" AFTER INSERT ON "fund_posting_batches" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_sales_receipt_consistency"();
CREATE CONSTRAINT TRIGGER "fund_ledger_entries_receipt_consistency_trigger" AFTER INSERT ON "fund_ledger_entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_sales_receipt_consistency"();

CREATE OR REPLACE FUNCTION "enforce_ready_media_asset_reference"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reference_asset_id UUID;
  current_status "media_asset_status";
BEGIN
  IF TG_TABLE_NAME = 'media_assets' THEN
    reference_asset_id := NEW."id";
  ELSIF TG_TABLE_NAME = 'sales_receipt_requests' THEN
    reference_asset_id := NEW."voucher_media_asset_id";
  ELSIF TG_OP = 'DELETE' THEN
    reference_asset_id := OLD."media_asset_id";
  ELSE
    reference_asset_id := NEW."media_asset_id";
  END IF;

  SELECT asset."status"
  INTO current_status
  FROM "media_assets" AS asset
  WHERE asset."id" = reference_asset_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF current_status = 'READY'
    AND NOT EXISTS (
      SELECT 1
      FROM "product_media" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "sales_order_documents" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "purchase_order_documents" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM "sales_receipt_requests" AS reference
      WHERE reference."voucher_media_asset_id" = reference_asset_id
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'READY media asset requires an active domain reference',
      CONSTRAINT = 'media_assets_ready_reference_check';
  END IF;

  IF current_status <> 'READY' AND EXISTS (
    SELECT 1 FROM sales_receipt_requests WHERE voucher_media_asset_id = reference_asset_id
  ) THEN
    RAISE EXCEPTION 'Receipt evidence must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_voucher_ready_check';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


CREATE CONSTRAINT TRIGGER "sales_receipt_requests_ready_reference_trigger"
AFTER INSERT OR UPDATE ON "sales_receipt_requests" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_ready_media_asset_reference"();

INSERT INTO "permissions" ("id", "code", "name", "description", "system_only") VALUES
(gen_random_uuid(), 'sales-receipts:read', '查看销售收款', '查看财务销售收款申请及凭证', false),
(gen_random_uuid(), 'sales-receipts:review', '审核销售收款', '通过或驳回销售收款申请', false),
(gen_random_uuid(), 'sales-receipts:void', '销售收款财务纠错', '填写原因并作废正式收款及冲正原资金入账', false);
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE role.code = 'system_admin' AND permission.code IN ('sales-receipts:read','sales-receipts:review','sales-receipts:void');
UPDATE permissions SET name = '提交销售收款', description = '提交销售订单收款申请，待财务审核后生效' WHERE code = 'sales-orders:payment';

INSERT INTO fund_business_sources (id, code, name, description, enabled, version)
VALUES (gen_random_uuid(), 'SALES_RECEIPT', '销售收款', '销售收款审核与原入账全额冲正专用来源', true, 1);
INSERT INTO fund_business_source_posting_types (business_source_id, posting_type_id)
SELECT source.id, type.id FROM fund_business_sources source CROSS JOIN fund_posting_types type
WHERE source.code = 'SALES_RECEIPT' AND type.code = 'ORDER_SETTLEMENT';

COMMIT;
