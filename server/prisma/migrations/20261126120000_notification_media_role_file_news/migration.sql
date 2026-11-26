BEGIN;

-- 文件消息与图文卡片图片使用显式角色，便于配置媒体引用与回收保护。
ALTER TYPE "notification_message_media_role" ADD VALUE IF NOT EXISTS 'FILE';
ALTER TYPE "notification_message_media_role" ADD VALUE IF NOT EXISTS 'NEWS_IMAGE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = '"notification_message_media_role"'::regtype AND enumlabel = 'FILE'
  ) THEN
    RAISE EXCEPTION 'notification_message_media_role FILE missing' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = '"notification_message_media_role"'::regtype AND enumlabel = 'NEWS_IMAGE'
  ) THEN
    RAISE EXCEPTION 'notification_message_media_role NEWS_IMAGE missing' USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;
