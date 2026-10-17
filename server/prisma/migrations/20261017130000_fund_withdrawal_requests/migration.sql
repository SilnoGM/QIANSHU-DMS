-- 用户提款申请：运营提交 → 财务审核；通过时上传付款截图并原子扣减用户账户。
-- 账户允许负余额，因此审批不做余额下限校验；资金域仍以不可变批次/流水为事实源。
CREATE TYPE "fund_withdrawal_status" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE "fund_withdrawal_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "withdrawal_no" VARCHAR(64) NOT NULL,
  "numbering_issuance_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "amount" DECIMAL(30, 2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
  "status" "fund_withdrawal_status" NOT NULL DEFAULT 'PENDING',
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(6),
  "reviewed_by_user_id" UUID,
  "reject_reason" VARCHAR(500),
  "payment_proof_media_asset_id" UUID,
  "fund_posting_batch_id" UUID,
  "request_key_hash" BYTEA NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fund_withdrawal_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fund_withdrawal_requests_number_format_check"
    CHECK ("withdrawal_no" ~ '^[A-Z0-9_./-]{1,64}$'),
  CONSTRAINT "fund_withdrawal_requests_amount_positive_check"
    CHECK ("amount" > 0 AND "amount" = round("amount", 2)),
  CONSTRAINT "fund_withdrawal_requests_currency_cny_check"
    CHECK ("currency" = 'CNY'),
  CONSTRAINT "fund_withdrawal_requests_request_key_hash_check"
    CHECK (octet_length("request_key_hash") = 32),
  CONSTRAINT "fund_withdrawal_requests_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "fund_withdrawal_requests_reject_reason_shape_check"
    CHECK (
      "reject_reason" IS NULL
      OR (
        "reject_reason" = btrim("reject_reason")
        AND length("reject_reason") > 0
      )
    ),
  CONSTRAINT "fund_withdrawal_requests_status_shape_check"
    CHECK (
      (
        "status" = 'PENDING'
        AND "reviewed_at" IS NULL
        AND "reviewed_by_user_id" IS NULL
        AND "reject_reason" IS NULL
        AND "payment_proof_media_asset_id" IS NULL
        AND "fund_posting_batch_id" IS NULL
      )
      OR (
        "status" = 'APPROVED'
        AND "reviewed_at" IS NOT NULL
        AND "reviewed_by_user_id" IS NOT NULL
        AND "reject_reason" IS NULL
        AND "payment_proof_media_asset_id" IS NOT NULL
        AND "fund_posting_batch_id" IS NOT NULL
      )
      OR (
        "status" = 'REJECTED'
        AND "reviewed_at" IS NOT NULL
        AND "reviewed_by_user_id" IS NOT NULL
        AND "reject_reason" IS NOT NULL
        AND "payment_proof_media_asset_id" IS NULL
        AND "fund_posting_batch_id" IS NULL
      )
    )
);

CREATE UNIQUE INDEX "fund_withdrawal_requests_number_key"
  ON "fund_withdrawal_requests" ("withdrawal_no");
CREATE UNIQUE INDEX "fund_withdrawal_requests_issuance_key"
  ON "fund_withdrawal_requests" ("numbering_issuance_id");
CREATE UNIQUE INDEX "fund_withdrawal_requests_payment_proof_key"
  ON "fund_withdrawal_requests" ("payment_proof_media_asset_id");
CREATE UNIQUE INDEX "fund_withdrawal_requests_posting_batch_key"
  ON "fund_withdrawal_requests" ("fund_posting_batch_id");
CREATE UNIQUE INDEX "fund_withdrawal_requests_user_request_key"
  ON "fund_withdrawal_requests" ("user_id", "request_key_hash");
CREATE INDEX "fund_withdrawal_requests_user_submitted_id_idx"
  ON "fund_withdrawal_requests" ("user_id", "submitted_at" DESC, "id" DESC);
CREATE INDEX "fund_withdrawal_requests_status_submitted_id_idx"
  ON "fund_withdrawal_requests" ("status", "submitted_at" DESC, "id" DESC);
CREATE INDEX "fund_withdrawal_requests_reviewer_reviewed_id_idx"
  ON "fund_withdrawal_requests" ("reviewed_by_user_id", "reviewed_at" DESC, "id" DESC);

ALTER TABLE "fund_withdrawal_requests"
  ADD CONSTRAINT "fund_withdrawal_requests_numbering_issuance_id_fkey"
  FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "fund_withdrawal_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "fund_withdrawal_requests_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "fund_accounts" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "fund_withdrawal_requests_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "fund_withdrawal_requests_payment_proof_media_asset_id_fkey"
  FOREIGN KEY ("payment_proof_media_asset_id") REFERENCES "media_assets" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "fund_withdrawal_requests_fund_posting_batch_id_fkey"
  FOREIGN KEY ("fund_posting_batch_id") REFERENCES "fund_posting_batches" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 申请单号：WD/YYYYMMDD-####，按年重置。与资金批次号分开，拒绝的申请也保留单号。
DO $$
DECLARE
  rule_id UUID;
  version_id UUID;
BEGIN
  INSERT INTO "numbering_rules" (
    "rule_code", "purpose", "name", "description"
  )
  VALUES (
    'FUND_WITHDRAWAL_NO',
    'BUSINESS',
    '资金提款申请编号',
    '用于用户提款申请的唯一编号'
  )
  RETURNING "id" INTO rule_id;

  INSERT INTO "numbering_rule_versions" (
    "rule_id", "revision", "status", "reset_policy", "timezone", "config_fingerprint"
  )
  VALUES (
    rule_id,
    1,
    'DRAFT',
    'YEARLY',
    'Asia/Shanghai',
    '5bd0dd8780239aae490c2152fd9d568d8c347c2eea14a322fea398a177b909c9'
  )
  RETURNING "id" INTO version_id;

  INSERT INTO "numbering_rule_segments" (
    "version_id", "position", "type", "fixed_value", "date_format",
    "separator_value", "sequence_width", "sequence_start_value", "sequence_step"
  )
  VALUES
    (version_id, 0, 'FIXED', 'WD', NULL, NULL, NULL, NULL, NULL),
    (version_id, 1, 'SEPARATOR', NULL, NULL, '/', NULL, NULL, NULL),
    (version_id, 2, 'DATE', NULL, 'YYYYMMDD', NULL, NULL, NULL, NULL),
    (version_id, 3, 'SEPARATOR', NULL, NULL, '-', NULL, NULL, NULL),
    (version_id, 4, 'SEQUENCE', NULL, NULL, NULL, 4, 1, 1);

  UPDATE "numbering_rule_versions"
  SET "status" = 'ACTIVE', "published_at" = clock_timestamp()
  WHERE "id" = version_id;

  UPDATE "numbering_rules"
  SET "status" = 'ENABLED', "version" = 3, "updated_at" = clock_timestamp()
  WHERE "id" = rule_id;
END;
$$;

-- 提款批次必须来自专用受控来源；付款审批不区分余额正负，账户允许扣成负数。
INSERT INTO "fund_business_sources" (
  "id", "code", "name", "description", "enabled", "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002104',
  'FUND_WITHDRAWAL',
  '用户提款',
  '用户提款申请财务审核通过后的专用扣款来源',
  true,
  1
);

INSERT INTO "fund_business_source_posting_types" ("business_source_id", "posting_type_id")
SELECT source."id", posting_type."id"
FROM "fund_business_sources" AS source
CROSS JOIN "fund_posting_types" AS posting_type
WHERE source."code" = 'FUND_WITHDRAWAL'
  AND posting_type."code" = 'USER_WITHDRAWAL';

ALTER TABLE "fund_posting_batches" ADD CONSTRAINT "fund_posting_batches_withdrawal_shape_check" CHECK (
  "business_source_code_snapshot" IS DISTINCT FROM 'FUND_WITHDRAWAL'
  OR (
    "kind" = 'BUSINESS'
    AND "consumer_code" = 'FUND_WITHDRAWAL.PAY'
    AND "posting_type_code_snapshot" = 'USER_WITHDRAWAL'
    AND "business_category_snapshot" = 'NEUTRAL'
    AND "business_amount" > 0
    AND "user_id" IS NOT NULL
    AND "actor_user_id" IS NOT NULL
    AND "user_share_rate_snapshot" BETWEEN 0 AND 100
    AND "company_share_rate_snapshot" BETWEEN 0 AND 100
    AND "user_share_rate_snapshot" + "company_share_rate_snapshot" = 100
  )
);

ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'FUND_WITHDRAWAL_SUBMITTED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'FUND_WITHDRAWAL_APPROVED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'FUND_WITHDRAWAL_REJECTED';

-- 申请单只允许由编号域派发单号，且账户必须归属于申请人。
CREATE FUNCTION "enforce_fund_withdrawal_number_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "numbering_issuances" AS issuance
    JOIN "numbering_rules" AS rule ON rule."id" = issuance."rule_id"
    WHERE issuance."id" = NEW."numbering_issuance_id"
      AND issuance."generated_number" = NEW."withdrawal_no"
      AND issuance."consumer_code" = 'FUND_WITHDRAWAL.CREATE'
      AND rule."rule_code" = 'FUND_WITHDRAWAL_NO'
      AND rule."purpose" = 'BUSINESS'
  ) THEN
    RAISE EXCEPTION 'fund withdrawal number must match its scoped issuance'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_withdrawal_requests_number_identity_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "fund_accounts" AS account
    WHERE account."id" = NEW."account_id"
      AND account."owner_type" = 'USER'
      AND account."user_id" = NEW."user_id"
  ) THEN
    RAISE EXCEPTION 'fund withdrawal account must belong to the applicant'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_withdrawal_requests_account_owner_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "fund_withdrawal_requests_identity_trigger"
BEFORE INSERT ON "fund_withdrawal_requests"
FOR EACH ROW
EXECUTE FUNCTION "enforce_fund_withdrawal_number_identity"();

-- 申请单是资金事实的一部分：单号、金额、归属不可改；只允许一次 PENDING → APPROVED/REJECTED。
CREATE FUNCTION "enforce_fund_withdrawal_transition"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fund withdrawal requests are immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_withdrawal_requests_immutable_check';
  END IF;

  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'fund withdrawal request is already terminal'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_withdrawal_requests_terminal_check';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."withdrawal_no" IS DISTINCT FROM OLD."withdrawal_no"
    OR NEW."numbering_issuance_id" IS DISTINCT FROM OLD."numbering_issuance_id"
    OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
    OR NEW."account_id" IS DISTINCT FROM OLD."account_id"
    OR NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
    OR NEW."request_key_hash" IS DISTINCT FROM OLD."request_key_hash"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'fund withdrawal request identity is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_withdrawal_requests_identity_immutable_check';
  END IF;

  IF NEW."status" NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'fund withdrawal request must transition to a terminal status'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_withdrawal_requests_transition_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "fund_withdrawal_requests_transition_trigger"
BEFORE UPDATE OR DELETE ON "fund_withdrawal_requests"
FOR EACH ROW
EXECUTE FUNCTION "enforce_fund_withdrawal_transition"();

-- 付款截图的媒体用途与引用保护；审批事务内先激活媒体再回填引用，因此用延迟约束触发器。
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_upload_purpose_check";
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_upload_purpose_check"
  CHECK (upload_purpose IS NULL OR upload_purpose IN ('PAYMENT_RECIPIENT_QR','PURCHASE_PAYMENT_VOUCHER','PACKAGING_PAYMENT_VOUCHER','OCEAN_FREIGHT_SOURCE_XLSX','SLH_BILL_SOURCE_XLSX','INVOICE_REQUEST_DOCUMENT','FUND_WITHDRAWAL_PAYMENT_PROOF'));

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
  ELSIF TG_TABLE_NAME = 'container_batches' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD.source_file_id; ELSE reference_asset_id := NEW.source_file_id; END IF;
  ELSIF TG_TABLE_NAME = 'slh_bills' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD.source_file_id; ELSE reference_asset_id := NEW.source_file_id; END IF;
  ELSIF TG_TABLE_NAME = 'payment_recipient_accounts' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD.qr_media_asset_id; ELSE reference_asset_id := NEW.qr_media_asset_id; END IF;
  ELSIF TG_TABLE_NAME = 'purchase_order_payments' THEN
    reference_asset_id := NEW.recipient_qr_media_asset_id;
  ELSIF TG_TABLE_NAME = 'sales_receipt_requests' THEN
    reference_asset_id := NEW."voucher_media_asset_id";
  ELSIF TG_TABLE_NAME = 'invoice_requests' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD."document_media_asset_id"; ELSE reference_asset_id := NEW."document_media_asset_id"; END IF;
  ELSIF TG_TABLE_NAME = 'fund_withdrawal_requests' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD."payment_proof_media_asset_id"; ELSE reference_asset_id := NEW."payment_proof_media_asset_id"; END IF;
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
    AND NOT EXISTS (SELECT 1 FROM purchase_order_image_drafts reference WHERE reference.media_asset_id = reference_asset_id AND reference.invalidated_at IS NULL AND reference.archived_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM packaging_cost_requests reference WHERE reference.packaging_image_media_asset_id = reference_asset_id OR reference.quotation_image_media_asset_id = reference_asset_id OR reference.payment_voucher_media_asset_id = reference_asset_id OR reference.recipient_qr_media_asset_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM payment_recipient_accounts reference WHERE reference.qr_media_asset_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM purchase_order_payments reference WHERE reference.recipient_qr_media_asset_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM container_batches reference WHERE reference.source_file_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM slh_bills reference WHERE reference.source_file_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM invoice_requests reference WHERE reference.document_media_asset_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM fund_withdrawal_requests reference WHERE reference.payment_proof_media_asset_id = reference_asset_id)
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
  IF current_status <> 'READY' AND EXISTS (SELECT 1 FROM purchase_order_image_drafts WHERE media_asset_id = reference_asset_id AND invalidated_at IS NULL AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Current purchase image draft must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_image_drafts_ready_check';
  END IF;
  IF current_status <> 'READY' AND EXISTS (SELECT 1 FROM packaging_cost_requests WHERE packaging_image_media_asset_id = reference_asset_id OR quotation_image_media_asset_id = reference_asset_id OR payment_voucher_media_asset_id = reference_asset_id OR recipient_qr_media_asset_id = reference_asset_id) THEN
    RAISE EXCEPTION 'Packaging evidence must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_image_ready_check';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_recipient_accounts WHERE qr_media_asset_id = reference_asset_id)
    OR EXISTS (SELECT 1 FROM purchase_order_payments WHERE recipient_qr_media_asset_id = reference_asset_id)
    OR EXISTS (SELECT 1 FROM packaging_cost_requests WHERE recipient_qr_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'PAYMENT_RECIPIENT_QR'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp') AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recipient code must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_image_ready_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM container_batches WHERE source_file_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'DOCUMENT' AND upload_purpose = 'OCEAN_FREIGHT_SOURCE_XLSX'
      AND mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 52428800;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ocean freight source must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'ocean_freight_source_ready_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM slh_bills WHERE source_file_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'DOCUMENT' AND upload_purpose = 'SLH_BILL_SOURCE_XLSX'
      AND mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 52428800;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SLH bill source must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'slh_bill_source_ready_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_requests WHERE document_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'INVOICE_REQUEST_DOCUMENT'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice document must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'invoice_requests_document_ready_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM fund_withdrawal_requests WHERE payment_proof_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'FUND_WITHDRAWAL_PAYMENT_PROOF'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fund withdrawal payment proof must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'fund_withdrawal_requests_proof_ready_check';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "fund_withdrawal_requests_proof_ready_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "fund_withdrawal_requests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_ready_media_asset_reference"();

-- 自校验：规则、来源、编号身份与两个触发器必须在同一迁移内成立。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM numbering_rules rule
    JOIN numbering_rule_versions version
      ON version.rule_id = rule.id AND version.status = 'ACTIVE'
    WHERE rule.rule_code = 'FUND_WITHDRAWAL_NO'
      AND rule.status = 'ENABLED'
      AND rule.purpose = 'BUSINESS'
  ) THEN
    RAISE EXCEPTION 'FUND_WITHDRAWAL_NO rule is not enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM fund_business_sources source
    JOIN fund_business_source_posting_types binding ON binding.business_source_id = source.id
    JOIN fund_posting_types type ON type.id = binding.posting_type_id
    WHERE source.code = 'FUND_WITHDRAWAL'
      AND source.enabled
      AND type.code = 'USER_WITHDRAWAL'
      AND type.enabled
  ) THEN
    RAISE EXCEPTION 'FUND_WITHDRAWAL source is not bound to USER_WITHDRAWAL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'fund_withdrawal_requests_identity_trigger'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'fund_withdrawal_requests_transition_trigger'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'fund_withdrawal_requests_proof_ready_trigger'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'fund withdrawal triggers are missing';
  END IF;
END;
$$;
