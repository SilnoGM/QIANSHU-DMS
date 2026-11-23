-- 产品级唛头排除标记：为 true 时该产品的采购行不进入货件唛头后缀。
-- 只影响唛头展示；金额、数量、货件构成和采购单图片快照结构不变。
-- 历史采购单的后缀是实时计算的，标记生效后立即反映在列表、详情、图片、通知和对账单上。
ALTER TABLE "products"
  ADD COLUMN "exclude_from_shipping_mark" BOOLEAN NOT NULL DEFAULT false;

-- 回填现存补差价产品（每个供应商各一条，名称带 ❗️ 前缀；同时覆盖可能的繁体写法）。
-- 自检语义为“清单中存在的匹配项全部被回填”，而不是固定行数：CI 与全新环境
-- 没有历史产品时 expected_rows = 0，迁移仍然通过。
DO $$
DECLARE
  expected_rows integer;
  updated_rows integer;
BEGIN
  SELECT count(*) INTO expected_rows
  FROM "products"
  WHERE "exclude_from_shipping_mark" = false
    AND ("name" LIKE '%补差价%' OR "name" LIKE '%補差價%');

  UPDATE "products"
  SET "exclude_from_shipping_mark" = true
  WHERE "exclude_from_shipping_mark" = false
    AND ("name" LIKE '%补差价%' OR "name" LIKE '%補差價%');

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> expected_rows THEN
    RAISE EXCEPTION 'product shipping mark exclusion backfill expected % rows, updated %',
      expected_rows, updated_rows;
  END IF;
END
$$;
