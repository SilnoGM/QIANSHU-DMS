BEGIN;

-- 非个人户充值流程：提交后先进入「补充付款码」，由超级管理员补码后再转「待付款」。
ALTER TYPE "advertising_recharge_status" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT_CODE';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'ADVERTISING_RECHARGE_PAYMENT_CODE_SUPPLEMENTED';

-- 原「广告充值待付款」事件改名为「广告户充值」；历史记录一起改名，
-- 否则历史通知标签会因事件类型不存在而退化成原始 code。
UPDATE "notification_channel_policies"
SET "event_type" = 'ADVERTISING_RECHARGE_PENDING',
    "updated_at" = clock_timestamp()
WHERE "event_type" = 'ADVERTISING_RECHARGE_PAYMENT_PENDING';

UPDATE "notifications"
SET "event_type" = 'ADVERTISING_RECHARGE_PENDING'
WHERE "event_type" = 'ADVERTISING_RECHARGE_PAYMENT_PENDING';

UPDATE "notification_inbox_items"
SET "event_type" = 'ADVERTISING_RECHARGE_PENDING'
WHERE "event_type" = 'ADVERTISING_RECHARGE_PAYMENT_PENDING';

-- 新事件：广告户充值补充付款码。纯文字 + 详情链接，不带附件。
INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'ADVERTISING_RECHARGE_PAYMENT_CODE_REQUIRED',
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
  'ADVERTISING_RECHARGE_PAYMENT_CODE_REQUIRED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

-- MigrationSelfCheck
DO $$
DECLARE
  legacy_count integer;
  renamed_count integer;
  new_policy_count integer;
BEGIN
  SELECT count(*)::integer
  INTO legacy_count
  FROM "notification_channel_policies"
  WHERE "event_type" = 'ADVERTISING_RECHARGE_PAYMENT_PENDING';

  IF legacy_count <> 0 THEN
    RAISE EXCEPTION 'advertising recharge payment code migration invariant mismatch: legacy policies remain';
  END IF;

  SELECT count(*)::integer
  INTO renamed_count
  FROM "notification_channel_policies"
  WHERE "event_type" = 'ADVERTISING_RECHARGE_PENDING'
    AND "channel" IN ('IN_APP', 'ASSISTANT');

  IF renamed_count <> 2 THEN
    RAISE EXCEPTION 'advertising recharge payment code migration invariant mismatch: renamed policies';
  END IF;

  SELECT count(*)::integer
  INTO new_policy_count
  FROM "notification_channel_policies"
  WHERE "event_type" = 'ADVERTISING_RECHARGE_PAYMENT_CODE_REQUIRED'
    AND "channel" IN ('IN_APP', 'ASSISTANT')
    AND "enabled" = true;

  IF new_policy_count <> 2 THEN
    RAISE EXCEPTION 'advertising recharge payment code migration invariant mismatch: new event policies';
  END IF;
END;
$$;

COMMIT;
