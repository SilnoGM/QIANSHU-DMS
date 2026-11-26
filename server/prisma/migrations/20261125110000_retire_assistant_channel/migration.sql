BEGIN;

-- 千树小助理渠道退役：按依赖顺序删表，表内投递、绑定、账号、群目标与租约数据
-- 随表删除；IF EXISTS 让中断后重跑可以继续完成剩余步骤。
DROP TABLE IF EXISTS "assistant_delivery_media";
DROP TABLE IF EXISTS "assistant_deliveries";
DROP TABLE IF EXISTS "assistant_bindings";
DROP TABLE IF EXISTS "assistant_targets";
DROP TABLE IF EXISTS "assistant_accounts";
DROP TABLE IF EXISTS "assistant_dispatch_leases";
DROP TABLE IF EXISTS "assistant_send_gates";

-- 仅保留助理渠道的历史通知一并删除：没有任何站内收件或企业微信交付时，
-- 删除后不会在记录页留下无法解释的空渠道记录；仍含其他渠道的通知只清理
-- requested_channels 中的 ASSISTANT 标记。
DELETE FROM "notifications"
WHERE "requested_channels" @> '["ASSISTANT"]'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM "notification_inbox_items"
    WHERE "notification_inbox_items"."notification_id" = "notifications"."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "wecom_deliveries"
    WHERE "wecom_deliveries"."notification_id" = "notifications"."id"
  );

UPDATE "notifications"
SET "requested_channels" = "requested_channels" - 'ASSISTANT'
WHERE "requested_channels" @> '["ASSISTANT"]'::jsonb;

DELETE FROM "notification_user_mutes" WHERE "channel"::text = 'ASSISTANT';
DELETE FROM "notification_channel_settings" WHERE "channel"::text = 'ASSISTANT';
DELETE FROM "notification_channel_policies" WHERE "channel"::text = 'ASSISTANT';
DELETE FROM "notification_templates" WHERE "channel"::text = 'ASSISTANT';

-- PostgreSQL 不支持直接删除枚举值；重建类型。涉及 channel 的唯一索引与主键
-- 会在 ALTER COLUMN TYPE 重建时比较新旧枚举，必须先移除再恢复。
DROP INDEX IF EXISTS "notification_templates_channel_enabled_idx";
DROP INDEX IF EXISTS "notification_templates_key_channel_key";
DROP INDEX IF EXISTS "notification_channel_policies_channel_enabled_idx";
DROP INDEX IF EXISTS "notification_channel_policies_event_channel_key";
ALTER TABLE "notification_channel_settings"
  DROP CONSTRAINT IF EXISTS "notification_channel_settings_pkey";
ALTER TABLE "notification_user_mutes"
  DROP CONSTRAINT IF EXISTS "notification_user_mutes_user_event_channel_key";
ALTER TABLE "notification_channel_policies"
  DROP CONSTRAINT IF EXISTS "notification_channel_policies_channel_shape_check";
ALTER TABLE "notification_channel_policies"
  DROP CONSTRAINT IF EXISTS "notification_channel_policies_group_channel_check";

ALTER TYPE "notification_channel" RENAME TO "notification_channel_retired";
CREATE TYPE "notification_channel" AS ENUM ('IN_APP', 'WECOM');

ALTER TABLE "notification_templates"
  ALTER COLUMN "channel" TYPE "notification_channel"
  USING ("channel"::text::"notification_channel");
ALTER TABLE "notification_channel_policies"
  ALTER COLUMN "channel" TYPE "notification_channel"
  USING ("channel"::text::"notification_channel");
ALTER TABLE "notification_channel_settings"
  ALTER COLUMN "channel" TYPE "notification_channel"
  USING ("channel"::text::"notification_channel");
ALTER TABLE "notification_user_mutes"
  ALTER COLUMN "channel" TYPE "notification_channel"
  USING ("channel"::text::"notification_channel");

DROP TYPE "notification_channel_retired";

ALTER TABLE "notification_channel_settings"
  ADD CONSTRAINT "notification_channel_settings_pkey" PRIMARY KEY ("channel");
ALTER TABLE "notification_user_mutes"
  ADD CONSTRAINT "notification_user_mutes_user_event_channel_key"
  UNIQUE ("user_id", "event_type", "channel");
CREATE INDEX "notification_templates_channel_enabled_idx"
  ON "notification_templates"("channel", "enabled");
CREATE UNIQUE INDEX "notification_templates_key_channel_key"
  ON "notification_templates"("key", "channel");
CREATE INDEX "notification_channel_policies_channel_enabled_idx"
  ON "notification_channel_policies"("channel", "enabled");
CREATE UNIQUE INDEX "notification_channel_policies_event_channel_key"
  ON "notification_channel_policies"("event_type", "channel");

-- 渠道形状约束原先显式引用 ASSISTANT，随枚举重建改为只允许 IN_APP/WECOM。
ALTER TABLE "notification_channel_policies"
  ADD CONSTRAINT "notification_channel_policies_channel_shape_check" CHECK (
    (
      "channel" = 'IN_APP'
      AND "target_mode" <> 'GROUP'
      AND "ttl_seconds" IS NULL
      AND "quiet_hours" IS NULL
    )
    OR (
      "channel" = 'WECOM'
      AND "ttl_seconds" BETWEEN 60 AND 604800
    )
  );
ALTER TABLE "notification_channel_policies"
  ADD CONSTRAINT "notification_channel_policies_group_channel_check"
  CHECK ("target_mode" <> 'GROUP' OR "channel" = 'WECOM');

-- 助理专属权限与角色授权一并清理。
DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  SELECT "id" FROM "permissions" WHERE "code" LIKE 'assistant-%'
);
DELETE FROM "permissions" WHERE "code" LIKE 'assistant-%';

-- 自校验：防止部分迁移成功后在重跑时留下残留。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pg_tables"
    WHERE "schemaname" = current_schema()
      AND "tablename" LIKE 'assistant\_%'
  ) THEN
    RAISE EXCEPTION 'assistant tables still exist after retirement migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "pg_enum" AS enum
    JOIN "pg_type" AS type ON type."oid" = enum."enumtypid"
    JOIN "pg_namespace" AS namespace ON namespace."oid" = type."typnamespace"
    WHERE namespace."nspname" = current_schema()
      AND type."typname" = 'notification_channel'
      AND enum."enumlabel" = 'ASSISTANT'
  ) THEN
    RAISE EXCEPTION 'ASSISTANT enum label still exists on notification_channel';
  END IF;

  IF EXISTS (SELECT 1 FROM "permissions" WHERE "code" LIKE 'assistant-%') THEN
    RAISE EXCEPTION 'assistant permissions still exist after retirement migration';
  END IF;

  IF EXISTS (SELECT 1 FROM "notification_templates" WHERE "channel"::text = 'ASSISTANT') THEN
    RAISE EXCEPTION 'assistant templates still exist after retirement migration';
  END IF;

  IF EXISTS (SELECT 1 FROM "notification_channel_policies" WHERE "channel"::text = 'ASSISTANT') THEN
    RAISE EXCEPTION 'assistant policies still exist after retirement migration';
  END IF;

  IF EXISTS (SELECT 1 FROM "notification_channel_settings" WHERE "channel"::text = 'ASSISTANT') THEN
    RAISE EXCEPTION 'assistant channel settings still exist after retirement migration';
  END IF;

  IF EXISTS (SELECT 1 FROM "notification_user_mutes" WHERE "channel"::text = 'ASSISTANT') THEN
    RAISE EXCEPTION 'assistant user mutes still exist after retirement migration';
  END IF;
END $$;

COMMIT;
