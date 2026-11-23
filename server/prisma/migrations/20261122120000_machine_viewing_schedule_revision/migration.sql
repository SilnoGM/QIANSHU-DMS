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
  -- E2E 会在隔离 schema 里重放迁移，自校验必须跟随当前 search_path 的首个 schema。
  WHERE table_schema = current_schema()
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
  JOIN pg_namespace AS schema_entry ON schema_entry.oid = table_entry.relnamespace
  -- 同名表可能同时存在于 public 与隔离 schema，只统计当前 schema 才能避免误判。
  WHERE schema_entry.nspname = current_schema()
    AND table_entry.relname = 'machine_viewing_appointments'
    AND constraint_entry.conname = 'machine_viewing_appointments_schedule_revision_check';

  IF constraint_count <> 1 THEN
    RAISE EXCEPTION 'machine viewing schedule revision migration invariant mismatch: check';
  END IF;
END;
$$;

COMMIT;
