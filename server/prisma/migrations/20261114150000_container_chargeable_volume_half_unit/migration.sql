BEGIN;

SET LOCAL lock_timeout = '5s';

-- 装柜计费材数从「整数材」改为「0.5 材步进」：上游按 ceil(2 × 精确材积) / 2 计算，
-- 0.5 无法用 INTEGER 表示，因此把列放宽到 NUMERIC(24,2)，与复算材积 volume_cai 同一记录精度。
-- 存量值都是整数，是 0.5 的整数倍，放宽无损；既有 container_loading_items_values_check
-- 只要求大于零，0.5 仍满足，无需改写约束。
ALTER TABLE "container_loading_items"
  ALTER COLUMN "chargeable_volume_cai" TYPE NUMERIC(24,2);

-- 复查列形状、值域约束与存量值：任一不满足即整体回滚，避免把半材值静默落成整数。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'container_loading_items'::regclass
      AND attname = 'chargeable_volume_cai'
      AND NOT attisdropped
      AND format_type(atttypid, atttypmod) = 'numeric(24,2)'
  ) THEN
    RAISE EXCEPTION 'container_loading_items.chargeable_volume_cai was not widened to numeric(24,2)'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'container_loading_items'::regclass
      AND conname = 'container_loading_items_values_check'
  ) THEN
    RAISE EXCEPTION 'container_loading_items_values_check is missing after widening chargeable_volume_cai'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "container_loading_items"
    WHERE "chargeable_volume_cai" IS NOT NULL
      AND ("chargeable_volume_cai" <= 0 OR "chargeable_volume_cai" <> trunc("chargeable_volume_cai", 2))
  ) THEN
    RAISE EXCEPTION 'chargeable_volume_cai contains values outside the two-decimal record precision'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;
END;
$$;

COMMIT;
