BEGIN;

-- 同一模板键在两个渠道必须使用同一业务域；存量若已冲突则先失败关闭，交人工确认。
DO $$
DECLARE
  conflicting_key text;
BEGIN
  SELECT "key"
  INTO conflicting_key
  FROM "notification_templates"
  GROUP BY "key"
  HAVING COUNT(DISTINCT "domain") > 1
  LIMIT 1;

  IF conflicting_key IS NOT NULL THEN
    RAISE EXCEPTION 'notification template domain conflict for key %', conflicting_key
      USING ERRCODE = '23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_notification_template_domain_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  other_domain "notification_template_domain";
BEGIN
  SELECT "domain"
  INTO other_domain
  FROM "notification_templates"
  WHERE "key" = NEW."key"
    AND "channel" <> NEW."channel"
  LIMIT 1;

  IF other_domain IS NOT NULL AND other_domain <> NEW."domain" THEN
    RAISE EXCEPTION 'notification template domain conflict for key %', NEW."key"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "notification_templates_domain_consistency" ON "notification_templates";
CREATE TRIGGER "notification_templates_domain_consistency"
BEFORE INSERT OR UPDATE OF "key", "domain" ON "notification_templates"
FOR EACH ROW EXECUTE FUNCTION enforce_notification_template_domain_consistency();

COMMIT;
