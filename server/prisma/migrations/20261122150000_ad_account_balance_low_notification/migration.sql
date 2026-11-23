BEGIN;

-- 广告户余额预警是独立通知事件：同步任务发现可用余额跌穿阈值时立即发送。
-- 按通知中心现行约定，生产不内置默认模板；这里只登记两条渠道策略，
-- 正文由管理员在通知策略页为 `operations.ad-account.balance-low` 配置。
INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'AD_ACCOUNT_BALANCE_LOW',
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
  'AD_ACCOUNT_BALANCE_LOW',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

-- MigrationSelfCheck
DO $$
DECLARE
  policy_count integer;
BEGIN
  SELECT count(*)::integer
  INTO policy_count
  FROM "notification_channel_policies"
  WHERE "event_type" = 'AD_ACCOUNT_BALANCE_LOW'
    AND "channel" IN ('IN_APP', 'ASSISTANT')
    AND "enabled" = true
    AND "target_mode" = 'COMMAND_TARGET'
    AND "allow_sensitive" = true;

  IF policy_count <> 2 THEN
    RAISE EXCEPTION 'ad account balance notification migration invariant mismatch: policies';
  END IF;
END;
$$;

COMMIT;
