BEGIN;

CREATE TYPE "notification_message_media_role" AS ENUM ('COVER', 'INLINE');

-- 内容消息项的媒体引用：只允许引用 READY 资产，供媒体清理按引用保护。
CREATE TABLE "notification_event_channel_message_media" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "message_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "role" "notification_message_media_role" NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_event_channel_message_media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_event_channel_message_media_unique" UNIQUE ("message_id", "media_asset_id", "role"),
  CONSTRAINT "notification_event_channel_message_media_sort_check" CHECK ("sort_order" >= 0)
);

ALTER TABLE "notification_event_channel_message_media"
  ADD CONSTRAINT "notification_event_channel_message_media_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "notification_event_channel_messages"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "notification_event_channel_message_media"
  ADD CONSTRAINT "notification_event_channel_message_media_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "notification_event_channel_message_media_asset_idx"
  ON "notification_event_channel_message_media"("media_asset_id");

-- 内容引用只校验 INSERT/UPDATE：消息级联删除不得因「删掉最后一条引用」失败。
CREATE OR REPLACE FUNCTION "enforce_notification_content_media_ready"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reference_asset_id UUID;
  current_status "media_asset_status";
BEGIN
  IF TG_OP = 'DELETE' THEN
    reference_asset_id := OLD."media_asset_id";
  ELSE
    reference_asset_id := NEW."media_asset_id";
  END IF;

  SELECT asset."status"
  INTO current_status
  FROM "media_assets" AS asset
  WHERE asset."id" = reference_asset_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF current_status <> 'READY' THEN
    RAISE EXCEPTION 'Notification content media must remain ready'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_event_channel_message_media_ready_check';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "notification_event_channel_message_media_ready_trigger"
AFTER INSERT OR UPDATE ON "notification_event_channel_message_media"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_notification_content_media_ready"();

-- 企业微信媒体缓存：mpnews 正文永久 URL 与封面临时 media_id。
CREATE TABLE "wecom_media_cache" (
  "key" VARCHAR(256) NOT NULL,
  "value" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wecom_media_cache_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "wecom_media_cache_expires_idx" ON "wecom_media_cache"("expires_at");

-- 自校验：枚举、两张表、媒体引用触发器与缓存索引缺失即整单回滚。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = '"notification_message_media_role"'::regtype AND enumlabel = 'INLINE'
  ) THEN
    RAISE EXCEPTION 'notification_message_media_role INLINE missing' USING ERRCODE = '23514';
  END IF;

  IF to_regclass('public.notification_event_channel_message_media') IS NULL
    OR to_regclass('public.wecom_media_cache') IS NULL
  THEN
    RAISE EXCEPTION 'notification content media tables missing' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'notification_event_channel_message_media_ready_trigger'
  ) THEN
    RAISE EXCEPTION 'notification content media ready trigger missing' USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;
