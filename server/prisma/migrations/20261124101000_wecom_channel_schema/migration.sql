BEGIN;

CREATE TYPE "wecom_app_status" AS ENUM ('PENDING', 'ACTIVE', 'INVALID', 'DISABLED');
CREATE TYPE "wecom_binding_status" AS ENUM ('ACTIVE', 'INVALID', 'DISABLED');
CREATE TYPE "wecom_membership_status" AS ENUM ('ACTIVE', 'INVALID', 'DISABLED');
CREATE TYPE "wecom_membership_source" AS ENUM ('MANUAL', 'AGENT_GET');
CREATE TYPE "wecom_delivery_transport" AS ENUM ('APP', 'ROBOT');
CREATE TYPE "wecom_delivery_status" AS ENUM ('PENDING', 'SENDING', 'ACCEPTED', 'PARTIAL', 'FAILED', 'SKIPPED', 'EXPIRED', 'CANCELLED');

-- 模板字节预算：只有 WECOM 文本模板需要；历史模板保持 NULL。
ALTER TABLE "notification_templates"
  ADD COLUMN "max_bytes" INTEGER;

ALTER TABLE "notification_templates"
  ADD CONSTRAINT "notification_templates_max_bytes_check"
  CHECK ("max_bytes" IS NULL OR "max_bytes" BETWEEN 1 AND 4096);

-- 现有策略形状约束把渠道写死为 IN_APP/ASSISTANT，必须为 WECOM 显式放开。
ALTER TABLE "notification_channel_policies"
  DROP CONSTRAINT "notification_channel_policies_channel_shape_check";

ALTER TABLE "notification_channel_policies"
  ADD CONSTRAINT "notification_channel_policies_channel_shape_check" CHECK (
    (
      "channel" = 'IN_APP'
      AND "target_mode" <> 'GROUP'
      AND "ttl_seconds" IS NULL
      AND "quiet_hours" IS NULL
    )
    OR (
      "channel" IN ('ASSISTANT', 'WECOM')
      AND "ttl_seconds" BETWEEN 60 AND 604800
    )
  );

ALTER TABLE "notification_channel_policies"
  DROP CONSTRAINT "notification_channel_policies_group_channel_check";

ALTER TABLE "notification_channel_policies"
  ADD CONSTRAINT "notification_channel_policies_group_channel_check"
  CHECK ("target_mode" <> 'GROUP' OR "channel" IN ('ASSISTANT', 'WECOM'));

CREATE TABLE "wecom_apps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(32) NOT NULL,
  "name" VARCHAR(32) NOT NULL,
  "corp_id" VARCHAR(64),
  "agent_id" INTEGER,
  "secret_encrypted" TEXT,
  "secret_updated_at" TIMESTAMPTZ(6),
  "secret_updated_by_user_id" UUID,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "status" "wecom_app_status" NOT NULL DEFAULT 'PENDING',
  "last_checked_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(64),
  "last_error_message" VARCHAR(255),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wecom_apps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wecom_apps_key_key" UNIQUE ("key"),
  CONSTRAINT "wecom_apps_corp_agent_key" UNIQUE ("corp_id", "agent_id"),
  CONSTRAINT "wecom_apps_secret_shape_check" CHECK (
    ("secret_encrypted" IS NULL AND "secret_updated_at" IS NULL)
    OR ("secret_encrypted" IS NOT NULL AND "secret_updated_at" IS NOT NULL)
  )
);

-- 默认应用最多一个；Prisma schema 无法表达 partial unique，由数据库兜底。
CREATE UNIQUE INDEX "wecom_apps_default_key"
  ON "wecom_apps" ("is_default")
  WHERE "is_default" = true;

ALTER TABLE "wecom_apps"
  ADD CONSTRAINT "wecom_apps_secret_updated_by_user_id_fkey"
  FOREIGN KEY ("secret_updated_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "wecom_apps_enabled_status_idx" ON "wecom_apps"("enabled", "status");

CREATE TABLE "wecom_app_event_routes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "app_id" UUID NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wecom_app_event_routes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wecom_app_event_routes_event_type_key" UNIQUE ("event_type")
);

ALTER TABLE "wecom_app_event_routes"
  ADD CONSTRAINT "wecom_app_event_routes_app_id_fkey"
  FOREIGN KEY ("app_id") REFERENCES "wecom_apps"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "wecom_app_event_routes"
  ADD CONSTRAINT "wecom_app_event_routes_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "wecom_app_event_routes_app_idx" ON "wecom_app_event_routes"("app_id");

CREATE TABLE "wecom_bindings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "wecom_user_id" VARCHAR(128) NOT NULL,
  "display_name" VARCHAR(128),
  "status" "wecom_binding_status" NOT NULL DEFAULT 'ACTIVE',
  "bound_by_user_id" UUID NOT NULL,
  "verified_at" TIMESTAMPTZ(6),
  "verified_by_user_id" UUID,
  "last_test_sent_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wecom_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wecom_bindings_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "wecom_bindings_wecom_user_id_key" UNIQUE ("wecom_user_id"),
  CONSTRAINT "wecom_bindings_verified_shape_check" CHECK (
    ("verified_at" IS NULL AND "verified_by_user_id" IS NULL)
    OR ("verified_at" IS NOT NULL AND "verified_by_user_id" IS NOT NULL)
  ),
  CONSTRAINT "wecom_bindings_wecom_user_id_shape_check" CHECK (
    "wecom_user_id" = btrim("wecom_user_id") AND length("wecom_user_id") > 0
  )
);

ALTER TABLE "wecom_bindings"
  ADD CONSTRAINT "wecom_bindings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "wecom_bindings"
  ADD CONSTRAINT "wecom_bindings_bound_by_user_id_fkey"
  FOREIGN KEY ("bound_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "wecom_bindings"
  ADD CONSTRAINT "wecom_bindings_verified_by_user_id_fkey"
  FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "wecom_bindings_status_idx" ON "wecom_bindings"("status");

CREATE TABLE "wecom_app_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "app_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "wecom_membership_status" NOT NULL DEFAULT 'ACTIVE',
  "source" "wecom_membership_source" NOT NULL DEFAULT 'MANUAL',
  "verified_at" TIMESTAMPTZ(6),
  "verified_by_user_id" UUID,
  "last_test_sent_at" TIMESTAMPTZ(6),
  "last_synced_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wecom_app_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wecom_app_memberships_app_user_key" UNIQUE ("app_id", "user_id"),
  CONSTRAINT "wecom_app_memberships_verified_shape_check" CHECK (
    ("verified_at" IS NULL AND "verified_by_user_id" IS NULL)
    OR ("verified_at" IS NOT NULL AND "verified_by_user_id" IS NOT NULL)
  )
);

ALTER TABLE "wecom_app_memberships"
  ADD CONSTRAINT "wecom_app_memberships_app_id_fkey"
  FOREIGN KEY ("app_id") REFERENCES "wecom_apps"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "wecom_app_memberships"
  ADD CONSTRAINT "wecom_app_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "wecom_app_memberships"
  ADD CONSTRAINT "wecom_app_memberships_verified_by_user_id_fkey"
  FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "wecom_app_memberships_user_idx" ON "wecom_app_memberships"("user_id");
CREATE INDEX "wecom_app_memberships_status_idx" ON "wecom_app_memberships"("status");

CREATE TABLE "wecom_targets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(64) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "purpose" VARCHAR(255),
  "webhook_key_encrypted" TEXT NOT NULL,
  "internal_only" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_tested_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wecom_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wecom_targets_key_key" UNIQUE ("key"),
  CONSTRAINT "wecom_targets_key_shape_check" CHECK (
    "key" = btrim("key") AND length("key") > 0
  ),
  CONSTRAINT "wecom_targets_internal_only_check" CHECK ("internal_only" = true)
);

CREATE INDEX "wecom_targets_enabled_internal_idx" ON "wecom_targets"("enabled", "internal_only");

CREATE TABLE "wecom_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "notification_id" UUID NOT NULL,
  "app_id" UUID,
  "transport" "wecom_delivery_transport" NOT NULL,
  "recipient_user_id" UUID,
  "target_id" UUID,
  "status" "wecom_delivery_status" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "template_key" VARCHAR(64) NOT NULL,
  "template_version" INTEGER NOT NULL,
  "rendered_content" TEXT NOT NULL,
  "content_sent_at" TIMESTAMPTZ(6),
  "mention_mode" VARCHAR(16),
  "mentioned_count" INTEGER NOT NULL DEFAULT 0,
  "mention_skipped" INTEGER NOT NULL DEFAULT 0,
  "provider_msg_id" VARCHAR(64),
  "failure_code" VARCHAR(64),
  "failure_message" VARCHAR(255),
  "accepted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wecom_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wecom_deliveries_recipient_or_target_check" CHECK (
    (
      "transport" = 'APP'
      AND "app_id" IS NOT NULL
      AND "recipient_user_id" IS NOT NULL
      AND "target_id" IS NULL
    )
    OR (
      "transport" = 'ROBOT'
      AND "app_id" IS NULL
      AND "recipient_user_id" IS NULL
      AND "target_id" IS NOT NULL
    )
  ),
  CONSTRAINT "wecom_deliveries_mention_counts_check" CHECK (
    "mentioned_count" >= 0 AND "mention_skipped" >= 0
  )
);

ALTER TABLE "wecom_deliveries"
  ADD CONSTRAINT "wecom_deliveries_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "wecom_deliveries"
  ADD CONSTRAINT "wecom_deliveries_app_id_fkey"
  FOREIGN KEY ("app_id") REFERENCES "wecom_apps"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "wecom_deliveries"
  ADD CONSTRAINT "wecom_deliveries_recipient_user_id_fkey"
  FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "wecom_deliveries"
  ADD CONSTRAINT "wecom_deliveries_target_id_fkey"
  FOREIGN KEY ("target_id") REFERENCES "wecom_targets"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "wecom_deliveries_status_next_attempt_idx" ON "wecom_deliveries"("status", "next_attempt_at");
CREATE INDEX "wecom_deliveries_notification_idx" ON "wecom_deliveries"("notification_id");
CREATE INDEX "wecom_deliveries_app_status_idx" ON "wecom_deliveries"("app_id", "status");
CREATE INDEX "wecom_deliveries_recipient_created_idx" ON "wecom_deliveries"("recipient_user_id", "created_at" DESC);
CREATE INDEX "wecom_deliveries_target_created_idx" ON "wecom_deliveries"("target_id", "created_at" DESC);

CREATE TABLE "wecom_delivery_media" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "delivery_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "status" "wecom_delivery_status" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "media_id" VARCHAR(128),
  "media_id_expires_at" TIMESTAMPTZ(6),
  "failure_code" VARCHAR(64),
  "failure_message" VARCHAR(255),
  "accepted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wecom_delivery_media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wecom_delivery_media_delivery_sort_key" UNIQUE ("delivery_id", "sort_order")
);

ALTER TABLE "wecom_delivery_media"
  ADD CONSTRAINT "wecom_delivery_media_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "wecom_deliveries"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "wecom_delivery_media"
  ADD CONSTRAINT "wecom_delivery_media_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "wecom_delivery_media_status_next_idx" ON "wecom_delivery_media"("status", "next_attempt_at");
CREATE INDEX "wecom_delivery_media_asset_idx" ON "wecom_delivery_media"("media_asset_id");

CREATE TABLE "wecom_dispatch_leases" (
  "id" VARCHAR(64) NOT NULL,
  "owner_id" UUID,
  "expires_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wecom_dispatch_leases_pkey" PRIMARY KEY ("id")
);

INSERT INTO "notification_channel_settings" ("channel", "enabled", "default_quiet_hours")
VALUES (
  'WECOM',
  false,
  '{"start":"20:00","end":"08:00","timezone":"Asia/Shanghai"}'::jsonb
)
ON CONFLICT ("channel") DO NOTHING;

INSERT INTO "wecom_apps" ("key", "name", "is_default", "enabled", "status")
VALUES ('default', '千树 DMS', true, false, 'PENDING')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "wecom_dispatch_leases" ("id")
VALUES ('wecom-dispatch')
ON CONFLICT ("id") DO NOTHING;

-- MigrationSelfCheck
DO $$
DECLARE
  actual_count integer;
BEGIN
  IF to_regclass('public.wecom_apps') IS NULL
    OR to_regclass('public.wecom_app_event_routes') IS NULL
    OR to_regclass('public.wecom_bindings') IS NULL
    OR to_regclass('public.wecom_app_memberships') IS NULL
    OR to_regclass('public.wecom_targets') IS NULL
    OR to_regclass('public.wecom_deliveries') IS NULL
    OR to_regclass('public.wecom_delivery_media') IS NULL
    OR to_regclass('public.wecom_dispatch_leases') IS NULL THEN
    RAISE EXCEPTION 'wecom channel migration invariant mismatch: table missing';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "notification_channel_settings"
  WHERE "channel" = 'WECOM' AND "enabled" = false;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'wecom channel migration invariant mismatch: channel settings';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "wecom_apps"
  WHERE "key" = 'default' AND "name" = '千树 DMS' AND "is_default" = true;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'wecom channel migration invariant mismatch: default app';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "wecom_dispatch_leases"
  WHERE "id" = 'wecom-dispatch';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'wecom channel migration invariant mismatch: dispatch lease';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "notification_templates"
  WHERE "max_bytes" IS NOT NULL;

  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'wecom channel migration invariant mismatch: unexpected max_bytes backfill';
  END IF;
END $$;

COMMIT;
