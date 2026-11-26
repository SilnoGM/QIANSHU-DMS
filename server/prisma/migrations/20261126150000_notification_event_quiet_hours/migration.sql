BEGIN;

-- 事件渠道静默时段改为显式开关：
-- 1. 所有已保存的 WECOM 渠道统一覆盖为 23:00–08:45，并写入 enabled=true；
-- 2. IN_APP 渠道不受影响；
-- 3. 派发只读事件渠道配置，不再使用 notification_channel_settings.default_quiet_hours。
UPDATE "notification_event_channels"
SET "quiet_hours" = jsonb_build_object(
      'enabled', true,
      'start', '23:00',
      'end', '08:45',
      'timezone', 'Asia/Shanghai'
    ),
    "version" = "version" + 1,
    "updated_at" = now()
WHERE "channel" = 'WECOM';

DO $$
DECLARE
  invalid_count integer;
BEGIN
  SELECT count(*) INTO invalid_count
  FROM "notification_event_channels"
  WHERE "channel" = 'WECOM'
    AND (
      "quiet_hours" IS NULL
      OR jsonb_typeof("quiet_hours") <> 'object'
      OR "quiet_hours" ->> 'enabled' IS DISTINCT FROM 'true'
      OR "quiet_hours" ->> 'start' IS DISTINCT FROM '23:00'
      OR "quiet_hours" ->> 'end' IS DISTINCT FROM '08:45'
      OR "quiet_hours" ->> 'timezone' IS DISTINCT FROM 'Asia/Shanghai'
    );

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'notification WECOM quiet hours backfill incomplete: %', invalid_count
      USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;
