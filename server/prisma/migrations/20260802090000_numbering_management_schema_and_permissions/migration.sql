BEGIN;

-- ExtendAuditEventType
-- 新值只供 migration 提交后的运行时代码使用，避免在同一 PostgreSQL 事务内提前引用。
ALTER TYPE "audit_event_type" ADD VALUE 'NUMBERING_RULE_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'NUMBERING_RULE_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE 'NUMBERING_RULE_VERSION_PUBLISHED';
ALTER TYPE "audit_event_type" ADD VALUE 'NUMBERING_RULE_ENABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'NUMBERING_RULE_DISABLED';

-- CreateEnum
CREATE TYPE "numbering_rule_status" AS ENUM (
  'DRAFT',
  'ENABLED',
  'DISABLED'
);

CREATE TYPE "numbering_rule_version_status" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'RETIRED'
);

CREATE TYPE "numbering_segment_type" AS ENUM (
  'FIXED',
  'DATE',
  'SEPARATOR',
  'SEQUENCE',
  'RANDOM'
);

CREATE TYPE "numbering_reset_policy" AS ENUM (
  'NEVER',
  'YEARLY',
  'MONTHLY',
  'DAILY'
);

CREATE TYPE "numbering_date_format" AS ENUM (
  'YYYY',
  'YY',
  'MM',
  'DD',
  'YYYYMM',
  'YYYYMMDD',
  'YYMMDD'
);

CREATE TYPE "numbering_random_mode" AS ENUM (
  'LETTERS_THEN_DIGITS',
  'SHUFFLED'
);

-- CreateTable
CREATE TABLE "numbering_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "rule_code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "description" VARCHAR(500),
  "status" "numbering_rule_status" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "numbering_rules_rule_code_format_check"
    CHECK ("rule_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "numbering_rules_name_nonblank_check"
    CHECK ("name" !~ '^[[:space:]]*$'),
  CONSTRAINT "numbering_rules_description_nonblank_check"
    CHECK (
      "description" IS NULL
      OR "description" !~ '^[[:space:]]*$'
    ),
  CONSTRAINT "numbering_rules_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "numbering_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "numbering_rule_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "rule_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "numbering_rule_version_status" NOT NULL DEFAULT 'DRAFT',
  "reset_policy" "numbering_reset_policy" NOT NULL,
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  "config_fingerprint" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(6),

  CONSTRAINT "numbering_rule_versions_revision_positive_check"
    CHECK ("revision" >= 1),
  CONSTRAINT "numbering_rule_versions_timezone_check"
    CHECK ("timezone" = 'Asia/Shanghai'),
  CONSTRAINT "numbering_rule_versions_config_fingerprint_check"
    CHECK ("config_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "numbering_rule_versions_published_at_shape_check"
    CHECK (
      (
        "status" = 'DRAFT'
        AND "published_at" IS NULL
      )
      OR (
        "status" IN ('ACTIVE', 'RETIRED')
        AND "published_at" IS NOT NULL
      )
    ),
  CONSTRAINT "numbering_rule_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "numbering_rule_segments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "type" "numbering_segment_type" NOT NULL,
  "fixed_value" VARCHAR(64),
  "date_format" "numbering_date_format",
  "separator_value" CHAR(1),
  "sequence_width" SMALLINT,
  "sequence_start_value" BIGINT,
  "sequence_step" BIGINT,
  "random_letter_length" SMALLINT,
  "random_digit_length" SMALLINT,
  "random_mode" "numbering_random_mode",
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "numbering_rule_segments_position_range_check"
    CHECK ("position" BETWEEN 0 AND 31),
  CONSTRAINT "numbering_rule_segments_shape_check"
    CHECK (
      (
        "type" = 'FIXED'
        AND "fixed_value" IS NOT NULL
        AND "date_format" IS NULL
        AND "separator_value" IS NULL
        AND "sequence_width" IS NULL
        AND "sequence_start_value" IS NULL
        AND "sequence_step" IS NULL
        AND "random_letter_length" IS NULL
        AND "random_digit_length" IS NULL
        AND "random_mode" IS NULL
      )
      OR (
        "type" = 'DATE'
        AND "fixed_value" IS NULL
        AND "date_format" IS NOT NULL
        AND "separator_value" IS NULL
        AND "sequence_width" IS NULL
        AND "sequence_start_value" IS NULL
        AND "sequence_step" IS NULL
        AND "random_letter_length" IS NULL
        AND "random_digit_length" IS NULL
        AND "random_mode" IS NULL
      )
      OR (
        "type" = 'SEPARATOR'
        AND "fixed_value" IS NULL
        AND "date_format" IS NULL
        AND "separator_value" IS NOT NULL
        AND "sequence_width" IS NULL
        AND "sequence_start_value" IS NULL
        AND "sequence_step" IS NULL
        AND "random_letter_length" IS NULL
        AND "random_digit_length" IS NULL
        AND "random_mode" IS NULL
      )
      OR (
        "type" = 'SEQUENCE'
        AND "fixed_value" IS NULL
        AND "date_format" IS NULL
        AND "separator_value" IS NULL
        AND "sequence_width" IS NOT NULL
        AND "sequence_start_value" IS NOT NULL
        AND "sequence_step" IS NOT NULL
        AND "random_letter_length" IS NULL
        AND "random_digit_length" IS NULL
        AND "random_mode" IS NULL
      )
      OR (
        "type" = 'RANDOM'
        AND "fixed_value" IS NULL
        AND "date_format" IS NULL
        AND "separator_value" IS NULL
        AND "sequence_width" IS NULL
        AND "sequence_start_value" IS NULL
        AND "sequence_step" IS NULL
        AND "random_letter_length" IS NOT NULL
        AND "random_digit_length" IS NOT NULL
        AND "random_mode" IS NOT NULL
      )
    ),
  CONSTRAINT "numbering_rule_segments_fixed_value_format_check"
    CHECK (
      "type" <> 'FIXED'
      OR "fixed_value" ~ '^[A-Z0-9]{1,64}$'
    ),
  CONSTRAINT "numbering_rule_segments_separator_value_check"
    CHECK (
      "type" <> 'SEPARATOR'
      OR "separator_value" IN ('-', '_', '.', '/')
    ),
  CONSTRAINT "numbering_rule_segments_sequence_range_check"
    CHECK (
      "type" <> 'SEQUENCE'
      OR (
        "sequence_width" BETWEEN 1 AND 18
        AND "sequence_start_value" >= 0
        AND "sequence_step" >= 1
        AND "sequence_start_value"::numeric
          <= power(10::numeric, "sequence_width") - 1
        AND "sequence_step"::numeric
          <= power(10::numeric, "sequence_width") - 1
      )
    ),
  CONSTRAINT "numbering_rule_segments_random_length_check"
    CHECK (
      "type" <> 'RANDOM'
      OR (
        "random_letter_length" BETWEEN 0 AND 32
        AND "random_digit_length" BETWEEN 0 AND 32
        AND "random_letter_length" + "random_digit_length" BETWEEN 1 AND 32
      )
    ),
  CONSTRAINT "numbering_rule_segments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "numbering_period_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "rule_id" UUID NOT NULL,
  "period_key" VARCHAR(16) NOT NULL,
  "next_sequence_value" BIGINT,
  "used_count" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "numbering_period_states_period_key_format_check"
    CHECK ("period_key" ~ '^(ALL|[0-9]{4}|[0-9]{6}|[0-9]{8})$'),
  CONSTRAINT "numbering_period_states_used_count_nonnegative_check"
    CHECK ("used_count" >= 0),
  CONSTRAINT "numbering_period_states_next_sequence_nonnegative_check"
    CHECK (
      "next_sequence_value" IS NULL
      OR "next_sequence_value" >= 0
    ),
  CONSTRAINT "numbering_period_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "numbering_issuances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "rule_id" UUID NOT NULL,
  "rule_version_id" UUID NOT NULL,
  "period_key" VARCHAR(16) NOT NULL,
  "generated_number" VARCHAR(64) NOT NULL,
  "sequence_value" BIGINT,
  "consumer_code" VARCHAR(64) NOT NULL,
  "idempotency_key_hash" BYTEA NOT NULL,
  "request_fingerprint_hash" BYTEA NOT NULL,
  "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "numbering_issuances_generated_number_format_check"
    CHECK ("generated_number" ~ '^[A-Z0-9_./-]{1,64}$'),
  CONSTRAINT "numbering_issuances_consumer_code_format_check"
    CHECK ("consumer_code" ~ '^[A-Z][A-Z0-9._-]{0,63}$'),
  CONSTRAINT "numbering_issuances_sequence_value_nonnegative_check"
    CHECK (
      "sequence_value" IS NULL
      OR "sequence_value" >= 0
    ),
  CONSTRAINT "numbering_issuances_idempotency_key_hash_32_bytes_check"
    CHECK (octet_length("idempotency_key_hash") = 32),
  CONSTRAINT "numbering_issuances_request_fingerprint_hash_32_bytes_check"
    CHECK (octet_length("request_fingerprint_hash") = 32),
  CONSTRAINT "numbering_issuances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "numbering_rules_rule_code_key"
  ON "numbering_rules" ("rule_code");

CREATE INDEX "numbering_rules_status_updated_at_id_idx"
  ON "numbering_rules" (
    "status",
    "updated_at" DESC,
    "id" DESC
  );

CREATE UNIQUE INDEX "numbering_rule_versions_rule_id_revision_key"
  ON "numbering_rule_versions" ("rule_id", "revision");

CREATE UNIQUE INDEX "numbering_rule_versions_id_rule_id_key"
  ON "numbering_rule_versions" ("id", "rule_id");

CREATE UNIQUE INDEX "numbering_rule_versions_one_active_key"
  ON "numbering_rule_versions" ("rule_id")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "numbering_rule_versions_one_draft_key"
  ON "numbering_rule_versions" ("rule_id")
  WHERE "status" = 'DRAFT';

CREATE INDEX "numbering_rule_versions_rule_id_revision_id_idx"
  ON "numbering_rule_versions" (
    "rule_id",
    "revision" DESC,
    "id" DESC
  );

CREATE UNIQUE INDEX "numbering_rule_segments_version_id_position_key"
  ON "numbering_rule_segments" ("version_id", "position");

CREATE UNIQUE INDEX "numbering_rule_segments_one_sequence_key"
  ON "numbering_rule_segments" ("version_id")
  WHERE "type" = 'SEQUENCE';

CREATE UNIQUE INDEX "numbering_rule_segments_one_random_key"
  ON "numbering_rule_segments" ("version_id")
  WHERE "type" = 'RANDOM';

CREATE UNIQUE INDEX "numbering_period_states_rule_id_period_key_key"
  ON "numbering_period_states" ("rule_id", "period_key");

CREATE UNIQUE INDEX "numbering_issuances_rule_id_generated_number_key"
  ON "numbering_issuances" ("rule_id", "generated_number");

CREATE UNIQUE INDEX "numbering_issuances_consumer_code_idempotency_key_hash_key"
  ON "numbering_issuances" ("consumer_code", "idempotency_key_hash");

CREATE INDEX "numbering_issuances_rule_id_period_key_issued_at_id_idx"
  ON "numbering_issuances" (
    "rule_id",
    "period_key",
    "issued_at" DESC,
    "id" DESC
  );

CREATE INDEX "numbering_issuances_rule_id_issued_at_id_idx"
  ON "numbering_issuances" (
    "rule_id",
    "issued_at" DESC,
    "id" DESC
  );

CREATE INDEX "numbering_issuances_rule_id_consumer_code_issued_at_id_idx"
  ON "numbering_issuances" (
    "rule_id",
    "consumer_code",
    "issued_at" DESC,
    "id" DESC
  );

-- Prisma 使用 raw operator class 映射；migration 仍显式固定真实 PostgreSQL 索引定义。
CREATE INDEX "numbering_issuances_rule_id_generated_number_prefix_idx"
  ON "numbering_issuances" (
    "rule_id",
    "generated_number" varchar_pattern_ops
  );

-- AddForeignKey
ALTER TABLE "numbering_rule_versions"
  ADD CONSTRAINT "numbering_rule_versions_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "numbering_rules" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "numbering_rule_segments"
  ADD CONSTRAINT "numbering_rule_segments_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "numbering_rule_versions" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "numbering_period_states"
  ADD CONSTRAINT "numbering_period_states_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "numbering_rules" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "numbering_issuances"
  ADD CONSTRAINT "numbering_issuances_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "numbering_rules" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "numbering_issuances"
  ADD CONSTRAINT "numbering_issuances_rule_version_id_rule_id_fkey"
  FOREIGN KEY ("rule_version_id", "rule_id")
  REFERENCES "numbering_rule_versions" ("id", "rule_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "numbering_issuances"
  ADD CONSTRAINT "numbering_issuances_rule_id_period_key_fkey"
  FOREIGN KEY ("rule_id", "period_key")
  REFERENCES "numbering_period_states" ("rule_id", "period_key")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

/**
 * 规则 code 是供业务域长期引用的身份，创建后不得修改；规则也不能物理删除，
 * 以免历史版本、周期状态或永久发号台账失去稳定归属。
 */
CREATE FUNCTION "enforce_numbering_rule_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'numbering rule cannot be deleted',
      CONSTRAINT = 'numbering_rules_delete_check';
  END IF;

  IF (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."rule_code" IS DISTINCT FROM OLD."rule_code"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'numbering rule identity is immutable',
      CONSTRAINT = 'numbering_rules_identity_immutable_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "numbering_rules_invariants_trigger"
BEFORE UPDATE OF "id", "rule_code" OR DELETE
ON "numbering_rules"
FOR EACH ROW
EXECUTE FUNCTION "enforce_numbering_rule_invariants"();

/**
 * 版本只允许 DRAFT -> ACTIVE -> RETIRED。发布后的配置、发布时间和身份永久冻结，
 * 使 issuance 记录引用的 revision 始终能够还原实际发号结构。
 */
CREATE FUNCTION "enforce_numbering_rule_version_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'numbering rule version cannot be deleted',
      CONSTRAINT = 'numbering_rule_versions_delete_check';
  END IF;

  IF (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."rule_id" IS DISTINCT FROM OLD."rule_id"
    OR NEW."revision" IS DISTINCT FROM OLD."revision"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'numbering rule version identity is immutable',
      CONSTRAINT = 'numbering_rule_versions_identity_immutable_check';
  END IF;

  IF (
    OLD."status" <> 'DRAFT'
    AND (
      NEW."reset_policy" IS DISTINCT FROM OLD."reset_policy"
      OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
      OR NEW."config_fingerprint" IS DISTINCT FROM OLD."config_fingerprint"
      OR NEW."published_at" IS DISTINCT FROM OLD."published_at"
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'published numbering rule version configuration is immutable',
      CONSTRAINT = 'numbering_rule_versions_config_immutable_check';
  END IF;

  IF NOT (
    NEW."status" = OLD."status"
    OR (
      OLD."status" = 'DRAFT'
      AND NEW."status" = 'ACTIVE'
    )
    OR (
      OLD."status" = 'ACTIVE'
      AND NEW."status" = 'RETIRED'
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'illegal numbering rule version status transition',
      CONSTRAINT = 'numbering_rule_versions_status_transition_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "numbering_rule_versions_invariants_trigger"
BEFORE UPDATE OR DELETE
ON "numbering_rule_versions"
FOR EACH ROW
EXECUTE FUNCTION "enforce_numbering_rule_version_invariants"();

/**
 * 片段写入与发布状态迁移必须互斥。FOR SHARE 会与版本行 UPDATE 冲突，确保检查到
 * DRAFT 后到本语句结束前，父版本不能并发切换为 ACTIVE。
 */
CREATE FUNCTION "enforce_numbering_rule_segment_parent_draft"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "numbering_rule_version_status";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status"
    INTO parent_status
    FROM "numbering_rule_versions"
    WHERE "id" = OLD."version_id"
    FOR SHARE;

    IF parent_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'segments can only mutate under a draft version',
        CONSTRAINT = 'numbering_rule_segments_parent_draft_check';
    END IF;
  END IF;

  IF (
    TG_OP = 'INSERT'
    OR (
      TG_OP = 'UPDATE'
      AND NEW."version_id" IS DISTINCT FROM OLD."version_id"
    )
  ) THEN
    parent_status := NULL;

    SELECT "status"
    INTO parent_status
    FROM "numbering_rule_versions"
    WHERE "id" = NEW."version_id"
    FOR SHARE;

    IF parent_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'segments can only mutate under a draft version',
        CONSTRAINT = 'numbering_rule_segments_parent_draft_check';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "numbering_rule_segments_parent_draft_trigger"
BEFORE INSERT OR UPDATE OR DELETE
ON "numbering_rule_segments"
FOR EACH ROW
EXECUTE FUNCTION "enforce_numbering_rule_segment_parent_draft"();

/**
 * issuance 是永久、不可篡改的发号事实。更正或回收编号不属于 V1 语义，因此任何
 * UPDATE/DELETE 都使用稳定约束名拒绝，不能由运维 SQL 绕过应用边界。
 */
CREATE FUNCTION "enforce_numbering_issuance_immutability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = 'numbering issuance is immutable',
    CONSTRAINT = 'numbering_issuances_immutable_check';
END;
$$;

CREATE TRIGGER "numbering_issuances_immutability_trigger"
BEFORE UPDATE OR DELETE
ON "numbering_issuances"
FOR EACH ROW
EXECUTE FUNCTION "enforce_numbering_issuance_immutability"();

-- Seed the assignable Numbering Management permission catalog with stable identifiers.
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000126',
    'numbering-rules:read',
    '查询编号规则',
    '查询编号规则、版本配置与容量统计',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000127',
    'numbering-rules:create',
    '创建编号规则',
    '创建新的编号规则及草稿配置',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000128',
    'numbering-rules:update',
    '编辑编号规则',
    '编辑编号规则元数据与草稿配置',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000129',
    'numbering-rules:publish',
    '发布编号规则',
    '发布编号规则草稿为活动版本',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000130',
    'numbering-rules:enable',
    '启用编号规则',
    '启用已有活动版本的编号规则',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000131',
    'numbering-rules:disable',
    '停用编号规则',
    '停用编号规则并保留历史发号数据',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000132',
    'numbering-rules:read-issuances',
    '查询编号发放记录',
    '查询编号规则的永久发放记录',
    false
  );

-- 普通业务权限不会被历史 system_only grant 自动覆盖，因此必须显式授予内置管理员。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  '00000000-0000-4000-8000-000000000001',
  "id"
FROM "permissions"
WHERE "code" IN (
  'numbering-rules:read',
  'numbering-rules:create',
  'numbering-rules:update',
  'numbering-rules:publish',
  'numbering-rules:enable',
  'numbering-rules:disable',
  'numbering-rules:read-issuances'
);

/**
 * migration 必须在提交前证明核心边界完整存在。这里只读取 pg_enum.enumlabel 文本，
 * 不在新增 Audit enum value 提交前把新值强制转换成 enum，避免 PostgreSQL unsafe use。
 */
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
      'numbering_rules',
      'numbering_rule_versions',
      'numbering_rule_segments',
      'numbering_period_states',
      'numbering_issuances'
    );

  IF actual_count <> 5 THEN
    RAISE EXCEPTION 'numbering migration invariant mismatch: table count';
  END IF;

  SELECT count(DISTINCT constraint_entry.conname)::integer
  INTO actual_count
  FROM pg_constraint AS constraint_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = constraint_entry.connamespace
  WHERE namespace_entry.nspname = current_schema()
    AND constraint_entry.conname IN (
      'numbering_rules_pkey',
      'numbering_rules_rule_code_format_check',
      'numbering_rules_name_nonblank_check',
      'numbering_rules_description_nonblank_check',
      'numbering_rules_version_positive_check',
      'numbering_rule_versions_pkey',
      'numbering_rule_versions_revision_positive_check',
      'numbering_rule_versions_timezone_check',
      'numbering_rule_versions_config_fingerprint_check',
      'numbering_rule_versions_published_at_shape_check',
      'numbering_rule_versions_rule_id_fkey',
      'numbering_rule_segments_pkey',
      'numbering_rule_segments_position_range_check',
      'numbering_rule_segments_shape_check',
      'numbering_rule_segments_fixed_value_format_check',
      'numbering_rule_segments_separator_value_check',
      'numbering_rule_segments_sequence_range_check',
      'numbering_rule_segments_random_length_check',
      'numbering_rule_segments_version_id_fkey',
      'numbering_period_states_pkey',
      'numbering_period_states_period_key_format_check',
      'numbering_period_states_used_count_nonnegative_check',
      'numbering_period_states_next_sequence_nonnegative_check',
      'numbering_period_states_rule_id_fkey',
      'numbering_issuances_pkey',
      'numbering_issuances_generated_number_format_check',
      'numbering_issuances_consumer_code_format_check',
      'numbering_issuances_sequence_value_nonnegative_check',
      'numbering_issuances_idempotency_key_hash_32_bytes_check',
      'numbering_issuances_request_fingerprint_hash_32_bytes_check',
      'numbering_issuances_rule_id_fkey',
      'numbering_issuances_rule_version_id_rule_id_fkey',
      'numbering_issuances_rule_id_period_key_fkey'
    );

  IF actual_count <> 33 THEN
    RAISE EXCEPTION 'numbering migration invariant mismatch: constraint count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_class AS index_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = index_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND index_entry.relkind = 'i'
    AND index_entry.relname IN (
      'numbering_rules_rule_code_key',
      'numbering_rules_status_updated_at_id_idx',
      'numbering_rule_versions_rule_id_revision_key',
      'numbering_rule_versions_id_rule_id_key',
      'numbering_rule_versions_one_active_key',
      'numbering_rule_versions_one_draft_key',
      'numbering_rule_versions_rule_id_revision_id_idx',
      'numbering_rule_segments_version_id_position_key',
      'numbering_rule_segments_one_sequence_key',
      'numbering_rule_segments_one_random_key',
      'numbering_period_states_rule_id_period_key_key',
      'numbering_issuances_rule_id_generated_number_key',
      'numbering_issuances_consumer_code_idempotency_key_hash_key',
      'numbering_issuances_rule_id_period_key_issued_at_id_idx',
      'numbering_issuances_rule_id_issued_at_id_idx',
      'numbering_issuances_rule_id_consumer_code_issued_at_id_idx',
      'numbering_issuances_rule_id_generated_number_prefix_idx'
    );

  IF actual_count <> 17 THEN
    RAISE EXCEPTION 'numbering migration invariant mismatch: index count';
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
      'numbering_rules_invariants_trigger',
      'numbering_rule_versions_invariants_trigger',
      'numbering_rule_segments_parent_draft_trigger',
      'numbering_issuances_immutability_trigger'
    );

  IF actual_count <> 4 THEN
    RAISE EXCEPTION 'numbering migration invariant mismatch: trigger count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions"
  WHERE "code" LIKE 'numbering-rules:%';

  IF actual_count <> 7 THEN
    RAISE EXCEPTION 'numbering migration invariant mismatch: permission count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_row
  JOIN "permissions" AS permission
    ON permission."id" = grant_row."permission_id"
  WHERE grant_row."role_id" = '00000000-0000-4000-8000-000000000001'
    AND permission."code" LIKE 'numbering-rules:%';

  IF actual_count <> 7 THEN
    RAISE EXCEPTION 'numbering migration invariant mismatch: system admin grants';
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
      'NUMBERING_RULE_CREATED',
      'NUMBERING_RULE_UPDATED',
      'NUMBERING_RULE_VERSION_PUBLISHED',
      'NUMBERING_RULE_ENABLED',
      'NUMBERING_RULE_DISABLED'
    );

  IF actual_count <> 5 THEN
    RAISE EXCEPTION 'numbering migration invariant mismatch: audit event count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "numbering_rules";

  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'numbering migration invariant mismatch: default rule seed';
  END IF;
END;
$$;

COMMIT;
