BEGIN;

-- 通知附件来源：模板可按业务语义来源选择附件，记录页需要持久化当时的来源键。
-- 只新增一列，不改既有行、索引或触发器；历史附件保持 NULL，展示为「附件」。
ALTER TABLE "notification_media" ADD COLUMN "source_key" VARCHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_media' AND column_name = 'source_key'
  ) THEN
    RAISE EXCEPTION 'notification media source key column missing' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
