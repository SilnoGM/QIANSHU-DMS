-- 广告账户充值申请：运营提交 → 财务付款并上传真实付款截图。
-- 付款金额按既有 ADVERTISING_FEE 已发布规则（COST / DEBIT，USER_SHARE + COMPANY_REMAINDER）
-- 分摊到申请人个人资金账户与公司资金账户，业务状态、资金批次与审计在同一事务内提交。
-- 申请单因此是资金事实的一部分：单号、账户信息与申请金额提交后不可改；
-- 已付款只能整单作废并由反向资金批次冲正，不能原地改金额重付。
CREATE TYPE "advertising_account_type" AS ENUM (
  'PERSONAL',
  'NON_PERSONAL'
);

CREATE TYPE "advertising_recharge_status" AS ENUM (
  'PENDING',
  'PAID',
  'REJECTED',
  'WITHDRAWN',
  'VOIDED'
);

CREATE TABLE "advertising_recharge_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recharge_no" VARCHAR(64) NOT NULL,
  "numbering_issuance_id" UUID NOT NULL,
  "applicant_user_id" UUID NOT NULL,
  "account_type" "advertising_account_type" NOT NULL,
  "ad_account_name" VARCHAR(128) NOT NULL,
  "ad_account_no" VARCHAR(128) NOT NULL,
  "recharge_amount" DECIMAL(30, 2) NOT NULL,
  "recharge_currency" CHAR(3) NOT NULL,
  "payment_qr_media_asset_id" UUID,
  "remark" VARCHAR(500),
  "status" "advertising_recharge_status" NOT NULL DEFAULT 'PENDING',
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payment_amount_cny" DECIMAL(30, 2),
  "payment_proof_media_asset_id" UUID,
  "paid_at" TIMESTAMPTZ(6),
  "paid_by_user_id" UUID,
  "fund_posting_batch_id" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "reviewed_by_user_id" UUID,
  "reject_reason" VARCHAR(500),
  "withdrawn_at" TIMESTAMPTZ(6),
  "voided_at" TIMESTAMPTZ(6),
  "voided_by_user_id" UUID,
  "void_reason" VARCHAR(500),
  "fund_reversal_batch_id" UUID,
  "request_key_hash" BYTEA NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "advertising_recharge_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "advertising_recharge_requests_number_format_check"
    CHECK ("recharge_no" ~ '^[A-Z0-9_./-]{1,64}$'),
  CONSTRAINT "advertising_recharge_requests_account_name_shape_check"
    CHECK (
      "ad_account_name" = btrim("ad_account_name")
      AND length("ad_account_name") > 0
      AND "ad_account_no" = btrim("ad_account_no")
      AND length("ad_account_no") > 0
    ),
  CONSTRAINT "advertising_recharge_requests_amount_positive_check"
    CHECK ("recharge_amount" > 0 AND "recharge_amount" = round("recharge_amount", 2)),
  CONSTRAINT "advertising_recharge_requests_currency_check"
    CHECK ("recharge_currency" IN ('CNY', 'USD')),
  CONSTRAINT "advertising_recharge_requests_payment_amount_check"
    CHECK (
      "payment_amount_cny" IS NULL
      OR ("payment_amount_cny" > 0 AND "payment_amount_cny" = round("payment_amount_cny", 2))
    ),
  -- 个人户必须提供收款二维码；非个人户前端不展示该字段，服务端也不接受，避免脏数据。
  CONSTRAINT "advertising_recharge_requests_qr_shape_check"
    CHECK (
      ("account_type" = 'PERSONAL' AND "payment_qr_media_asset_id" IS NOT NULL)
      OR ("account_type" = 'NON_PERSONAL' AND "payment_qr_media_asset_id" IS NULL)
    ),
  CONSTRAINT "advertising_recharge_requests_remark_shape_check"
    CHECK ("remark" IS NULL OR ("remark" = btrim("remark") AND length("remark") > 0)),
  CONSTRAINT "advertising_recharge_requests_request_key_hash_check"
    CHECK (octet_length("request_key_hash") = 32),
  CONSTRAINT "advertising_recharge_requests_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "advertising_recharge_requests_reject_reason_shape_check"
    CHECK ("reject_reason" IS NULL OR ("reject_reason" = btrim("reject_reason") AND length("reject_reason") > 0)),
  CONSTRAINT "advertising_recharge_requests_void_reason_shape_check"
    CHECK ("void_reason" IS NULL OR ("void_reason" = btrim("void_reason") AND length("void_reason") > 0)),
  -- 每个状态只允许一组确定的字段形状；作废保留原付款事实并额外记录冲正批次。
  CONSTRAINT "advertising_recharge_requests_status_shape_check"
    CHECK (
      (
        "status" = 'PENDING'
        AND "payment_amount_cny" IS NULL
        AND "payment_proof_media_asset_id" IS NULL
        AND "paid_at" IS NULL
        AND "paid_by_user_id" IS NULL
        AND "fund_posting_batch_id" IS NULL
        AND "reviewed_at" IS NULL
        AND "reviewed_by_user_id" IS NULL
        AND "reject_reason" IS NULL
        AND "withdrawn_at" IS NULL
        AND "voided_at" IS NULL
        AND "voided_by_user_id" IS NULL
        AND "void_reason" IS NULL
        AND "fund_reversal_batch_id" IS NULL
      )
      OR (
        "status" = 'PAID'
        AND "payment_amount_cny" IS NOT NULL
        AND "payment_proof_media_asset_id" IS NOT NULL
        AND "paid_at" IS NOT NULL
        AND "paid_by_user_id" IS NOT NULL
        AND "fund_posting_batch_id" IS NOT NULL
        AND "reviewed_at" IS NULL
        AND "reviewed_by_user_id" IS NULL
        AND "reject_reason" IS NULL
        AND "withdrawn_at" IS NULL
        AND "voided_at" IS NULL
        AND "voided_by_user_id" IS NULL
        AND "void_reason" IS NULL
        AND "fund_reversal_batch_id" IS NULL
      )
      OR (
        "status" = 'REJECTED'
        AND "payment_amount_cny" IS NULL
        AND "payment_proof_media_asset_id" IS NULL
        AND "paid_at" IS NULL
        AND "paid_by_user_id" IS NULL
        AND "fund_posting_batch_id" IS NULL
        AND "reviewed_at" IS NOT NULL
        AND "reviewed_by_user_id" IS NOT NULL
        AND "reject_reason" IS NOT NULL
        AND "withdrawn_at" IS NULL
        AND "voided_at" IS NULL
        AND "voided_by_user_id" IS NULL
        AND "void_reason" IS NULL
        AND "fund_reversal_batch_id" IS NULL
      )
      OR (
        "status" = 'WITHDRAWN'
        AND "payment_amount_cny" IS NULL
        AND "payment_proof_media_asset_id" IS NULL
        AND "paid_at" IS NULL
        AND "paid_by_user_id" IS NULL
        AND "fund_posting_batch_id" IS NULL
        AND "reviewed_at" IS NULL
        AND "reviewed_by_user_id" IS NULL
        AND "reject_reason" IS NULL
        AND "withdrawn_at" IS NOT NULL
        AND "voided_at" IS NULL
        AND "voided_by_user_id" IS NULL
        AND "void_reason" IS NULL
        AND "fund_reversal_batch_id" IS NULL
      )
      OR (
        "status" = 'VOIDED'
        AND "payment_amount_cny" IS NOT NULL
        AND "payment_proof_media_asset_id" IS NOT NULL
        AND "paid_at" IS NOT NULL
        AND "paid_by_user_id" IS NOT NULL
        AND "fund_posting_batch_id" IS NOT NULL
        AND "reviewed_at" IS NULL
        AND "reviewed_by_user_id" IS NULL
        AND "reject_reason" IS NULL
        AND "withdrawn_at" IS NULL
        AND "voided_at" IS NOT NULL
        AND "voided_by_user_id" IS NOT NULL
        AND "void_reason" IS NOT NULL
        AND "fund_reversal_batch_id" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "advertising_recharge_requests_number_key"
  ON "advertising_recharge_requests" ("recharge_no");
CREATE UNIQUE INDEX "advertising_recharge_requests_issuance_key"
  ON "advertising_recharge_requests" ("numbering_issuance_id");
CREATE UNIQUE INDEX "advertising_recharge_requests_qr_key"
  ON "advertising_recharge_requests" ("payment_qr_media_asset_id");
CREATE UNIQUE INDEX "advertising_recharge_requests_proof_key"
  ON "advertising_recharge_requests" ("payment_proof_media_asset_id");
CREATE UNIQUE INDEX "advertising_recharge_requests_posting_batch_key"
  ON "advertising_recharge_requests" ("fund_posting_batch_id");
CREATE UNIQUE INDEX "advertising_recharge_requests_reversal_batch_key"
  ON "advertising_recharge_requests" ("fund_reversal_batch_id");
CREATE UNIQUE INDEX "advertising_recharge_requests_applicant_request_key"
  ON "advertising_recharge_requests" ("applicant_user_id", "request_key_hash");
CREATE INDEX "advertising_recharge_requests_applicant_submitted_idx"
  ON "advertising_recharge_requests" ("applicant_user_id", "submitted_at" DESC, "id" DESC);
CREATE INDEX "advertising_recharge_requests_status_submitted_idx"
  ON "advertising_recharge_requests" ("status", "submitted_at" DESC, "id" DESC);
CREATE INDEX "advertising_recharge_requests_payer_paid_idx"
  ON "advertising_recharge_requests" ("paid_by_user_id", "paid_at" DESC, "id" DESC);

ALTER TABLE "advertising_recharge_requests"
  ADD CONSTRAINT "advertising_recharge_requests_numbering_issuance_id_fkey"
  FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "advertising_recharge_requests_applicant_user_id_fkey"
  FOREIGN KEY ("applicant_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "advertising_recharge_requests_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "advertising_recharge_requests_paid_by_user_id_fkey"
  FOREIGN KEY ("paid_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "advertising_recharge_requests_voided_by_user_id_fkey"
  FOREIGN KEY ("voided_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "advertising_recharge_requests_qr_media_asset_id_fkey"
  FOREIGN KEY ("payment_qr_media_asset_id") REFERENCES "media_assets" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "advertising_recharge_requests_proof_media_asset_id_fkey"
  FOREIGN KEY ("payment_proof_media_asset_id") REFERENCES "media_assets" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "advertising_recharge_requests_fund_posting_batch_id_fkey"
  FOREIGN KEY ("fund_posting_batch_id") REFERENCES "fund_posting_batches" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "advertising_recharge_requests_fund_reversal_batch_id_fkey"
  FOREIGN KEY ("fund_reversal_batch_id") REFERENCES "fund_posting_batches" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 申请单号：AD/YYYYMMDD-####，按年重置。驳回/撤回/作废的申请也保留单号。
DO $$
DECLARE
  rule_id UUID;
  version_id UUID;
BEGIN
  INSERT INTO "numbering_rules" (
    "rule_code", "purpose", "name", "description"
  )
  VALUES (
    'ADVERTISING_RECHARGE_NO',
    'BUSINESS',
    '广告账户充值申请编号',
    '用于广告账户充值申请的唯一编号'
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
    'ba9c0acd7c474dcfec0d402873cca5ea8edb85c22421ff556f8101f5590a0dde'
  )
  RETURNING "id" INTO version_id;

  INSERT INTO "numbering_rule_segments" (
    "version_id", "position", "type", "fixed_value", "date_format",
    "separator_value", "sequence_width", "sequence_start_value", "sequence_step"
  )
  VALUES
    (version_id, 0, 'FIXED', 'AD', NULL, NULL, NULL, NULL, NULL),
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

-- 广告充值只授予既有 ADVERTISING_FEE 类型：不改业务类型开关、用户比例或已发布规则。
-- 同码来源已存在时主动失败，避免覆盖管理员已有配置。
INSERT INTO "fund_business_sources" (
  "id", "code", "name", "description", "enabled", "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002429',
  'ADVERTISING_RECHARGE',
  '广告账户充值',
  '广告账户充值申请财务付款后的专用扣款来源',
  true,
  1
);

INSERT INTO "fund_business_source_posting_types" ("business_source_id", "posting_type_id")
SELECT source."id", posting_type."id"
FROM "fund_business_sources" AS source
CROSS JOIN "fund_posting_types" AS posting_type
WHERE source."code" = 'ADVERTISING_RECHARGE'
  AND posting_type."code" = 'ADVERTISING_FEE';

-- 正面付款按申请人的有效分成比例拆两腿；作废只允许同来源同类型的全额反向。
ALTER TABLE "fund_posting_batches" ADD CONSTRAINT "fund_posting_batches_advertising_recharge_shape_check" CHECK (
  "business_source_code_snapshot" IS DISTINCT FROM 'ADVERTISING_RECHARGE'
  OR (
    "posting_type_code_snapshot" = 'ADVERTISING_FEE'
    AND "business_category_snapshot" = 'COST'
    AND "user_id" IS NOT NULL
    AND "actor_user_id" IS NOT NULL
    AND "user_share_rate_snapshot" BETWEEN 0 AND 100
    AND "company_share_rate_snapshot" BETWEEN 0 AND 100
    AND "user_share_rate_snapshot" + "company_share_rate_snapshot" = 100
    AND (
      ("kind" = 'BUSINESS' AND "consumer_code" = 'ADVERTISING_RECHARGE.PAY' AND "business_amount" > 0)
      OR ("kind" = 'REVERSAL' AND "consumer_code" = 'ADVERTISING_RECHARGE.VOID' AND "business_amount" < 0)
    )
  )
);

-- 资金来源投影的可跳转目标白名单必须同步新增单据类型，否则付款批次写入会被拒绝。
ALTER TABLE "fund_posting_batch_sources" DROP CONSTRAINT "fund_posting_batch_sources_link_shape_check";
ALTER TABLE "fund_posting_batch_sources" ADD CONSTRAINT "fund_posting_batch_sources_link_shape_check"
  CHECK (
    ("link_kind" IS NULL AND "link_id" IS NULL)
    OR (
      "link_kind" IN (
        'SALES_ORDER',
        'PURCHASE_ORDER',
        'SALES_RECEIPT',
        'INVOICE_REQUEST',
        'SLH_RECONCILIATION',
        'PACKAGING_COST',
        'SHIPMENT_STORAGE',
        'FUND_WITHDRAWAL',
        'ADVERTISING_RECHARGE'
      )
      AND "link_id" ~ '^[A-Za-z0-9._:-]{1,128}$'
    )
  );

ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'ADVERTISING_RECHARGE_SUBMITTED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'ADVERTISING_RECHARGE_PAID';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'ADVERTISING_RECHARGE_REJECTED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'ADVERTISING_RECHARGE_WITHDRAWN';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'ADVERTISING_RECHARGE_VOIDED';
ALTER TYPE "fund_posting_source_kind" ADD VALUE IF NOT EXISTS 'ADVERTISING_RECHARGE';

-- 运营提交与财务付款各自独立授权；本人读取与财务全量读取分开，避免运营连带获得他人申请。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000002424',
    'network-nodes:read',
    '静态节点：查看',
    '查看网络与广告下的静态节点页面；当前仅占位。',
    false
  ),
  (
    '00000000-0000-4000-8000-000000002425',
    'advertising-recharges:read-self',
    '广告充值：查看本人申请',
    '查看本人提交的广告充值申请、收款二维码与付款结果。',
    false
  ),
  (
    '00000000-0000-4000-8000-000000002426',
    'advertising-recharges:create',
    '广告充值：提交申请',
    '提交广告充值申请，并在待付款阶段撤回本人申请。',
    false
  ),
  (
    '00000000-0000-4000-8000-000000002427',
    'advertising-recharges:read',
    '广告充值：查看全部申请',
    '查看全部广告充值申请、收款二维码与付款凭证。',
    false
  ),
  (
    '00000000-0000-4000-8000-000000002428',
    'advertising-recharges:pay',
    '广告充值：付款与作废',
    '为广告充值申请登记付款金额与付款截图、驳回申请，并对已付款申请整单作废冲正。',
    false
  );

-- 通过稳定 ID 与 code 双重约束目标，避免角色或权限目录漂移时静默授权错误对象。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" IN (
    '00000000-0000-4000-8000-000000002424',
    '00000000-0000-4000-8000-000000002425',
    '00000000-0000-4000-8000-000000002426',
    '00000000-0000-4000-8000-000000002427',
    '00000000-0000-4000-8000-000000002428'
  )
  AND permission."code" IN (
    'network-nodes:read',
    'advertising-recharges:read-self',
    'advertising-recharges:create',
    'advertising-recharges:read',
    'advertising-recharges:pay'
  );

-- 运营持有提交与本人读取；财务持有全量读取与付款。全新库此处可为空集，
-- 既有库按角色码与权限码幂等补齐，不改其它角色。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE (
    (
      role."code" = 'operations_staff'
      AND permission."code" IN (
        'network-nodes:read',
        'advertising-recharges:read-self',
        'advertising-recharges:create'
      )
    )
    OR (
      role."code" = 'finance_staff'
      AND permission."code" IN (
        'advertising-recharges:read',
        'advertising-recharges:pay'
      )
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" AS grant_entry
    WHERE grant_entry."role_id" = role."id"
      AND grant_entry."permission_id" = permission."id"
  );

-- 收款二维码与付款截图进入专用用途白名单，避免临时上传被其它业务域消费。
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_upload_purpose_check";
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_upload_purpose_check"
  CHECK (upload_purpose IS NULL OR upload_purpose IN (
    'PAYMENT_RECIPIENT_QR',
    'PURCHASE_PAYMENT_VOUCHER',
    'PACKAGING_PAYMENT_VOUCHER',
    'OCEAN_FREIGHT_SOURCE_XLSX',
    'SLH_BILL_SOURCE_XLSX',
    'INVOICE_REQUEST_DOCUMENT',
    'FUND_WITHDRAWAL_PAYMENT_PROOF',
    'USER_AVATAR',
    'ADVERTISING_RECHARGE_QR',
    'ADVERTISING_RECHARGE_PAYMENT_PROOF'
  ));

-- 申请单只允许由编号域派发单号，且收款二维码必须是申请人上传的个人户图片。
CREATE FUNCTION "enforce_advertising_recharge_number_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "numbering_issuances" AS issuance
    JOIN "numbering_rules" AS rule ON rule."id" = issuance."rule_id"
    WHERE issuance."id" = NEW."numbering_issuance_id"
      AND issuance."generated_number" = NEW."recharge_no"
      AND issuance."consumer_code" = 'ADVERTISING_RECHARGE.CREATE'
      AND rule."rule_code" = 'ADVERTISING_RECHARGE_NO'
      AND rule."purpose" = 'BUSINESS'
  ) THEN
    RAISE EXCEPTION 'advertising recharge number must match its scoped issuance'
      USING ERRCODE = '23514',
            CONSTRAINT = 'advertising_recharge_requests_number_identity_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "advertising_recharge_requests_identity_trigger"
BEFORE INSERT ON "advertising_recharge_requests"
FOR EACH ROW
EXECUTE FUNCTION "enforce_advertising_recharge_number_identity"();

-- 申请单是资金事实的一部分：单号、账户信息、申请金额与二维码提交后不可改；
-- 只允许 PENDING → PAID/REJECTED/WITHDRAWN 与 PAID → VOIDED 的单向流转。
CREATE FUNCTION "enforce_advertising_recharge_transition"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'advertising recharge requests are immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'advertising_recharge_requests_immutable_check';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."recharge_no" IS DISTINCT FROM OLD."recharge_no"
    OR NEW."numbering_issuance_id" IS DISTINCT FROM OLD."numbering_issuance_id"
    OR NEW."applicant_user_id" IS DISTINCT FROM OLD."applicant_user_id"
    OR NEW."account_type" IS DISTINCT FROM OLD."account_type"
    OR NEW."ad_account_name" IS DISTINCT FROM OLD."ad_account_name"
    OR NEW."ad_account_no" IS DISTINCT FROM OLD."ad_account_no"
    OR NEW."recharge_amount" IS DISTINCT FROM OLD."recharge_amount"
    OR NEW."recharge_currency" IS DISTINCT FROM OLD."recharge_currency"
    OR NEW."payment_qr_media_asset_id" IS DISTINCT FROM OLD."payment_qr_media_asset_id"
    OR NEW."remark" IS DISTINCT FROM OLD."remark"
    OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
    OR NEW."request_key_hash" IS DISTINCT FROM OLD."request_key_hash"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'advertising recharge request identity is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'advertising_recharge_requests_identity_immutable_check';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'advertising recharge request version must advance by one'
      USING ERRCODE = '23514',
            CONSTRAINT = 'advertising_recharge_requests_version_step_check';
  END IF;

  IF NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('PAID', 'REJECTED', 'WITHDRAWN'))
    OR (OLD."status" = 'PAID' AND NEW."status" = 'VOIDED')
  ) THEN
    RAISE EXCEPTION 'advertising recharge request transition is not allowed'
      USING ERRCODE = '23514',
            CONSTRAINT = 'advertising_recharge_requests_transition_check';
  END IF;

  -- 已付款后的唯一变更就是作废；不允许在 VOIDED 上再改金额或冲正批次。
  IF OLD."status" = 'PAID' AND NEW."status" = 'VOIDED' THEN
    IF NEW."payment_amount_cny" IS DISTINCT FROM OLD."payment_amount_cny"
      OR NEW."payment_proof_media_asset_id" IS DISTINCT FROM OLD."payment_proof_media_asset_id"
      OR NEW."paid_at" IS DISTINCT FROM OLD."paid_at"
      OR NEW."paid_by_user_id" IS DISTINCT FROM OLD."paid_by_user_id"
      OR NEW."fund_posting_batch_id" IS DISTINCT FROM OLD."fund_posting_batch_id"
    THEN
      RAISE EXCEPTION 'voiding must not change recorded payment facts'
        USING ERRCODE = '23514',
              CONSTRAINT = 'advertising_recharge_requests_void_identity_check';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "advertising_recharge_requests_transition_trigger"
BEFORE UPDATE OR DELETE ON "advertising_recharge_requests"
FOR EACH ROW
EXECUTE FUNCTION "enforce_advertising_recharge_transition"();

-- 媒体引用保护：READY 资产必须始终有活动业务引用，且广告充值的二维码/截图必须保持 READY
-- 并满足用途与图片形状；引用在事务内延迟校验，先激活媒体再回填引用也能通过。
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
  ELSIF TG_TABLE_NAME = 'user_profiles' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD."avatar_media_asset_id"; ELSE reference_asset_id := NEW."avatar_media_asset_id"; END IF;
  ELSIF TG_TABLE_NAME = 'advertising_recharge_requests' THEN
    IF TG_OP = 'DELETE' THEN
      reference_asset_id := COALESCE(OLD."payment_qr_media_asset_id", OLD."payment_proof_media_asset_id");
    ELSE
      reference_asset_id := COALESCE(NEW."payment_qr_media_asset_id", NEW."payment_proof_media_asset_id");
    END IF;
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
    AND NOT EXISTS (SELECT 1 FROM user_profiles reference WHERE reference.avatar_media_asset_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM advertising_recharge_requests reference WHERE reference.payment_qr_media_asset_id = reference_asset_id OR reference.payment_proof_media_asset_id = reference_asset_id)
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
  IF EXISTS (SELECT 1 FROM user_profiles WHERE avatar_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'USER_AVATAR'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'User avatar must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'user_profiles_avatar_ready_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM advertising_recharge_requests WHERE payment_qr_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'ADVERTISING_RECHARGE_QR'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Advertising recharge QR must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'advertising_recharge_requests_qr_ready_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM advertising_recharge_requests WHERE payment_proof_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'ADVERTISING_RECHARGE_PAYMENT_PROOF'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Advertising recharge payment proof must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'advertising_recharge_requests_proof_ready_check';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "advertising_recharge_requests_media_ready_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "advertising_recharge_requests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_ready_media_asset_reference"();

DO $$
BEGIN
  IF (SELECT count(*) FROM numbering_rules
      WHERE rule_code = 'ADVERTISING_RECHARGE_NO' AND purpose = 'BUSINESS' AND status = 'ENABLED') <> 1
    OR (SELECT count(*) FROM numbering_rule_versions version
        JOIN numbering_rules rule ON rule.id = version.rule_id
        WHERE rule.rule_code = 'ADVERTISING_RECHARGE_NO' AND version.status = 'ACTIVE') <> 1
    OR (SELECT count(*) FROM fund_business_sources
        WHERE code = 'ADVERTISING_RECHARGE' AND enabled AND version = 1) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM fund_business_source_posting_types binding
      JOIN fund_business_sources source ON source.id = binding.business_source_id
      JOIN fund_posting_types posting_type ON posting_type.id = binding.posting_type_id
      WHERE source.code = 'ADVERTISING_RECHARGE' AND posting_type.code = 'ADVERTISING_FEE'
    )
    OR (SELECT count(*) FROM permissions
        WHERE code IN (
          'network-nodes:read',
          'advertising-recharges:read-self',
          'advertising-recharges:create',
          'advertising-recharges:read',
          'advertising-recharges:pay'
        )) <> 5
  THEN
    RAISE EXCEPTION 'advertising recharge migration verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fund_posting_batches_advertising_recharge_shape_check'
  ) THEN
    RAISE EXCEPTION 'advertising recharge batch shape check missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'advertising_recharge_requests_media_ready_trigger'
  ) THEN
    RAISE EXCEPTION 'advertising recharge media reference trigger missing';
  END IF;
END;
$$;
