-- 资金动账批次接入编号域：批次号不再由应用拼装 UUID，而是来自
-- FUND_POSTING_BATCH_NO 的发号台账；编号身份由数据库触发器兜底。
ALTER TABLE "fund_posting_batches"
  ADD COLUMN "numbering_issuance_id" UUID;

CREATE UNIQUE INDEX "fund_posting_batches_numbering_issuance_id_key"
  ON "fund_posting_batches" ("numbering_issuance_id");

ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_numbering_issuance_id_fkey"
  FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 编号域允许 FIXED/SEPARATOR 组成 '/'，批次号 CHECK 同步到发号台账的字符集。
ALTER TABLE "fund_posting_batches"
  DROP CONSTRAINT "fund_posting_batches_batch_no_format_check";
ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_batch_no_format_check"
  CHECK ("batch_no" ~ '^[A-Z0-9_./-]{1,64}$');

-- 编号规则与 seed 数据集保持一致：FUND/YYYYMMDD-#####，按年重置。
-- 发布于 ACTIVE 版本前必须先写入 DRAFT 版本的 segments（片段触发器只允许 DRAFT 变更）。
DO $$
DECLARE
  rule_id UUID;
  version_id UUID;
BEGIN
  INSERT INTO "numbering_rules" (
    "rule_code", "purpose", "name", "description"
  )
  VALUES (
    'FUND_POSTING_BATCH_NO',
    'BUSINESS',
    '资金动账批次编号',
    '用于资金动账批次编号'
  )
  RETURNING "id" INTO rule_id;

  INSERT INTO "numbering_rule_versions" (
    "rule_id",
    "revision",
    "status",
    "reset_policy",
    "timezone",
    "config_fingerprint"
  )
  VALUES (
    rule_id,
    1,
    'DRAFT',
    'YEARLY',
    'Asia/Shanghai',
    '6ea036fe29baa40b17ab1f93eac2afff4eafbc3fec7242942e09229d3cf7e245'
  )
  RETURNING "id" INTO version_id;

  INSERT INTO "numbering_rule_segments" (
    "version_id",
    "position",
    "type",
    "fixed_value",
    "date_format",
    "separator_value",
    "sequence_width",
    "sequence_start_value",
    "sequence_step"
  )
  VALUES
    (version_id, 0, 'FIXED', 'FUND', NULL, NULL, NULL, NULL, NULL),
    (version_id, 1, 'SEPARATOR', NULL, NULL, '/', NULL, NULL, NULL),
    (version_id, 2, 'DATE', NULL, 'YYYYMMDD', NULL, NULL, NULL, NULL),
    (version_id, 3, 'SEPARATOR', NULL, NULL, '-', NULL, NULL, NULL),
    (version_id, 4, 'SEQUENCE', NULL, NULL, NULL, 5, 1, 1);

  UPDATE "numbering_rule_versions"
  SET
    "status" = 'ACTIVE',
    "published_at" = clock_timestamp()
  WHERE "id" = version_id;

  UPDATE "numbering_rules"
  SET
    "status" = 'ENABLED',
    "version" = 3,
    "updated_at" = clock_timestamp()
  WHERE "id" = rule_id;
END;
$$;

-- 新批次必须携带与 batch_no 完全一致的 FUND_POSTING 发号记录；历史批次是
-- migration 之前的事实，允许 numbering_issuance_id 为空并由换号命令补登记。
CREATE FUNCTION "enforce_fund_posting_batch_number_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "numbering_issuances" AS issuance
    JOIN "numbering_rules" AS rule ON rule."id" = issuance."rule_id"
    WHERE issuance."id" = NEW."numbering_issuance_id"
      AND issuance."generated_number" = NEW."batch_no"
      AND issuance."consumer_code" = 'FUND_POSTING'
      AND rule."rule_code" = 'FUND_POSTING_BATCH_NO'
      AND rule."purpose" = 'BUSINESS'
  ) THEN
    RAISE EXCEPTION 'fund posting batch number must match its scoped issuance'
      USING ERRCODE = '23514',
            CONSTRAINT = 'fund_posting_batches_number_identity_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "fund_posting_batches_number_identity_trigger"
BEFORE INSERT ON "fund_posting_batches"
FOR EACH ROW
EXECUTE FUNCTION "enforce_fund_posting_batch_number_identity"();

-- 批次事实整体不可变；唯一例外是历史换号命令，在同一事务内显式打开
-- qianshu.fund_batch_renumber 后只允许 batch_no / numbering_issuance_id 两个字段变化。
CREATE OR REPLACE FUNCTION "reject_fund_posting_batch_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND current_setting('qianshu.fund_batch_renumber', true) = 'on'
    AND (to_jsonb(NEW) - 'batch_no' - 'numbering_issuance_id')
      = (to_jsonb(OLD) - 'batch_no' - 'numbering_issuance_id')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'fund posting batches are immutable'
    USING ERRCODE = '23514',
          CONSTRAINT = 'fund_posting_batches_immutable_check';
END;
$$;

-- MigrationSelfCheck
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "numbering_rules" AS rule
    JOIN "numbering_rule_versions" AS version
      ON version."rule_id" = rule."id"
      AND version."status" = 'ACTIVE'
    WHERE rule."rule_code" = 'FUND_POSTING_BATCH_NO'
      AND rule."status" = 'ENABLED'
      AND rule."purpose" = 'BUSINESS'
  ) THEN
    RAISE EXCEPTION 'FUND_POSTING_BATCH_NO rule is not enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'fund_posting_batches'
      AND "column_name" = 'numbering_issuance_id'
  ) THEN
    RAISE EXCEPTION 'fund_posting_batches.numbering_issuance_id is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "pg_trigger"
    WHERE "tgname" = 'fund_posting_batches_number_identity_trigger'
      AND NOT "tgisinternal"
  ) THEN
    RAISE EXCEPTION 'fund posting batch number identity trigger is missing';
  END IF;
END;
$$;
