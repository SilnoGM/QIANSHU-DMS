-- 装柜明细的每件尺寸统一为两位小数，与账单表记录精度一致（长/宽/高 DECIMAL(18,2)）。
-- 收窄列类型会丢掉第三位小数，等于改写真实尺寸，因此先失败关闭：存在无法无损表示的
-- 历史值时拒绝迁移，由人工核对来源后再执行，而不是静默取整。
-- 尺寸数值本身不变，所以已按共享标准算出的 volume_cai / chargeable_volume_cai 无需重算。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

LOCK TABLE "container_loading_items" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "container_loading_items"
    WHERE ("length_cm" IS NOT NULL AND "length_cm" <> trunc("length_cm", 2))
       OR ("width_cm" IS NOT NULL AND "width_cm" <> trunc("width_cm", 2))
       OR ("height_cm" IS NOT NULL AND "height_cm" <> trunc("height_cm", 2))
  ) THEN
    RAISE EXCEPTION 'Container loading item dimensions carry nonzero third decimals; reconcile them before migration'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;
END;
$$;

ALTER TABLE "container_loading_items"
  ALTER COLUMN "length_cm" TYPE DECIMAL(18, 2),
  ALTER COLUMN "width_cm" TYPE DECIMAL(18, 2),
  ALTER COLUMN "height_cm" TYPE DECIMAL(18, 2);

-- 复查列精度已到位；不写死 public，保证隔离 schema 回放同样成立。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute AS "attribute"
    WHERE "attribute"."attrelid" = 'container_loading_items'::regclass
      AND "attribute"."attname" IN ('length_cm', 'width_cm', 'height_cm')
      AND format_type("attribute"."atttypid", "attribute"."atttypmod") <> 'numeric(18,2)'
  ) THEN
    RAISE EXCEPTION 'Container loading item dimensions were not narrowed to two decimals'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;
END;
$$;

COMMIT;
