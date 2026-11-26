BEGIN;

CREATE TYPE "notification_send_method" AS ENUM ('IN_APP', 'APP', 'ROBOT');
CREATE TYPE "notification_message_kind" AS ENUM (
  'TEXT',
  'MARKDOWN',
  'MARKDOWN_V2',
  'IMAGE',
  'VOICE',
  'VIDEO',
  'FILE',
  'TEXTCARD',
  'NEWS',
  'MPNEWS',
  'MINIPROGRAM_NOTICE',
  'TEMPLATE_CARD',
  'INTERACTIVE_TASKCARD'
);

-- 事件 × 渠道的唯一配置；发送方式二选一由 channel + send_method 约束表达。
CREATE TABLE "notification_event_channels" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_type" VARCHAR(64) NOT NULL,
  "channel" "notification_channel" NOT NULL,
  "send_method" "notification_send_method" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "target_mode" "notification_target_mode" NOT NULL DEFAULT 'COMMAND_TARGET',
  "target_config" JSONB NOT NULL DEFAULT '{}',
  "ttl_seconds" INTEGER,
  "quiet_hours" JSONB,
  "allow_sensitive" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_event_channels_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_event_channels_event_channel_key" UNIQUE ("event_type", "channel"),
  CONSTRAINT "notification_event_channels_channel_method_check" CHECK (
    ("channel" = 'IN_APP' AND "send_method" = 'IN_APP')
    OR ("channel" = 'WECOM' AND "send_method" IN ('APP', 'ROBOT'))
  ),
  CONSTRAINT "notification_event_channels_target_mode_check" CHECK (
    ("send_method" = 'ROBOT' AND "target_mode" = 'GROUP')
    OR ("send_method" <> 'ROBOT' AND "target_mode" <> 'GROUP')
  ),
  CONSTRAINT "notification_event_channels_channel_shape_check" CHECK (
    ("channel" = 'WECOM')
    OR (
      "channel" = 'IN_APP'
      AND "ttl_seconds" IS NULL
      AND "quiet_hours" IS NULL
      AND "allow_sensitive" = false
    )
  ),
  CONSTRAINT "notification_event_channels_ttl_check" CHECK (
    "ttl_seconds" IS NULL OR "ttl_seconds" BETWEEN 60 AND 604800
  ),
  CONSTRAINT "notification_event_channels_version_check" CHECK ("version" >= 1)
);

ALTER TABLE "notification_event_channels"
  ADD CONSTRAINT "notification_event_channels_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "notification_event_channels_method_enabled_idx"
  ON "notification_event_channels"("channel", "send_method", "enabled");

-- 渠道配置内部的有序消息项；没有模板外键，也不能被其他配置引用。
CREATE TABLE "notification_event_channel_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "channel_config_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "kind" "notification_message_kind" NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "media_policy" JSONB NOT NULL DEFAULT '{}',
  "content_hash" VARCHAR(64),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_event_channel_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_event_channel_messages_config_sort_key" UNIQUE ("channel_config_id", "sort_order"),
  CONSTRAINT "notification_event_channel_messages_sort_check" CHECK ("sort_order" >= 0),
  CONSTRAINT "notification_event_channel_messages_payload_shape_check" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "notification_event_channel_messages_media_policy_shape_check" CHECK (jsonb_typeof("media_policy") = 'object'),
  CONSTRAINT "notification_event_channel_messages_content_hash_check" CHECK (
    "content_hash" IS NULL OR "content_hash" ~ '^[a-f0-9]{64}$'
  )
);

ALTER TABLE "notification_event_channel_messages"
  ADD CONSTRAINT "notification_event_channel_messages_channel_config_id_fkey"
  FOREIGN KEY ("channel_config_id") REFERENCES "notification_event_channels"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE INDEX "notification_event_channel_messages_kind_idx"
  ON "notification_event_channel_messages"("kind");

-- 通知级渲染快照：mpnews 等大内容只渲染一份，投递消息只引用。
CREATE TABLE "notification_rendered_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "notification_id" UUID NOT NULL,
  "channel" "notification_channel" NOT NULL,
  "send_method" "notification_send_method" NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "kind" "notification_message_kind" NOT NULL,
  "payload_snapshot" JSONB NOT NULL DEFAULT '{}',
  "content_hash" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_rendered_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_rendered_messages_notification_channel_sort_key" UNIQUE (
    "notification_id", "channel", "send_method", "sort_order"
  ),
  CONSTRAINT "notification_rendered_messages_sort_check" CHECK ("sort_order" >= 0),
  CONSTRAINT "notification_rendered_messages_payload_shape_check" CHECK (jsonb_typeof("payload_snapshot") = 'object'),
  CONSTRAINT "notification_rendered_messages_content_hash_check" CHECK (
    "content_hash" IS NULL OR "content_hash" ~ '^[a-f0-9]{64}$'
  )
);

ALTER TABLE "notification_rendered_messages"
  ADD CONSTRAINT "notification_rendered_messages_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE INDEX "notification_rendered_messages_notification_channel_idx"
  ON "notification_rendered_messages"("notification_id", "channel", "send_method");

-- 投递消息项：每条记录一次实际 API 发送，逐项状态与重试。
CREATE TABLE "notification_delivery_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "delivery_id" UUID NOT NULL,
  "rendered_message_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "status" "wecom_delivery_status" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider_msg_id" VARCHAR(128),
  "media_id" VARCHAR(128),
  "media_id_expires_at" TIMESTAMPTZ(6),
  "failure_code" VARCHAR(64),
  "failure_message" VARCHAR(255),
  "accepted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_delivery_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_delivery_messages_delivery_sort_key" UNIQUE ("delivery_id", "sort_order"),
  CONSTRAINT "notification_delivery_messages_sort_check" CHECK ("sort_order" >= 0),
  CONSTRAINT "notification_delivery_messages_attempt_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "notification_delivery_messages_status_check" CHECK ("status" <> 'PARTIAL')
);

ALTER TABLE "notification_delivery_messages"
  ADD CONSTRAINT "notification_delivery_messages_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "wecom_deliveries"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "notification_delivery_messages"
  ADD CONSTRAINT "notification_delivery_messages_rendered_message_id_fkey"
  FOREIGN KEY ("rendered_message_id") REFERENCES "notification_rendered_messages"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "notification_delivery_messages_status_next_idx"
  ON "notification_delivery_messages"("status", "next_attempt_at");

CREATE INDEX "notification_delivery_messages_rendered_idx"
  ON "notification_delivery_messages"("rendered_message_id");

-- 自校验：枚举、表、唯一键与关键约束缺失即整单回滚。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = '"notification_send_method"'::regtype AND enumlabel = 'ROBOT'
  ) THEN
    RAISE EXCEPTION 'notification_send_method ROBOT missing' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = '"notification_message_kind"'::regtype AND enumlabel = 'MPNEWS'
  ) THEN
    RAISE EXCEPTION 'notification_message_kind MPNEWS missing' USING ERRCODE = '23514';
  END IF;

  IF to_regclass('public.notification_event_channels') IS NULL
    OR to_regclass('public.notification_event_channel_messages') IS NULL
    OR to_regclass('public.notification_rendered_messages') IS NULL
    OR to_regclass('public.notification_delivery_messages') IS NULL
  THEN
    RAISE EXCEPTION 'notification event content tables missing' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_event_channels_channel_method_check'
  ) THEN
    RAISE EXCEPTION 'notification_event_channels_channel_method_check missing' USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;
