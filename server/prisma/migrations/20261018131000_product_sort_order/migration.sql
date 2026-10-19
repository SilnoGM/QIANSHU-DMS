BEGIN;

-- 手工排序字段：分类按供应商、产品头按分类、产品按产品头（无产品头时按供应商）。
ALTER TABLE "product_categories" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "product_heads" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- 按现有名称顺序回填，避免上线后目录顺序突然变化。
WITH ranked AS (
  SELECT
    "id",
    (row_number() OVER (PARTITION BY "supplier_value" ORDER BY "name", "id") * 10)::integer AS "rank"
  FROM "product_categories"
)
UPDATE "product_categories" AS category
SET "sort_order" = ranked."rank"
FROM ranked
WHERE category."id" = ranked."id";

WITH ranked AS (
  SELECT
    "id",
    (row_number() OVER (PARTITION BY "category_id" ORDER BY "name", "id") * 10)::integer AS "rank"
  FROM "product_heads"
)
UPDATE "product_heads" AS head
SET "sort_order" = ranked."rank"
FROM ranked
WHERE head."id" = ranked."id";

WITH ranked AS (
  SELECT
    "id",
    (row_number() OVER (PARTITION BY "product_head_id" ORDER BY "name", "id") * 10)::integer AS "rank"
  FROM "products"
  WHERE "product_head_id" IS NOT NULL
)
UPDATE "products" AS product
SET "sort_order" = ranked."rank"
FROM ranked
WHERE product."id" = ranked."id";

WITH ranked AS (
  SELECT
    "id",
    (row_number() OVER (PARTITION BY "supplier_value" ORDER BY "name", "id") * 10)::integer AS "rank"
  FROM "products"
  WHERE "product_head_id" IS NULL
)
UPDATE "products" AS product
SET "sort_order" = ranked."rank"
FROM ranked
WHERE product."id" = ranked."id";

ALTER TABLE "product_categories"
  ADD CONSTRAINT "product_categories_sort_order_nonnegative_check"
  CHECK ("sort_order" >= 0);
ALTER TABLE "product_heads"
  ADD CONSTRAINT "product_heads_sort_order_nonnegative_check"
  CHECK ("sort_order" >= 0);
ALTER TABLE "products"
  ADD CONSTRAINT "products_sort_order_nonnegative_check"
  CHECK ("sort_order" >= 0);

CREATE INDEX "product_categories_supplier_sort_idx"
ON "product_categories"("supplier_value", "sort_order", "name");

CREATE INDEX "product_heads_category_sort_idx"
ON "product_heads"("category_id", "sort_order", "name");

CREATE INDEX "products_product_head_sort_idx"
ON "products"("product_head_id", "sort_order", "name");

COMMIT;
