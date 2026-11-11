BEGIN;

-- 通知编号由编号域发号：NTF/YYYYMMDD-######，按上海年重置。
-- 历史通知保持 NULL，不伪造编号；新通知由 SystemNotificationService 在同一事务内绑定发号记录。
ALTER TABLE "notifications"
  ADD COLUMN "notification_no" VARCHAR(64),
  ADD COLUMN "numbering_issuance_id" UUID;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_number_key" UNIQUE ("notification_no"),
  ADD CONSTRAINT "notifications_number_format_check"
    CHECK ("notification_no" IS NULL OR "notification_no" ~ '^NTF/[0-9]{8}-[0-9]{6}$'),
  ADD CONSTRAINT "notifications_numbering_issuance_id_key" UNIQUE ("numbering_issuance_id"),
  ADD CONSTRAINT "notifications_numbering_issuance_id_fkey"
    FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances" ("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 编号规则：NTF/YYYYMMDD-######，按年重置。
DO $$
DECLARE
  rule_id UUID;
  version_id UUID;
BEGIN
  INSERT INTO "numbering_rules" (
    "rule_code", "purpose", "name", "description"
  )
  VALUES (
    'NOTIFICATION_NO',
    'BUSINESS',
    '通知编号',
    '用于通知记录的全局唯一编号'
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
    '75b357194ff2ee76a33a43bedb272b64e95eb174fd9cb33b9a8f48f23ca29c97'
  )
  RETURNING "id" INTO version_id;

  INSERT INTO "numbering_rule_segments" (
    "version_id", "position", "type", "fixed_value", "date_format",
    "separator_value", "sequence_width", "sequence_start_value", "sequence_step"
  )
  VALUES
    (version_id, 0, 'FIXED', 'NTF', NULL, NULL, NULL, NULL, NULL),
    (version_id, 1, 'SEPARATOR', NULL, NULL, '/', NULL, NULL, NULL),
    (version_id, 2, 'DATE', NULL, 'YYYYMMDD', NULL, NULL, NULL, NULL),
    (version_id, 3, 'SEPARATOR', NULL, NULL, '-', NULL, NULL, NULL),
    (version_id, 4, 'SEQUENCE', NULL, NULL, NULL, 6, 1, 1);

  UPDATE "numbering_rule_versions"
  SET "status" = 'ACTIVE', "published_at" = clock_timestamp()
  WHERE "id" = version_id;

  UPDATE "numbering_rules"
  SET "status" = 'ENABLED', "version" = 3, "updated_at" = clock_timestamp()
  WHERE "id" = rule_id;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "numbering_rules" AS rule
    JOIN "numbering_rule_versions" AS version ON version."rule_id" = rule."id"
    WHERE rule."rule_code" = 'NOTIFICATION_NO'
      AND rule."purpose" = 'BUSINESS'
      AND rule."status" = 'ENABLED'
      AND version."status" = 'ACTIVE'
      AND version."reset_policy" = 'YEARLY'
  ) THEN
    RAISE EXCEPTION 'notification numbering rule is not enabled'
      USING ERRCODE = '23514', CONSTRAINT = 'notifications_numbering_rule_check';
  END IF;
END $$;

COMMIT;
