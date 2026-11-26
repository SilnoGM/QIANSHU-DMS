BEGIN;

-- 图片附件加入消息组顺序：旧行保持 NULL，继续在正文之后发送。
ALTER TABLE "wecom_delivery_media"
  ADD COLUMN "message_sort_order" INTEGER;

ALTER TABLE "wecom_delivery_media"
  ADD CONSTRAINT "wecom_delivery_media_message_sort_check"
  CHECK ("message_sort_order" IS NULL OR "message_sort_order" >= 0);

CREATE INDEX "wecom_delivery_media_delivery_message_sort_idx"
  ON "wecom_delivery_media"("delivery_id", "message_sort_order", "sort_order");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wecom_delivery_media'
      AND column_name = 'message_sort_order'
  ) THEN
    RAISE EXCEPTION 'wecom_delivery_media message_sort_order missing' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'wecom_delivery_media_delivery_message_sort_idx'
  ) THEN
    RAISE EXCEPTION 'wecom_delivery_media message sort index missing' USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;
