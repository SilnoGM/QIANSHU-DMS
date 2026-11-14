BEGIN;

SET LOCAL lock_timeout = '5s';

-- 毛重从「整数 kg」改为「0.5 kg 步进的两位小数」：应用层按 ceil(2 × 精确毛重) / 2 计算，
-- 装柜明细与顺联航账单明细两侧同口径。存量值都是整数、是 0.5 的整数倍，放宽无损；
-- 既有 CHECK 只要求大于零，0.5 仍满足，无需改写约束。
--
-- 历史运费是已经发生的计费事实，本迁移不重算毛重、不回填运费，只放宽列精度。
ALTER TABLE "container_loading_items"
  ALTER COLUMN "gross_weight_kg" TYPE NUMERIC(18,2);
ALTER TABLE "slh_bill_lines"
  ALTER COLUMN "gross_weight_kg" TYPE NUMERIC(18,2);

-- 复查列形状与存量值：任一不满足即整体回滚，避免半公斤值静默落成整数。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'container_loading_items'::regclass
      AND attname = 'gross_weight_kg'
      AND NOT attisdropped
      AND format_type(atttypid, atttypmod) = 'numeric(18,2)'
  ) THEN
    RAISE EXCEPTION 'container_loading_items.gross_weight_kg was not widened to numeric(18,2)'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'slh_bill_lines'::regclass
      AND attname = 'gross_weight_kg'
      AND NOT attisdropped
      AND format_type(atttypid, atttypmod) = 'numeric(18,2)'
  ) THEN
    RAISE EXCEPTION 'slh_bill_lines.gross_weight_kg was not widened to numeric(18,2)'
      USING ERRCODE = '23514', CONSTRAINT = 'slh_bill_lines_amount_check';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "container_loading_items"
    WHERE "gross_weight_kg" IS NOT NULL AND "gross_weight_kg" <= 0
  ) OR EXISTS (
    SELECT 1 FROM "slh_bill_lines"
    WHERE "gross_weight_kg" IS NOT NULL AND "gross_weight_kg" <= 0
  ) THEN
    RAISE EXCEPTION 'gross_weight_kg contains non-positive values'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;
END;
$$;

COMMIT;
