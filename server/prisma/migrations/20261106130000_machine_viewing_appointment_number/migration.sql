BEGIN;

-- 看机预约单号：MV/YYYYMMDD-####，按年重置。
-- 本域刚上线，存量行只有联调测试数据；统一回填为 MV/LEGACY-#### 且不绑定 issuance，
-- 新登记必须在同一事务内真实发号并绑定 numbering_issuance_id。
ALTER TABLE "machine_viewing_appointments"
  ADD COLUMN "appointment_no" VARCHAR(64),
  ADD COLUMN "numbering_issuance_id" UUID;

WITH numbered AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS row_number
  FROM "machine_viewing_appointments"
  WHERE "appointment_no" IS NULL
)
UPDATE "machine_viewing_appointments" AS appointment
SET "appointment_no" = 'MV/LEGACY-' || lpad(numbered.row_number::text, 4, '0')
FROM numbered
WHERE appointment."id" = numbered."id";

ALTER TABLE "machine_viewing_appointments"
  ALTER COLUMN "appointment_no" SET NOT NULL,
  ADD CONSTRAINT "machine_viewing_appointments_number_key" UNIQUE ("appointment_no"),
  ADD CONSTRAINT "machine_viewing_appointments_number_format_check"
    CHECK ("appointment_no" ~ '^MV/[A-Z0-9]+-[0-9]{4,}$'),
  ADD CONSTRAINT "machine_viewing_appointments_issuance_key" UNIQUE ("numbering_issuance_id"),
  ADD CONSTRAINT "machine_viewing_appointments_numbering_issuance_id_fkey"
    FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances" ("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 编号规则：MV/YYYYMMDD-####，按年重置，与其它业务单号同一编号域。
DO $$
DECLARE
  rule_id UUID;
  version_id UUID;
BEGIN
  INSERT INTO "numbering_rules" (
    "rule_code", "purpose", "name", "description"
  )
  VALUES (
    'MACHINE_VIEWING_NO',
    'BUSINESS',
    '看机预约编号',
    '用于看机预约的唯一编号'
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
    'd145ae12d9e093a305346e711c38d7a0ba552ab34dcb73b03857f6782d2850fd'
  )
  RETURNING "id" INTO version_id;

  INSERT INTO "numbering_rule_segments" (
    "version_id", "position", "type", "fixed_value", "date_format",
    "separator_value", "sequence_width", "sequence_start_value", "sequence_step"
  )
  VALUES
    (version_id, 0, 'FIXED', 'MV', NULL, NULL, NULL, NULL, NULL),
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

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM "machine_viewing_appointments"
    WHERE "appointment_no" IS NULL
  ) <> 0 THEN
    RAISE EXCEPTION 'machine viewing appointments must all carry a number'
      USING ERRCODE = '23514', CONSTRAINT = 'machine_viewing_appointment_number_check';
  END IF;

  IF (SELECT count(*) FROM "numbering_rules"
      WHERE "rule_code" = 'MACHINE_VIEWING_NO' AND "purpose" = 'BUSINESS' AND "status" = 'ENABLED') <> 1
    OR (SELECT count(*) FROM "numbering_rule_versions" AS version
        JOIN "numbering_rules" AS rule ON rule."id" = version."rule_id"
        WHERE rule."rule_code" = 'MACHINE_VIEWING_NO' AND version."status" = 'ACTIVE') <> 1 THEN
    RAISE EXCEPTION 'machine viewing numbering rule is not enabled'
      USING ERRCODE = '23514', CONSTRAINT = 'machine_viewing_numbering_rule_check';
  END IF;
END $$;

COMMIT;
