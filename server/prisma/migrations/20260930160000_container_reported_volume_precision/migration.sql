-- 来源材积（reported_volume_cai）统一为两位小数，与账单表记录精度一致。
-- 这是来源表格自己算出的派生数值：原始单元格值与公式已保存在 source_data JSON 里，
-- 且我们另有一列按标准复算的 volume_cai，因此这里按记录精度取整（四舍五入，与导入解析同一规则），
-- 而不是像尺寸那样失败关闭。差异列按两位小数比较，取整后不再被来源的多余小数位干扰。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

LOCK TABLE "container_loading_items" IN SHARE ROW EXCLUSIVE MODE;

UPDATE "container_loading_items"
SET "reported_volume_cai" = round("reported_volume_cai", 2)
WHERE "reported_volume_cai" IS NOT NULL
  AND "reported_volume_cai" <> round("reported_volume_cai", 2);

ALTER TABLE "container_loading_items"
  ALTER COLUMN "reported_volume_cai" TYPE DECIMAL(24, 2);

-- 复查：非空值都落在两位小数，且列精度已到位；按 regclass 解析关系，不写死 public。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "container_loading_items"
    WHERE "reported_volume_cai" IS NOT NULL AND "reported_volume_cai" <> trunc("reported_volume_cai", 2)
  ) THEN
    RAISE EXCEPTION 'Container loading item reported volume was not rounded to two decimals'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_attribute AS "attribute"
    WHERE "attribute"."attrelid" = 'container_loading_items'::regclass
      AND "attribute"."attname" = 'reported_volume_cai'
      AND format_type("attribute"."atttypid", "attribute"."atttypmod") <> 'numeric(24,2)'
  ) THEN
    RAISE EXCEPTION 'Container loading item reported volume column was not narrowed to two decimals'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;
END;
$$;

COMMIT;
