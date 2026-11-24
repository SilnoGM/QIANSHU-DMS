BEGIN;

-- 企业微信 message/send 返回的 msgid 实测为 128 字符；原 VARCHAR(64) 会在落库时报错。
ALTER TABLE "wecom_deliveries"
  ALTER COLUMN "provider_msg_id" TYPE VARCHAR(128);

-- MigrationSelfCheck
DO $$
DECLARE
  actual_type text;
  actual_length integer;
BEGIN
  SELECT data_type, character_maximum_length
  INTO actual_type, actual_length
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'wecom_deliveries'
    AND column_name = 'provider_msg_id';

  IF actual_type <> 'character varying' OR actual_length <> 128 THEN
    RAISE EXCEPTION 'wecom provider_msg_id migration invariant mismatch: % / %', actual_type, actual_length;
  END IF;
END $$;

COMMIT;
