BEGIN;

-- 看机预约改期是独立通知事件：改期提交时立即发送，内容强调原时间与新时间。
-- 按通知中心现行约定，生产不内置默认模板；这里只登记两条渠道策略，
-- 正文由管理员在通知策略页为 `operations.machine-viewing.rescheduled` 配置。
INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'MACHINE_VIEWING_APPOINTMENT_RESCHEDULED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'MACHINE_VIEWING_APPOINTMENT_RESCHEDULED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"08:30","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

-- 8:30 批量通知不能被 22:00–09:00 的默认静默挡到 9 点；结束时间改为 08:30。
-- 这是本事件明确要求的发送时刻，迁移按事件覆盖静默结束值，其余策略字段保持不变。
UPDATE "notification_channel_policies"
SET "quiet_hours" = '{"start":"22:00","end":"08:30","timezone":"Asia/Shanghai"}'::jsonb,
    "updated_at" = clock_timestamp()
WHERE "event_type" = 'MACHINE_VIEWING_APPOINTMENT_CREATED'
  AND "channel" = 'ASSISTANT';

-- MigrationSelfCheck
DO $$
DECLARE
  policy_count integer;
  created_quiet_end text;
BEGIN
  SELECT count(*)::integer
  INTO policy_count
  FROM "notification_channel_policies"
  WHERE "event_type" = 'MACHINE_VIEWING_APPOINTMENT_RESCHEDULED'
    AND "channel" IN ('IN_APP', 'ASSISTANT')
    AND "enabled" = true;

  IF policy_count <> 2 THEN
    RAISE EXCEPTION 'machine viewing reschedule notification migration invariant mismatch: policies';
  END IF;

  SELECT policy."quiet_hours"->>'end'
  INTO created_quiet_end
  FROM "notification_channel_policies" AS policy
  WHERE policy."event_type" = 'MACHINE_VIEWING_APPOINTMENT_CREATED'
    AND policy."channel" = 'ASSISTANT';

  IF created_quiet_end IS DISTINCT FROM '08:30' THEN
    RAISE EXCEPTION 'machine viewing created policy quiet hours were not updated';
  END IF;
END;
$$;

COMMIT;
