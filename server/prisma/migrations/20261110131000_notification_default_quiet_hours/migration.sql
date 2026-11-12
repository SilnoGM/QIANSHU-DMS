BEGIN;

-- 业务要求：千树小助理在 22:00–09:00 不发送普通提醒。
UPDATE "notification_channel_settings"
SET "default_quiet_hours" = '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
    "updated_at" = now()
WHERE "channel" = 'ASSISTANT';

COMMIT;
