-- 复算材积 volume_cai 收窄为 DECIMAL(24,2)，与账单表结构一致。
-- 20260930120000 已把所有有尺寸的行按两位小数重算，所以这里是无损收窄；
-- 前置检查仍失败关闭：若存在第三位小数（例如维度不全但带了历史材积的行），
-- 宁可拒绝迁移、人工核对，也不静默丢掉小数值。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

LOCK TABLE "container_loading_items" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "container_loading_items"
    WHERE "volume_cai" IS NOT NULL AND "volume_cai" <> trunc("volume_cai", 2)
  ) THEN
    RAISE EXCEPTION 'Container loading item volumes carry nonzero third decimals; recompute them before migration'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;
END;
$$;

ALTER TABLE "container_loading_items"
  ALTER COLUMN "volume_cai" TYPE DECIMAL(24, 2);

-- 复查列精度；按 regclass 解析关系，不写死 public。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute AS "attribute"
    WHERE "attribute"."attrelid" = 'container_loading_items'::regclass
      AND "attribute"."attname" = 'volume_cai'
      AND format_type("attribute"."atttypid", "attribute"."atttypmod") <> 'numeric(24,2)'
  ) THEN
    RAISE EXCEPTION 'Container loading item volume column was not narrowed to two decimals'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;
END;
$$;

COMMIT;
