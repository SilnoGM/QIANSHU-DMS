-- 装柜明细材积统一到账单表口径：长 × 宽 × 高 ÷ 28316 × 箱数，
-- 非按材积计价保留两位小数，按材积计价向上取整。
-- 历史值是按旧的 28317 分母算出的八位小数，与来源表格（公式 I*J*K/28316*E）存在口径差。
-- 只重算 volume_cai 与 chargeable_volume_cai 两个派生列：尺寸、件数等输入未变，
-- 因此不动 version、updated_at、updated_by_id，也不写入装柜变更记录（该表只记录代收款与收货人变更）。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- 重算期间阻止装柜明细并发写入，保证读到的尺寸、件数与回写值来自同一事实快照。
LOCK TABLE "container_loading_items" IN SHARE ROW EXCLUSIVE MODE;

-- 尺寸列是 NUMERIC(18,3)，乘以 1000 后无损为整数；整段计算因此可以用整数精确表达，
-- 不依赖浮点，也不依赖 numeric 除法的有效位舍入。分母 = 28316 * 10^9。
DO $$
DECLARE
  "rounding_zero" INTEGER;
BEGIN
  SELECT count(*) INTO "rounding_zero"
  FROM "container_loading_items"
  WHERE "length_cm" IS NOT NULL AND "width_cm" IS NOT NULL AND "height_cm" IS NOT NULL
    AND div(
      ("length_cm" * 1000) * ("width_cm" * 1000) * ("height_cm" * 1000) * "package_count" * 100 + 14158000000000,
      28316000000000
    ) = 0;
  IF "rounding_zero" > 0 THEN
    RAISE EXCEPTION 'Container loading items would round to a zero two-decimal volume under the shared divisor; correct dimensions before migration'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;
END;
$$;

WITH "scaled" AS (
  SELECT
    "id",
    ("length_cm" * 1000) * ("width_cm" * 1000) * ("height_cm" * 1000) * "package_count" AS "product"
  FROM "container_loading_items"
  WHERE "length_cm" IS NOT NULL AND "width_cm" IS NOT NULL AND "height_cm" IS NOT NULL
), "recomputed" AS (
  SELECT
    "id",
    -- 两位小数记录：四舍五入到 10^-2，再还原为列精度下的数值。
    div("product" * 100 + 14158000000000, 28316000000000) / 100 AS "volume_cai",
    -- 计费材数：同一精确值的向上取整，保留现有「按材积计价取整数」的语义。
    div("product" + 28315999999999, 28316000000000) AS "chargeable_volume_cai"
  FROM "scaled"
)
UPDATE "container_loading_items" AS "item"
SET
  "volume_cai" = "recomputed"."volume_cai",
  "chargeable_volume_cai" = "recomputed"."chargeable_volume_cai"
FROM "recomputed"
WHERE "item"."id" = "recomputed"."id";

-- 回填后校验重算形状：记录精度为两位小数、材积为正、计费材数不小于 1。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "container_loading_items"
    WHERE "length_cm" IS NOT NULL AND "width_cm" IS NOT NULL AND "height_cm" IS NOT NULL
      AND (
        "volume_cai" IS NULL OR "volume_cai" <= 0 OR "volume_cai" <> trunc("volume_cai", 2)
        OR "chargeable_volume_cai" IS NULL OR "chargeable_volume_cai" < 1
      )
  ) THEN
    RAISE EXCEPTION 'Container loading item volume backfill did not converge to the shared record standard'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_values_check';
  END IF;
END;
$$;

COMMIT;
