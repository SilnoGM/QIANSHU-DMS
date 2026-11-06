BEGIN;

-- 看机预约状态与反馈：本期只落地字段与展示，状态流转/反馈写入入口另行设计。
-- 存量行统一落到「待预约」；反馈为空表示尚未反馈。
CREATE TYPE "machine_viewing_status" AS ENUM (
  'PENDING_APPOINTMENT',
  'APPOINTED',
  'FEEDBACK_GIVEN',
  'CANCELLED'
);

ALTER TABLE "machine_viewing_appointments"
  ADD COLUMN "status" "machine_viewing_status" NOT NULL DEFAULT 'PENDING_APPOINTMENT',
  ADD COLUMN "feedback" VARCHAR(500);

ALTER TABLE "machine_viewing_appointments"
  ADD CONSTRAINT "machine_viewing_appointments_feedback_shape_check"
    CHECK ("feedback" IS NULL OR ("feedback" = btrim("feedback") AND length("feedback") > 0));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "machine_viewing_appointments" WHERE "status" IS NULL
  ) THEN
    RAISE EXCEPTION 'machine viewing appointments must all carry a status'
      USING ERRCODE = '23514', CONSTRAINT = 'machine_viewing_status_check';
  END IF;
END $$;

COMMIT;
