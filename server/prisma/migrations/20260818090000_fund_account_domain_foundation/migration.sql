BEGIN;

-- ExtendAuditEventType
-- 新值只在 migration 提交后由服务使用；事务内自检只读取 pg_enum 文本。
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_ACCOUNT_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_ACCOUNT_SHARE_RATE_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_POSTING_TYPE_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_POSTING_TYPE_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_POSTING_TYPE_ENABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_POSTING_TYPE_DISABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_POSTING_RULE_PUBLISHED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_BUSINESS_SOURCE_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_BUSINESS_SOURCE_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_BUSINESS_SOURCE_ENABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_BUSINESS_SOURCE_DISABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_MANUAL_ADJUSTMENT_POSTED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_BUSINESS_POSTED';
ALTER TYPE "audit_event_type" ADD VALUE 'FUND_POSTING_REVERSED';

-- CreateFundEnums
CREATE TYPE "fund_account_owner_type" AS ENUM ('USER', 'COMPANY');
CREATE TYPE "fund_business_category" AS ENUM (
  'REVENUE',
  'COST',
  'NEUTRAL',
  'ADJUSTMENT'
);
CREATE TYPE "fund_amount_sign_policy" AS ENUM (
  'POSITIVE_ONLY',
  'NON_ZERO_SIGNED'
);
CREATE TYPE "fund_rule_input_mode" AS ENUM (
  'STANDARD',
  'ADMIN_ADJUSTMENT'
);
CREATE TYPE "fund_posting_rule_status" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'RETIRED'
);
CREATE TYPE "fund_account_target" AS ENUM ('USER', 'COMPANY');
CREATE TYPE "fund_entry_direction" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "fund_direction_policy" AS ENUM (
  'CREDIT',
  'DEBIT',
  'FOLLOW_AMOUNT_SIGN'
);
CREATE TYPE "fund_amount_strategy" AS ENUM (
  'FULL_AMOUNT',
  'USER_SHARE',
  'COMPANY_REMAINDER'
);
CREATE TYPE "fund_adjustment_mode" AS ENUM (
  'USER_ONLY',
  'USER_AND_COMPANY_BY_SHARE'
);
CREATE TYPE "fund_posting_batch_kind" AS ENUM (
  'BUSINESS',
  'MANUAL_ADJUSTMENT',
  'REVERSAL'
);

-- CreateFundTables
CREATE TABLE "fund_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_type" "fund_account_owner_type" NOT NULL,
  "user_id" UUID,
  "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
  "balance" NUMERIC(30, 4) NOT NULL DEFAULT 0,
  "user_share_rate" NUMERIC(7, 4),
  "next_sequence" BIGINT NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "share_rate_updated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fund_accounts_owner_shape_check"
    CHECK (
      (
        "owner_type" = 'USER'
        AND "user_id" IS NOT NULL
        AND "user_share_rate" IS NOT NULL
        AND "share_rate_updated_at" IS NOT NULL
      )
      OR (
        "owner_type" = 'COMPANY'
        AND "user_id" IS NULL
        AND "user_share_rate" IS NULL
        AND "share_rate_updated_at" IS NULL
      )
    ),
  CONSTRAINT "fund_accounts_currency_cny_check"
    CHECK ("currency" = 'CNY'),
  CONSTRAINT "fund_accounts_balance_scale_check"
    CHECK (scale("balance") <= 4),
  CONSTRAINT "fund_accounts_user_share_rate_range_check"
    CHECK (
      "user_share_rate" IS NULL
      OR (
        "user_share_rate" BETWEEN 0 AND 100
        AND scale("user_share_rate") <= 4
      )
    ),
  CONSTRAINT "fund_accounts_next_sequence_positive_check"
    CHECK ("next_sequence" >= 1),
  CONSTRAINT "fund_accounts_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "fund_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fund_business_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "description" VARCHAR(500),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fund_business_sources_code_format_check"
    CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "fund_business_sources_name_nonblank_check"
    CHECK ("name" !~ '^[[:space:]]*$'),
  CONSTRAINT "fund_business_sources_description_nonblank_check"
    CHECK (
      "description" IS NULL
      OR "description" !~ '^[[:space:]]*$'
    ),
  CONSTRAINT "fund_business_sources_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "fund_business_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fund_posting_types" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "description" VARCHAR(500),
  "business_category" "fund_business_category" NOT NULL,
  "requires_user" BOOLEAN NOT NULL,
  "amount_sign_policy" "fund_amount_sign_policy" NOT NULL,
  "input_mode" "fund_rule_input_mode" NOT NULL DEFAULT 'STANDARD',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "current_rule_version_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fund_posting_types_code_format_check"
    CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "fund_posting_types_name_nonblank_check"
    CHECK ("name" !~ '^[[:space:]]*$'),
  CONSTRAINT "fund_posting_types_description_nonblank_check"
    CHECK (
      "description" IS NULL
      OR "description" !~ '^[[:space:]]*$'
    ),
  CONSTRAINT "fund_posting_types_input_mode_shape_check"
    CHECK (
      "input_mode" = 'STANDARD'
      OR (
        "input_mode" = 'ADMIN_ADJUSTMENT'
        AND "business_category" = 'ADJUSTMENT'
        AND "requires_user" = true
        AND "amount_sign_policy" = 'NON_ZERO_SIGNED'
      )
    ),
  CONSTRAINT "fund_posting_types_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "fund_posting_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fund_posting_rule_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "posting_type_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "fund_posting_rule_status" NOT NULL DEFAULT 'DRAFT',
  "created_by_user_id" UUID,
  "published_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(6),

  CONSTRAINT "fund_posting_rule_versions_revision_positive_check"
    CHECK ("revision" >= 1),
  CONSTRAINT "fund_posting_rule_versions_status_shape_check"
    CHECK (
      (
        "status" = 'DRAFT'
        AND "published_at" IS NULL
        AND "published_by_user_id" IS NULL
      )
      OR (
        "status" IN ('ACTIVE', 'RETIRED')
        AND "published_at" IS NOT NULL
      )
    ),
  CONSTRAINT "fund_posting_rule_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fund_posting_rule_legs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "rule_version_id" UUID NOT NULL,
  "position" SMALLINT NOT NULL,
  "account_target" "fund_account_target" NOT NULL,
  "direction_policy" "fund_direction_policy" NOT NULL,
  "amount_strategy" "fund_amount_strategy" NOT NULL,
  "adjustment_mode" "fund_adjustment_mode",
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fund_posting_rule_legs_position_positive_check"
    CHECK ("position" BETWEEN 1 AND 8),
  CONSTRAINT "fund_posting_rule_legs_target_strategy_check"
    CHECK (
      "amount_strategy" = 'FULL_AMOUNT'
      OR (
        "amount_strategy" = 'USER_SHARE'
        AND "account_target" = 'USER'
      )
      OR (
        "amount_strategy" = 'COMPANY_REMAINDER'
        AND "account_target" = 'COMPANY'
      )
    ),
  CONSTRAINT "fund_posting_rule_legs_adjustment_shape_check"
    CHECK (
      "adjustment_mode" IS NULL
      OR (
        "adjustment_mode" = 'USER_ONLY'
        AND "account_target" = 'USER'
        AND "amount_strategy" = 'FULL_AMOUNT'
        AND "direction_policy" = 'FOLLOW_AMOUNT_SIGN'
      )
      OR (
        "adjustment_mode" = 'USER_AND_COMPANY_BY_SHARE'
        AND "direction_policy" = 'FOLLOW_AMOUNT_SIGN'
        AND (
          (
            "account_target" = 'USER'
            AND "amount_strategy" = 'USER_SHARE'
          )
          OR (
            "account_target" = 'COMPANY'
            AND "amount_strategy" = 'COMPANY_REMAINDER'
          )
        )
      )
    ),
  CONSTRAINT "fund_posting_rule_legs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fund_business_source_posting_types" (
  "business_source_id" UUID NOT NULL,
  "posting_type_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fund_business_source_posting_types_pkey"
    PRIMARY KEY ("business_source_id", "posting_type_id")
);

CREATE TABLE "fund_posting_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_no" VARCHAR(64) NOT NULL,
  "kind" "fund_posting_batch_kind" NOT NULL,
  "posting_type_id" UUID NOT NULL,
  "posting_type_code_snapshot" VARCHAR(64) NOT NULL,
  "posting_type_name_snapshot" VARCHAR(128) NOT NULL,
  "business_category_snapshot" "fund_business_category" NOT NULL,
  "business_source_id" UUID NOT NULL,
  "business_source_code_snapshot" VARCHAR(64) NOT NULL,
  "business_source_name_snapshot" VARCHAR(128) NOT NULL,
  "rule_version_id" UUID NOT NULL,
  "rule_revision_snapshot" INTEGER NOT NULL,
  "user_id" UUID,
  "business_amount" NUMERIC(30, 4) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
  "user_share_rate_snapshot" NUMERIC(7, 4),
  "company_share_rate_snapshot" NUMERIC(7, 4),
  "business_id" VARCHAR(128) NOT NULL,
  "business_no" VARCHAR(128),
  "summary" VARCHAR(500) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "business_occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "consumer_code" VARCHAR(64) NOT NULL,
  "idempotency_key_hash" BYTEA NOT NULL,
  "request_fingerprint_hash" BYTEA NOT NULL,
  "adjustment_mode" "fund_adjustment_mode",
  "reversal_of_batch_id" UUID,
  "reversal_reason" VARCHAR(500),
  "actor_user_id" UUID,
  "request_id" VARCHAR(64) NOT NULL,
  "correlation_id" VARCHAR(128),
  "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fund_posting_batches_batch_no_format_check"
    CHECK ("batch_no" ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  CONSTRAINT "fund_posting_batches_snapshot_nonblank_check"
    CHECK (
      "posting_type_code_snapshot" !~ '^[[:space:]]*$'
      AND "posting_type_name_snapshot" !~ '^[[:space:]]*$'
      AND "business_source_code_snapshot" !~ '^[[:space:]]*$'
      AND "business_source_name_snapshot" !~ '^[[:space:]]*$'
      AND "business_id" !~ '^[[:space:]]*$'
      AND "summary" !~ '^[[:space:]]*$'
      AND "request_id" !~ '^[[:space:]]*$'
      AND (
        "business_no" IS NULL
        OR "business_no" !~ '^[[:space:]]*$'
      )
      AND (
        "correlation_id" IS NULL
        OR "correlation_id" !~ '^[[:space:]]*$'
      )
    ),
  CONSTRAINT "fund_posting_batches_rule_revision_positive_check"
    CHECK ("rule_revision_snapshot" >= 1),
  CONSTRAINT "fund_posting_batches_currency_cny_check"
    CHECK ("currency" = 'CNY'),
  CONSTRAINT "fund_posting_batches_business_amount_nonzero_check"
    CHECK ("business_amount" <> 0),
  CONSTRAINT "fund_posting_batches_share_snapshot_check"
    CHECK (
      (
        "user_id" IS NULL
        AND "user_share_rate_snapshot" IS NULL
        AND "company_share_rate_snapshot" IS NULL
      )
      OR (
        "user_id" IS NOT NULL
        AND "user_share_rate_snapshot" BETWEEN 0 AND 100
        AND "company_share_rate_snapshot" BETWEEN 0 AND 100
        AND "user_share_rate_snapshot" + "company_share_rate_snapshot" = 100
      )
    ),
  CONSTRAINT "fund_posting_batches_metadata_object_check"
    CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "fund_posting_batches_consumer_code_format_check"
    CHECK ("consumer_code" ~ '^[A-Z][A-Z0-9_.:-]{0,63}$'),
  CONSTRAINT "fund_posting_batches_hash_length_check"
    CHECK (
      octet_length("idempotency_key_hash") = 32
      AND octet_length("request_fingerprint_hash") = 32
    ),
  CONSTRAINT "fund_posting_batches_kind_shape_check"
    CHECK (
      (
        "kind" = 'BUSINESS'
        AND "adjustment_mode" IS NULL
        AND "reversal_of_batch_id" IS NULL
        AND "reversal_reason" IS NULL
      )
      OR (
        "kind" = 'MANUAL_ADJUSTMENT'
        AND "adjustment_mode" IS NOT NULL
        AND "reversal_of_batch_id" IS NULL
        AND "reversal_reason" IS NULL
        AND "actor_user_id" IS NOT NULL
      )
      OR (
        "kind" = 'REVERSAL'
        AND "adjustment_mode" IS NULL
        AND "reversal_of_batch_id" IS NOT NULL
        AND "reversal_of_batch_id" <> "id"
        AND "reversal_reason" IS NOT NULL
        AND "reversal_reason" !~ '^[[:space:]]*$'
        AND "actor_user_id" IS NOT NULL
      )
    ),
  CONSTRAINT "fund_posting_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fund_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "line_no" SMALLINT NOT NULL,
  "account_id" UUID NOT NULL,
  "direction" "fund_entry_direction" NOT NULL,
  "account_target" "fund_account_target" NOT NULL,
  "amount_strategy" "fund_amount_strategy" NOT NULL,
  "amount" NUMERIC(30, 4) NOT NULL,
  "balance_before" NUMERIC(30, 4) NOT NULL,
  "balance_after" NUMERIC(30, 4) NOT NULL,
  "account_sequence" BIGINT NOT NULL,
  "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fund_ledger_entries_line_no_positive_check"
    CHECK ("line_no" >= 1),
  CONSTRAINT "fund_ledger_entries_amount_positive_check"
    CHECK ("amount" > 0),
  CONSTRAINT "fund_ledger_entries_balance_equation_check"
    CHECK (
      (
        "direction" = 'CREDIT'
        AND "balance_after" = "balance_before" + "amount"
      )
      OR (
        "direction" = 'DEBIT'
        AND "balance_after" = "balance_before" - "amount"
      )
    ),
  CONSTRAINT "fund_ledger_entries_account_sequence_positive_check"
    CHECK ("account_sequence" >= 1),
  CONSTRAINT "fund_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateFundIndexes
CREATE UNIQUE INDEX "fund_accounts_user_id_key"
  ON "fund_accounts" ("user_id");
CREATE UNIQUE INDEX "fund_accounts_one_company_key"
  ON "fund_accounts" ("owner_type")
  WHERE "owner_type" = 'COMPANY';
CREATE INDEX "fund_accounts_owner_type_updated_at_id_idx"
  ON "fund_accounts" ("owner_type", "updated_at" DESC, "id" DESC);
CREATE INDEX "fund_accounts_balance_id_idx"
  ON "fund_accounts" ("balance", "id");

CREATE UNIQUE INDEX "fund_business_sources_code_key"
  ON "fund_business_sources" ("code");
CREATE INDEX "fund_business_sources_enabled_updated_at_id_idx"
  ON "fund_business_sources" ("enabled", "updated_at" DESC, "id" DESC);

CREATE UNIQUE INDEX "fund_posting_types_code_key"
  ON "fund_posting_types" ("code");
CREATE UNIQUE INDEX "fund_posting_types_current_rule_version_id_key"
  ON "fund_posting_types" ("current_rule_version_id");
CREATE UNIQUE INDEX "fund_posting_types_current_rule_version_id_id_key"
  ON "fund_posting_types" ("current_rule_version_id", "id");
CREATE INDEX "fund_posting_types_category_enabled_updated_at_id_idx"
  ON "fund_posting_types" (
    "business_category",
    "enabled",
    "updated_at" DESC,
    "id" DESC
  );

CREATE UNIQUE INDEX "fund_posting_rule_versions_posting_type_id_revision_key"
  ON "fund_posting_rule_versions" ("posting_type_id", "revision");
CREATE UNIQUE INDEX "fund_posting_rule_versions_id_posting_type_id_key"
  ON "fund_posting_rule_versions" ("id", "posting_type_id");
CREATE UNIQUE INDEX "fund_posting_rule_versions_one_active_key"
  ON "fund_posting_rule_versions" ("posting_type_id")
  WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "fund_posting_rule_versions_one_draft_key"
  ON "fund_posting_rule_versions" ("posting_type_id")
  WHERE "status" = 'DRAFT';
CREATE INDEX "fund_posting_rule_versions_type_status_revision_id_idx"
  ON "fund_posting_rule_versions" (
    "posting_type_id",
    "status",
    "revision" DESC,
    "id" DESC
  );

CREATE UNIQUE INDEX "fund_posting_rule_legs_rule_version_id_position_key"
  ON "fund_posting_rule_legs" ("rule_version_id", "position");
CREATE UNIQUE INDEX "fund_posting_rule_legs_standard_target_key"
  ON "fund_posting_rule_legs" ("rule_version_id", "account_target")
  WHERE "adjustment_mode" IS NULL;
CREATE UNIQUE INDEX "fund_posting_rule_legs_adjustment_target_key"
  ON "fund_posting_rule_legs" (
    "rule_version_id",
    "adjustment_mode",
    "account_target"
  )
  WHERE "adjustment_mode" IS NOT NULL;

CREATE INDEX "fund_source_posting_types_type_id_source_id_idx"
  ON "fund_business_source_posting_types" (
    "posting_type_id",
    "business_source_id"
  );

CREATE UNIQUE INDEX "fund_posting_batches_batch_no_key"
  ON "fund_posting_batches" ("batch_no");
CREATE UNIQUE INDEX "fund_posting_batches_consumer_source_idempotency_key"
  ON "fund_posting_batches" (
    "consumer_code",
    "business_source_id",
    "idempotency_key_hash"
  );
CREATE INDEX "fund_posting_batches_posted_at_id_idx"
  ON "fund_posting_batches" ("posted_at" DESC, "id" DESC);
CREATE INDEX "fund_posting_batches_user_id_posted_at_id_idx"
  ON "fund_posting_batches" ("user_id", "posted_at" DESC, "id" DESC);
CREATE INDEX "fund_posting_batches_posting_type_id_posted_at_id_idx"
  ON "fund_posting_batches" (
    "posting_type_id",
    "posted_at" DESC,
    "id" DESC
  );
CREATE INDEX "fund_posting_batches_source_business_id_posted_at_id_idx"
  ON "fund_posting_batches" (
    "business_source_id",
    "business_id",
    "posted_at" DESC,
    "id" DESC
  );
CREATE INDEX "fund_posting_batches_reversal_of_posted_at_id_idx"
  ON "fund_posting_batches" (
    "reversal_of_batch_id",
    "posted_at" DESC,
    "id" DESC
  );

CREATE UNIQUE INDEX "fund_ledger_entries_batch_id_line_no_key"
  ON "fund_ledger_entries" ("batch_id", "line_no");
CREATE UNIQUE INDEX "fund_ledger_entries_account_id_account_sequence_key"
  ON "fund_ledger_entries" ("account_id", "account_sequence");
CREATE INDEX "fund_ledger_entries_account_id_posted_at_id_idx"
  ON "fund_ledger_entries" ("account_id", "posted_at" DESC, "id" DESC);
CREATE INDEX "fund_ledger_entries_batch_id_line_no_id_idx"
  ON "fund_ledger_entries" ("batch_id", "line_no", "id");

-- AddFundForeignKeys
ALTER TABLE "fund_accounts"
  ADD CONSTRAINT "fund_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "fund_posting_rule_versions"
  ADD CONSTRAINT "fund_posting_rule_versions_posting_type_id_fkey"
  FOREIGN KEY ("posting_type_id") REFERENCES "fund_posting_types" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_posting_rule_versions"
  ADD CONSTRAINT "fund_posting_rule_versions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_posting_rule_versions"
  ADD CONSTRAINT "fund_posting_rule_versions_published_by_user_id_fkey"
  FOREIGN KEY ("published_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "fund_posting_types"
  ADD CONSTRAINT "fund_posting_types_current_rule_version_id_id_fkey"
  FOREIGN KEY ("current_rule_version_id", "id")
  REFERENCES "fund_posting_rule_versions" ("id", "posting_type_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "fund_posting_rule_legs"
  ADD CONSTRAINT "fund_posting_rule_legs_rule_version_id_fkey"
  FOREIGN KEY ("rule_version_id")
  REFERENCES "fund_posting_rule_versions" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "fund_business_source_posting_types"
  ADD CONSTRAINT "fund_business_source_posting_types_business_source_id_fkey"
  FOREIGN KEY ("business_source_id")
  REFERENCES "fund_business_sources" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_business_source_posting_types"
  ADD CONSTRAINT "fund_business_source_posting_types_posting_type_id_fkey"
  FOREIGN KEY ("posting_type_id") REFERENCES "fund_posting_types" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_posting_type_id_fkey"
  FOREIGN KEY ("posting_type_id") REFERENCES "fund_posting_types" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_business_source_id_fkey"
  FOREIGN KEY ("business_source_id")
  REFERENCES "fund_business_sources" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_business_source_id_posting_type_id_fkey"
  FOREIGN KEY ("business_source_id", "posting_type_id")
  REFERENCES "fund_business_source_posting_types" (
    "business_source_id",
    "posting_type_id"
  )
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_rule_version_id_posting_type_id_fkey"
  FOREIGN KEY ("rule_version_id", "posting_type_id")
  REFERENCES "fund_posting_rule_versions" ("id", "posting_type_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_reversal_of_batch_id_fkey"
  FOREIGN KEY ("reversal_of_batch_id") REFERENCES "fund_posting_batches" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "fund_ledger_entries"
  ADD CONSTRAINT "fund_ledger_entries_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "fund_posting_batches" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fund_ledger_entries"
  ADD CONSTRAINT "fund_ledger_entries_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "fund_accounts" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- SeedFundPermissions
-- 所有人工资金权限均为系统专用，普通角色不能从管理接口获得这些权限。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000148',
    'fund-accounts:create',
    '新增资金账户',
    '为系统用户创建唯一人民币资金账户',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000149',
    'fund-accounts:update-share-rate',
    '修改资金分成比例',
    '修改用户资金账户的当前分成比例',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000150',
    'fund-accounts:manual-adjust',
    '管理员手动调账',
    '对选定用户账户执行有审计的正负调账',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000151',
    'fund-transactions:reverse',
    '冲正资金批次',
    '对资金批次执行累计部分冲账',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000152',
    'fund-posting-types:manage',
    '管理资金业务类型',
    '维护资金业务类型及其版本化分录规则',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000153',
    'fund-business-sources:manage',
    '管理资金业务来源',
    '维护可信业务来源及其允许的资金业务类型',
    true
  );

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" IN (
    '00000000-0000-4000-8000-000000000148',
    '00000000-0000-4000-8000-000000000149',
    '00000000-0000-4000-8000-000000000150',
    '00000000-0000-4000-8000-000000000151',
    '00000000-0000-4000-8000-000000000152',
    '00000000-0000-4000-8000-000000000153'
  )
  AND permission."code" IN (
    'fund-accounts:create',
    'fund-accounts:update-share-rate',
    'fund-accounts:manual-adjust',
    'fund-transactions:reverse',
    'fund-posting-types:manage',
    'fund-business-sources:manage'
  );

-- SeedCompanyAccountAndConfiguration
-- 只初始化全局公司账户与配置；用户账户、动账批次和流水必须由运行时显式创建。
INSERT INTO "fund_accounts" (
  "id",
  "owner_type",
  "currency",
  "balance",
  "next_sequence",
  "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002001',
  'COMPANY',
  'CNY',
  0,
  1,
  1
);

INSERT INTO "fund_business_sources" (
  "id",
  "code",
  "name",
  "description",
  "enabled",
  "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002101',
  'ADMIN_CONSOLE',
  '管理员工作台',
  '仅供超级管理员发起手动调账',
  true,
  1
);

INSERT INTO "fund_posting_types" (
  "id",
  "code",
  "name",
  "description",
  "business_category",
  "requires_user",
  "amount_sign_policy",
  "input_mode",
  "enabled",
  "version"
)
VALUES
  (
    '00000000-0000-4000-8000-000000002201',
    'ORDER_SETTLEMENT',
    '订单结算',
    '订单盈亏按用户当前分成比例由用户与公司共同承担',
    'REVENUE',
    true,
    'NON_ZERO_SIGNED',
    'STANDARD',
    true,
    1
  ),
  (
    '00000000-0000-4000-8000-000000002202',
    'USER_WITHDRAWAL',
    '用户提款',
    '全部从用户账户扣除',
    'NEUTRAL',
    true,
    'POSITIVE_ONLY',
    'STANDARD',
    true,
    1
  ),
  (
    '00000000-0000-4000-8000-000000002203',
    'PURCHASE_PAYMENT',
    '采购付款',
    '按用户当前分成比例从用户与公司账户扣除',
    'COST',
    true,
    'POSITIVE_ONLY',
    'STANDARD',
    true,
    1
  ),
  (
    '00000000-0000-4000-8000-000000002204',
    'RENT_UTILITIES',
    '房租水电',
    '全部从公司账户扣除',
    'COST',
    false,
    'POSITIVE_ONLY',
    'STANDARD',
    true,
    1
  ),
  (
    '00000000-0000-4000-8000-000000002205',
    'BUSINESS_ACCOUNT_FEE',
    '业务账号费用',
    '按用户当前分成比例从用户与公司账户扣除',
    'COST',
    true,
    'POSITIVE_ONLY',
    'STANDARD',
    true,
    1
  ),
  (
    '00000000-0000-4000-8000-000000002206',
    'ADVERTISING_FEE',
    '广告投放费用',
    '按用户当前分成比例从用户与公司账户扣除',
    'COST',
    true,
    'POSITIVE_ONLY',
    'STANDARD',
    true,
    1
  ),
  (
    '00000000-0000-4000-8000-000000002207',
    'NETWORK_IP_VPN_FEE',
    '网络IP/VPN费用',
    '按用户当前分成比例从用户与公司账户扣除',
    'COST',
    true,
    'POSITIVE_ONLY',
    'STANDARD',
    true,
    1
  ),
  (
    '00000000-0000-4000-8000-000000002208',
    'INVOICE_FEE',
    '开发票费用',
    '按用户当前分成比例从用户与公司账户扣除',
    'COST',
    true,
    'POSITIVE_ONLY',
    'STANDARD',
    true,
    1
  ),
  (
    '00000000-0000-4000-8000-000000002209',
    'ADMIN_MANUAL_ADJUSTMENT',
    '管理员手动调账',
    '支持只调整用户账户或按比例同时调整用户与公司账户',
    'ADJUSTMENT',
    true,
    'NON_ZERO_SIGNED',
    'ADMIN_ADJUSTMENT',
    true,
    1
  );

INSERT INTO "fund_posting_rule_versions" (
  "id",
  "posting_type_id",
  "revision",
  "status",
  "published_at"
)
VALUES
  ('00000000-0000-4000-8000-000000002301', '00000000-0000-4000-8000-000000002201', 1, 'ACTIVE', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000002302', '00000000-0000-4000-8000-000000002202', 1, 'ACTIVE', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000002303', '00000000-0000-4000-8000-000000002203', 1, 'ACTIVE', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000002304', '00000000-0000-4000-8000-000000002204', 1, 'ACTIVE', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000002305', '00000000-0000-4000-8000-000000002205', 1, 'ACTIVE', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000002306', '00000000-0000-4000-8000-000000002206', 1, 'ACTIVE', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000002307', '00000000-0000-4000-8000-000000002207', 1, 'ACTIVE', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000002308', '00000000-0000-4000-8000-000000002208', 1, 'ACTIVE', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000002309', '00000000-0000-4000-8000-000000002209', 1, 'ACTIVE', CURRENT_TIMESTAMP);

INSERT INTO "fund_posting_rule_legs" (
  "id",
  "rule_version_id",
  "position",
  "account_target",
  "direction_policy",
  "amount_strategy",
  "adjustment_mode"
)
VALUES
  ('00000000-0000-4000-8000-000000002401', '00000000-0000-4000-8000-000000002301', 1, 'USER', 'FOLLOW_AMOUNT_SIGN', 'USER_SHARE', NULL),
  ('00000000-0000-4000-8000-000000002402', '00000000-0000-4000-8000-000000002301', 2, 'COMPANY', 'FOLLOW_AMOUNT_SIGN', 'COMPANY_REMAINDER', NULL),
  ('00000000-0000-4000-8000-000000002403', '00000000-0000-4000-8000-000000002302', 1, 'USER', 'DEBIT', 'FULL_AMOUNT', NULL),
  ('00000000-0000-4000-8000-000000002404', '00000000-0000-4000-8000-000000002303', 1, 'USER', 'DEBIT', 'USER_SHARE', NULL),
  ('00000000-0000-4000-8000-000000002405', '00000000-0000-4000-8000-000000002303', 2, 'COMPANY', 'DEBIT', 'COMPANY_REMAINDER', NULL),
  ('00000000-0000-4000-8000-000000002406', '00000000-0000-4000-8000-000000002304', 1, 'COMPANY', 'DEBIT', 'FULL_AMOUNT', NULL),
  ('00000000-0000-4000-8000-000000002407', '00000000-0000-4000-8000-000000002305', 1, 'USER', 'DEBIT', 'USER_SHARE', NULL),
  ('00000000-0000-4000-8000-000000002408', '00000000-0000-4000-8000-000000002305', 2, 'COMPANY', 'DEBIT', 'COMPANY_REMAINDER', NULL),
  ('00000000-0000-4000-8000-000000002409', '00000000-0000-4000-8000-000000002306', 1, 'USER', 'DEBIT', 'USER_SHARE', NULL),
  ('00000000-0000-4000-8000-000000002410', '00000000-0000-4000-8000-000000002306', 2, 'COMPANY', 'DEBIT', 'COMPANY_REMAINDER', NULL),
  ('00000000-0000-4000-8000-000000002411', '00000000-0000-4000-8000-000000002307', 1, 'USER', 'DEBIT', 'USER_SHARE', NULL),
  ('00000000-0000-4000-8000-000000002412', '00000000-0000-4000-8000-000000002307', 2, 'COMPANY', 'DEBIT', 'COMPANY_REMAINDER', NULL),
  ('00000000-0000-4000-8000-000000002413', '00000000-0000-4000-8000-000000002308', 1, 'USER', 'DEBIT', 'USER_SHARE', NULL),
  ('00000000-0000-4000-8000-000000002414', '00000000-0000-4000-8000-000000002308', 2, 'COMPANY', 'DEBIT', 'COMPANY_REMAINDER', NULL),
  ('00000000-0000-4000-8000-000000002415', '00000000-0000-4000-8000-000000002309', 1, 'USER', 'FOLLOW_AMOUNT_SIGN', 'FULL_AMOUNT', 'USER_ONLY'),
  ('00000000-0000-4000-8000-000000002416', '00000000-0000-4000-8000-000000002309', 2, 'USER', 'FOLLOW_AMOUNT_SIGN', 'USER_SHARE', 'USER_AND_COMPANY_BY_SHARE'),
  ('00000000-0000-4000-8000-000000002417', '00000000-0000-4000-8000-000000002309', 3, 'COMPANY', 'FOLLOW_AMOUNT_SIGN', 'COMPANY_REMAINDER', 'USER_AND_COMPANY_BY_SHARE');

INSERT INTO "fund_business_source_posting_types" (
  "business_source_id",
  "posting_type_id"
)
VALUES (
  '00000000-0000-4000-8000-000000002101',
  '00000000-0000-4000-8000-000000002209'
);

UPDATE "fund_posting_types"
SET "current_rule_version_id" = CASE "id"
  WHEN '00000000-0000-4000-8000-000000002201' THEN '00000000-0000-4000-8000-000000002301'::uuid
  WHEN '00000000-0000-4000-8000-000000002202' THEN '00000000-0000-4000-8000-000000002302'::uuid
  WHEN '00000000-0000-4000-8000-000000002203' THEN '00000000-0000-4000-8000-000000002303'::uuid
  WHEN '00000000-0000-4000-8000-000000002204' THEN '00000000-0000-4000-8000-000000002304'::uuid
  WHEN '00000000-0000-4000-8000-000000002205' THEN '00000000-0000-4000-8000-000000002305'::uuid
  WHEN '00000000-0000-4000-8000-000000002206' THEN '00000000-0000-4000-8000-000000002306'::uuid
  WHEN '00000000-0000-4000-8000-000000002207' THEN '00000000-0000-4000-8000-000000002307'::uuid
  WHEN '00000000-0000-4000-8000-000000002208' THEN '00000000-0000-4000-8000-000000002308'::uuid
  WHEN '00000000-0000-4000-8000-000000002209' THEN '00000000-0000-4000-8000-000000002309'::uuid
END
WHERE "id" BETWEEN
  '00000000-0000-4000-8000-000000002201'::uuid
  AND '00000000-0000-4000-8000-000000002209'::uuid;

-- CreateFundInvariantTriggers
CREATE FUNCTION "enforce_fund_account_identity_immutability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fund account deletion is forbidden'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_accounts_delete_forbidden_check';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."owner_type" IS DISTINCT FROM OLD."owner_type"
    OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
  THEN
    RAISE EXCEPTION 'fund account identity is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_accounts_identity_immutable_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "fund_accounts_identity_immutable_trigger"
BEFORE UPDATE OF "id", "owner_type", "user_id", "currency" OR DELETE
ON "fund_accounts"
FOR EACH ROW
EXECUTE FUNCTION "enforce_fund_account_identity_immutability"();

CREATE FUNCTION "enforce_fund_business_source_stability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fund business source deletion is forbidden'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_business_sources_delete_forbidden_check';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'fund business source identity is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_business_sources_identity_immutable_check';
  END IF;

  IF NEW."code" IS DISTINCT FROM OLD."code"
    AND EXISTS (
      SELECT 1
      FROM "fund_posting_batches" AS batch
      WHERE batch."business_source_id" = OLD."id"
    )
  THEN
    RAISE EXCEPTION 'used fund business source code is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_business_sources_code_immutable_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "fund_business_sources_code_immutable_trigger"
BEFORE UPDATE OF "id", "code" OR DELETE
ON "fund_business_sources"
FOR EACH ROW
EXECUTE FUNCTION "enforce_fund_business_source_stability"();

CREATE FUNCTION "enforce_fund_posting_type_stability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fund posting type deletion is forbidden'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_posting_types_delete_forbidden_check';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'fund posting type identity is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_posting_types_identity_immutable_check';
  END IF;

  IF NEW."code" IS DISTINCT FROM OLD."code"
    AND EXISTS (
      SELECT 1
      FROM "fund_posting_batches" AS batch
      WHERE batch."posting_type_id" = OLD."id"
    )
  THEN
    RAISE EXCEPTION 'used fund posting type code is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_posting_types_code_immutable_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "fund_posting_types_code_immutable_trigger"
BEFORE UPDATE OF "id", "code" OR DELETE
ON "fund_posting_types"
FOR EACH ROW
EXECUTE FUNCTION "enforce_fund_posting_type_stability"();

CREATE FUNCTION "enforce_fund_current_rule_version"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  selected_status "fund_posting_rule_status";
BEGIN
  IF NEW."current_rule_version_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT version."status"
  INTO selected_status
  FROM "fund_posting_rule_versions" AS version
  WHERE version."id" = NEW."current_rule_version_id"
    AND version."posting_type_id" = NEW."id";

  IF selected_status IS DISTINCT FROM 'ACTIVE'::"fund_posting_rule_status" THEN
    RAISE EXCEPTION 'current fund rule version must be active'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_posting_types_current_rule_active_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "fund_posting_types_current_rule_guard_trigger"
BEFORE INSERT OR UPDATE OF "current_rule_version_id"
ON "fund_posting_types"
FOR EACH ROW
EXECUTE FUNCTION "enforce_fund_current_rule_version"();

CREATE FUNCTION "enforce_fund_rule_version_immutability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fund rule version deletion is forbidden'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_posting_rule_versions_delete_forbidden_check';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."posting_type_id" IS DISTINCT FROM OLD."posting_type_id"
    OR NEW."revision" IS DISTINCT FROM OLD."revision"
    OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'fund rule version identity is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_posting_rule_versions_immutable_check';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT', 'ACTIVE') THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE'
    AND NEW."status" = 'RETIRED'
    AND NEW."published_by_user_id" IS NOT DISTINCT FROM OLD."published_by_user_id"
    AND NEW."published_at" IS NOT DISTINCT FROM OLD."published_at"
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'published fund rule version is immutable'
    USING ERRCODE = '23514',
          CONSTRAINT = 'fund_posting_rule_versions_immutable_check';
END;
$$;

CREATE TRIGGER "fund_posting_rule_versions_immutable_trigger"
BEFORE UPDATE OR DELETE
ON "fund_posting_rule_versions"
FOR EACH ROW
EXECUTE FUNCTION "enforce_fund_rule_version_immutability"();

CREATE FUNCTION "enforce_fund_rule_leg_parent_draft"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_id UUID;
  parent_status "fund_posting_rule_status";
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE'
    THEN OLD."rule_version_id"
    ELSE NEW."rule_version_id"
  END;

  SELECT version."status"
  INTO parent_status
  FROM "fund_posting_rule_versions" AS version
  WHERE version."id" = parent_id
  FOR KEY SHARE;

  IF parent_status IS DISTINCT FROM 'DRAFT'::"fund_posting_rule_status" THEN
    RAISE EXCEPTION 'fund rule legs require a draft parent'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_posting_rule_legs_parent_guard_check';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "fund_posting_rule_legs_parent_guard_trigger"
BEFORE INSERT OR UPDATE OR DELETE
ON "fund_posting_rule_legs"
FOR EACH ROW
EXECUTE FUNCTION "enforce_fund_rule_leg_parent_draft"();

CREATE FUNCTION "reject_fund_posting_batch_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fund posting batches are immutable'
    USING ERRCODE = '23514',
          CONSTRAINT = 'fund_posting_batches_immutable_check';
END;
$$;

CREATE TRIGGER "fund_posting_batches_immutable_trigger"
BEFORE UPDATE OR DELETE
ON "fund_posting_batches"
FOR EACH ROW
EXECUTE FUNCTION "reject_fund_posting_batch_mutation"();

CREATE FUNCTION "reject_fund_ledger_entry_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fund ledger entries are immutable'
    USING ERRCODE = '23514',
          CONSTRAINT = 'fund_ledger_entries_immutable_check';
END;
$$;

CREATE TRIGGER "fund_ledger_entries_immutable_trigger"
BEFORE UPDATE OR DELETE
ON "fund_ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION "reject_fund_ledger_entry_mutation"();

-- MigrationSelfCheck
-- 迁移在提交前证明核心目录、种子、权限和防篡改边界全部存在。
DO $$
DECLARE
  actual_count INTEGER;
BEGIN
  SELECT count(*)::integer
  INTO actual_count
  FROM pg_class AS table_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = table_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND table_entry.relkind = 'r'
    AND table_entry.relname IN (
      'fund_accounts',
      'fund_business_sources',
      'fund_posting_types',
      'fund_posting_rule_versions',
      'fund_posting_rule_legs',
      'fund_business_source_posting_types',
      'fund_posting_batches',
      'fund_ledger_entries'
    );

  IF actual_count <> 8 THEN
    RAISE EXCEPTION 'fund account domain migration invariant mismatch: table count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_trigger AS trigger_entry
  JOIN pg_class AS table_entry
    ON table_entry.oid = trigger_entry.tgrelid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = table_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND NOT trigger_entry.tgisinternal
    AND trigger_entry.tgname IN (
      'fund_accounts_identity_immutable_trigger',
      'fund_business_sources_code_immutable_trigger',
      'fund_posting_types_code_immutable_trigger',
      'fund_posting_types_current_rule_guard_trigger',
      'fund_posting_rule_versions_immutable_trigger',
      'fund_posting_rule_legs_parent_guard_trigger',
      'fund_posting_batches_immutable_trigger',
      'fund_ledger_entries_immutable_trigger'
    );

  IF actual_count <> 8 THEN
    RAISE EXCEPTION 'fund account domain migration invariant mismatch: trigger count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_enum AS enum_entry
  JOIN pg_type AS type_entry
    ON type_entry.oid = enum_entry.enumtypid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = type_entry.typnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND type_entry.typname = 'audit_event_type'
    AND enum_entry.enumlabel IN (
      'FUND_ACCOUNT_CREATED',
      'FUND_ACCOUNT_SHARE_RATE_UPDATED',
      'FUND_POSTING_TYPE_CREATED',
      'FUND_POSTING_TYPE_UPDATED',
      'FUND_POSTING_TYPE_ENABLED',
      'FUND_POSTING_TYPE_DISABLED',
      'FUND_POSTING_RULE_PUBLISHED',
      'FUND_BUSINESS_SOURCE_CREATED',
      'FUND_BUSINESS_SOURCE_UPDATED',
      'FUND_BUSINESS_SOURCE_ENABLED',
      'FUND_BUSINESS_SOURCE_DISABLED',
      'FUND_MANUAL_ADJUSTMENT_POSTED',
      'FUND_BUSINESS_POSTED',
      'FUND_POSTING_REVERSED'
    );

  IF actual_count <> 14 THEN
    RAISE EXCEPTION 'fund account domain migration invariant mismatch: audit event count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions"
  WHERE "code" LIKE 'fund-%'
    AND "system_only" = true;

  IF actual_count <> 7 THEN
    RAISE EXCEPTION 'fund account domain migration invariant mismatch: permission count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_row
  JOIN "permissions" AS permission
    ON permission."id" = grant_row."permission_id"
  WHERE grant_row."role_id" = '00000000-0000-4000-8000-000000000001'
    AND permission."code" LIKE 'fund-%';

  IF actual_count <> 7 THEN
    RAISE EXCEPTION 'fund account domain migration invariant mismatch: system admin grants';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_row
  JOIN "permissions" AS permission
    ON permission."id" = grant_row."permission_id"
  WHERE grant_row."role_id" <> '00000000-0000-4000-8000-000000000001'
    AND permission."code" LIKE 'fund-%';

  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'fund account domain migration invariant mismatch: exclusive grants';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "fund_accounts"
  WHERE "id" = '00000000-0000-4000-8000-000000002001'
    AND "owner_type" = 'COMPANY'
    AND "currency" = 'CNY'
    AND "balance" = 0
    AND "user_id" IS NULL
    AND "user_share_rate" IS NULL;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'fund account domain migration invariant mismatch: company seed';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "fund_posting_types" AS posting_type
  JOIN "fund_posting_rule_versions" AS version
    ON version."id" = posting_type."current_rule_version_id"
    AND version."posting_type_id" = posting_type."id"
  WHERE version."status" = 'ACTIVE';

  IF actual_count <> 9 THEN
    RAISE EXCEPTION 'fund account domain migration invariant mismatch: active rule seeds';
  END IF;

  SELECT (
    (SELECT count(*) FROM "fund_accounts") = 1
    AND (SELECT count(*) FROM "fund_business_sources") = 1
    AND (SELECT count(*) FROM "fund_posting_types") = 9
    AND (SELECT count(*) FROM "fund_posting_rule_versions") = 9
    AND (SELECT count(*) FROM "fund_posting_rule_legs") = 17
    AND (SELECT count(*) FROM "fund_business_source_posting_types") = 1
    AND (SELECT count(*) FROM "fund_posting_batches") = 0
    AND (SELECT count(*) FROM "fund_ledger_entries") = 0
  )::integer
  INTO actual_count;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'fund account domain migration invariant mismatch: seed counts';
  END IF;
END;
$$;

COMMIT;
