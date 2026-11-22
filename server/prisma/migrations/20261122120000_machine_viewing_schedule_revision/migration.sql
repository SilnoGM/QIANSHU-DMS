BEGIN;

-- 看机预约通知从「创建即发」改为「预约当天 8:30 发」，改期后需要重新进入待通知。
-- 通知去重键按 schedule_revision 区分：同一排期只通知一次，改期后可合法重发。
ALTER TABLE "machine_viewing_appointments"
  ADD COLUMN "schedule_revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "machine_viewing_appointments"
  ADD CONSTRAINT "machine_viewing_appointments_schedule_revision_check"
    CHECK ("schedule_revision" >= 1);

-- 改期是独立业务事实，和普通编辑分开审计。
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'MACHINE_VIEWING_APPOINTMENT_RESCHEDULED';

-- MigrationSelfCheck
DO $$
DECLARE
  column_count integer;
  constraint_count integer;
BEGIN
  SELECT count(*)::integer
  INTO column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'machine_viewing_appointments'
    AND column_name = 'schedule_revision'
    AND data_type = 'integer'
    AND is_nullable = 'NO'
    AND column_default = '1';

  IF column_count <> 1 THEN
    RAISE EXCEPTION 'machine viewing schedule revision migration invariant mismatch: column';
  END IF;

  SELECT count(*)::integer
  INTO constraint_count
  FROM pg_constraint AS constraint_entry
  JOIN pg_class AS table_entry ON table_entry.oid = constraint_entry.conrelid
  WHERE table_entry.relname = 'machine_viewing_appointments'
    AND constraint_entry.conname = 'machine_viewing_appointments_schedule_revision_check';

  IF constraint_count <> 1 THEN
    RAISE EXCEPTION 'machine viewing schedule revision migration invariant mismatch: check';
  END IF;
END;
$$;

COMMIT;
