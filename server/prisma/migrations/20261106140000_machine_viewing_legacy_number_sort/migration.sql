BEGIN;

-- 编号规则上线前的存量行由前一条迁移回填为 MV/LEGACY-####。
-- 字母前缀在字符串倒序里排在日期前缀之后，会让这些历史测试行永远置顶；
-- 统一改为 MV/00000000-####，保证「按编号最新排序」始终把真实登记排在前面。
WITH legacy AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS row_number
  FROM "machine_viewing_appointments"
  WHERE "appointment_no" LIKE 'MV/LEGACY-%'
)
UPDATE "machine_viewing_appointments" AS appointment
SET "appointment_no" = 'MV/00000000-' || lpad(legacy.row_number::text, 4, '0')
FROM legacy
WHERE appointment."id" = legacy."id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "machine_viewing_appointments" WHERE "appointment_no" LIKE 'MV/LEGACY-%'
  ) THEN
    RAISE EXCEPTION 'legacy machine viewing numbers must be renumbered'
      USING ERRCODE = '23514', CONSTRAINT = 'machine_viewing_legacy_number_check';
  END IF;
END $$;

COMMIT;
