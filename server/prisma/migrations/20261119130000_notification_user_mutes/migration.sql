BEGIN;

-- 个人级通知关闭：稀疏表，只保存「不想接收」的事件×渠道；没有记录即默认接收。
-- 只新增一张空表，不修改既有通知、模板、策略、投递或权限。
CREATE TABLE "notification_user_mutes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "channel" "notification_channel" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_user_mutes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_user_mutes_user_event_channel_key" UNIQUE ("user_id", "event_type", "channel")
);

ALTER TABLE "notification_user_mutes"
  ADD CONSTRAINT "notification_user_mutes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

-- 自校验：表、唯一约束与外键缺失即整单回滚。
DO $$
BEGIN
  IF to_regclass('notification_user_mutes') IS NULL THEN
    RAISE EXCEPTION 'notification user mutes table missing'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_user_mutes_table_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_user_mutes_user_event_channel_key'
      AND conrelid = 'notification_user_mutes'::regclass
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'notification user mutes unique constraint missing'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_user_mutes_unique_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_user_mutes_user_id_fkey'
      AND conrelid = 'notification_user_mutes'::regclass
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'notification user mutes user foreign key missing'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_user_mutes_fk_check';
  END IF;
END $$;

COMMIT;
