BEGIN;
-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('IN_APP', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "notification_priority" AS ENUM ('NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'COMPLETED', 'PARTIAL', 'FAILED', 'SKIPPED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "notification_target_mode" AS ENUM ('COMMAND_TARGET', 'USERS', 'ROLE', 'PERMISSION', 'GROUP');

-- CreateEnum
CREATE TYPE "notification_template_kind" AS ENUM ('TEXT', 'LINK');

-- CreateEnum
CREATE TYPE "assistant_account_status" AS ENUM ('ONLINE', 'OFFLINE', 'REQUIRES_LOGIN', 'DISABLED');

-- CreateEnum
CREATE TYPE "assistant_binding_status" AS ENUM ('ACTIVE', 'INVALID', 'DISABLED');

-- CreateEnum
CREATE TYPE "assistant_delivery_status" AS ENUM ('PENDING', 'SENDING', 'ACCEPTED', 'FAILED', 'SKIPPED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type" VARCHAR(64) NOT NULL,
    "source_type" VARCHAR(64) NOT NULL,
    "source_id" VARCHAR(128) NOT NULL,
    "dedupe_key" VARCHAR(200) NOT NULL,
    "priority" "notification_priority" NOT NULL DEFAULT 'NORMAL',
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "template_key" VARCHAR(64) NOT NULL,
    "requested_channels" JSONB NOT NULL DEFAULT '[]',
    "variables" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "requested_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(64) NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "message_kind" "notification_template_kind" NOT NULL DEFAULT 'TEXT',
    "title_template" TEXT,
    "body_template" TEXT NOT NULL,
    "link_url_template" TEXT,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "max_length" INTEGER NOT NULL DEFAULT 2000,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channel_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type" VARCHAR(64) NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "target_mode" "notification_target_mode" NOT NULL DEFAULT 'COMMAND_TARGET',
    "target_config" JSONB NOT NULL DEFAULT '{}',
    "template_key" VARCHAR(64),
    "priority" "notification_priority" NOT NULL DEFAULT 'NORMAL',
    "ttl_seconds" INTEGER,
    "quiet_hours" JSONB,
    "allow_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_channel_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" VARCHAR(32) NOT NULL,
    "notification_retention_days" INTEGER NOT NULL DEFAULT 180,
    "delivery_retention_days" INTEGER NOT NULL DEFAULT 90,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channel_settings" (
    "channel" "notification_channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "default_quiet_hours" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_channel_settings_pkey" PRIMARY KEY ("channel")
);

-- CreateTable
CREATE TABLE "assistant_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(64) NOT NULL,
    "app_id" VARCHAR(128) NOT NULL,
    "wxid" VARCHAR(128),
    "nickname" VARCHAR(128),
    "avatar_url" TEXT,
    "status" "assistant_account_status" NOT NULL DEFAULT 'OFFLINE',
    "region_id" VARCHAR(16),
    "proxy_ip_encrypted" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_online_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(64),
    "last_error_message" VARCHAR(255),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_bindings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "wxid" VARCHAR(128) NOT NULL,
    "wechat_nickname" VARCHAR(128),
    "status" "assistant_binding_status" NOT NULL DEFAULT 'ACTIVE',
    "bound_by_user_id" UUID NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "verified_by_user_id" UUID,
    "friend_checked_at" TIMESTAMPTZ(6),
    "bound_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_targets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(64) NOT NULL,
    "chatroom_id" VARCHAR(128) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "purpose" VARCHAR(255),
    "internal_only" BOOLEAN NOT NULL DEFAULT false,
    "member_count" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "recipient_user_id" UUID,
    "target_id" UUID,
    "account_id" UUID,
    "status" "assistant_delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "template_version" INTEGER NOT NULL,
    "rendered_content" TEXT NOT NULL,
    "provider_msg_id" VARCHAR(64),
    "provider_new_msg_id" VARCHAR(64),
    "failure_code" VARCHAR(64),
    "failure_message" VARCHAR(255),
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_dispatch_leases" (
    "id" VARCHAR(64) NOT NULL,
    "owner_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_dispatch_leases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_event_type_published_idx" ON "notifications"("event_type", "published_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_source_idx" ON "notifications"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "notifications_status_expires_idx" ON "notifications"("status", "expires_at");

-- CreateIndex
CREATE INDEX "notification_templates_channel_enabled_idx" ON "notification_templates"("channel", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_channel_key" ON "notification_templates"("key", "channel");

-- CreateIndex
CREATE INDEX "notification_channel_policies_channel_enabled_idx" ON "notification_channel_policies"("channel", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "notification_channel_policies_event_channel_key" ON "notification_channel_policies"("event_type", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_accounts_app_id_key" ON "assistant_accounts"("app_id");

-- CreateIndex
CREATE INDEX "assistant_accounts_status_enabled_idx" ON "assistant_accounts"("status", "enabled");

-- CreateIndex
CREATE INDEX "assistant_bindings_status_idx" ON "assistant_bindings"("status");

-- CreateIndex
CREATE INDEX "assistant_bindings_user_idx" ON "assistant_bindings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_bindings_user_account_key" ON "assistant_bindings"("user_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_bindings_account_wxid_key" ON "assistant_bindings"("account_id", "wxid");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_targets_key_key" ON "assistant_targets"("key");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_targets_chatroom_id_key" ON "assistant_targets"("chatroom_id");

-- CreateIndex
CREATE INDEX "assistant_targets_enabled_internal_idx" ON "assistant_targets"("enabled", "internal_only");

-- CreateIndex
CREATE INDEX "assistant_deliveries_status_next_attempt_idx" ON "assistant_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "assistant_deliveries_account_status_idx" ON "assistant_deliveries"("account_id", "status");

-- CreateIndex
CREATE INDEX "assistant_deliveries_recipient_created_idx" ON "assistant_deliveries"("recipient_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "assistant_deliveries_target_created_idx" ON "assistant_deliveries"("target_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_channel_policies" ADD CONSTRAINT "notification_channel_policies_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_channel_settings" ADD CONSTRAINT "notification_channel_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_bindings" ADD CONSTRAINT "assistant_bindings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_bindings" ADD CONSTRAINT "assistant_bindings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "assistant_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_bindings" ADD CONSTRAINT "assistant_bindings_bound_by_user_id_fkey" FOREIGN KEY ("bound_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_bindings" ADD CONSTRAINT "assistant_bindings_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_deliveries" ADD CONSTRAINT "assistant_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_deliveries" ADD CONSTRAINT "assistant_deliveries_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_deliveries" ADD CONSTRAINT "assistant_deliveries_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "assistant_targets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_deliveries" ADD CONSTRAINT "assistant_deliveries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "assistant_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- 通知中心补充约束：Prisma schema 无法表达 CHECK 与部分唯一索引。
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_json_shapes_check" CHECK (
    jsonb_typeof("requested_channels") = 'array'
    AND jsonb_typeof("variables") = 'object'
  );

ALTER TABLE "notification_templates"
  ADD CONSTRAINT "notification_templates_max_length_check" CHECK ("max_length" BETWEEN 1 AND 5000),
  ADD CONSTRAINT "notification_templates_link_url_check" CHECK (
    "message_kind" <> 'LINK' OR "link_url_template" IS NOT NULL
  );

ALTER TABLE "notification_channel_policies"
  ADD CONSTRAINT "notification_channel_policies_channel_shape_check" CHECK (
    (
      "channel" = 'IN_APP'
      AND "target_mode" <> 'GROUP'
      AND "ttl_seconds" IS NULL
      AND "quiet_hours" IS NULL
    )
    OR (
      "channel" = 'ASSISTANT'
      AND "ttl_seconds" BETWEEN 60 AND 604800
    )
  ),
  ADD CONSTRAINT "notification_channel_policies_group_channel_check" CHECK (
    "target_mode" <> 'GROUP' OR "channel" = 'ASSISTANT'
  );

ALTER TABLE "notification_settings"
  ADD CONSTRAINT "notification_settings_retention_check" CHECK (
    "notification_retention_days" BETWEEN 7 AND 3650
    AND "delivery_retention_days" BETWEEN 7 AND 3650
  );

ALTER TABLE "assistant_bindings"
  ADD CONSTRAINT "assistant_bindings_verified_shape_check" CHECK (
    ("verified_at" IS NULL AND "verified_by_user_id" IS NULL)
    OR ("verified_at" IS NOT NULL AND "verified_by_user_id" IS NOT NULL)
  );

ALTER TABLE "assistant_targets"
  ADD CONSTRAINT "assistant_targets_member_count_check" CHECK (
    "member_count" IS NULL OR "member_count" >= 0
  );

ALTER TABLE "assistant_deliveries"
  ADD CONSTRAINT "assistant_deliveries_target_exclusive_check" CHECK (
    ("recipient_user_id" IS NOT NULL) <> ("target_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "assistant_deliveries_attempt_count_check" CHECK ("attempt_count" >= 0),
  ADD CONSTRAINT "assistant_deliveries_accepted_shape_check" CHECK (
    "status" <> 'ACCEPTED' OR "accepted_at" IS NOT NULL
  );

CREATE UNIQUE INDEX "assistant_deliveries_notification_recipient_key"
  ON "assistant_deliveries" ("notification_id", "recipient_user_id")
  WHERE "recipient_user_id" IS NOT NULL;

CREATE UNIQUE INDEX "assistant_deliveries_notification_target_key"
  ON "assistant_deliveries" ("notification_id", "target_id")
  WHERE "target_id" IS NOT NULL;

-- 阶段 1 只启用千树小助理；站内渠道行在阶段 3 插入。
INSERT INTO "notification_settings" ("id")
VALUES ('default')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "notification_channel_settings" ("channel", "enabled", "default_quiet_hours")
VALUES (
  'ASSISTANT',
  false,
  '{"start":"20:00","end":"08:00","timezone":"Asia/Shanghai"}'::jsonb
)
ON CONFLICT ("channel") DO NOTHING;

INSERT INTO "assistant_dispatch_leases" ("id")
VALUES ('assistant-dispatch')
ON CONFLICT ("id") DO NOTHING;

COMMIT;
