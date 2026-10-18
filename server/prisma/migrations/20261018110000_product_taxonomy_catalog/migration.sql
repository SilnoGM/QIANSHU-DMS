BEGIN;

-- ProductTaxonomyCatalog
-- 分类属于供应商、产品头属于分类；唯一键按作用域收敛：
-- 不同供应商可以存在同名分类，不同分类也可以存在同名产品头。
CREATE TABLE "product_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplier_value" VARCHAR(64) NOT NULL,
  "name" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_categories_supplier_value_name_key"
    UNIQUE ("supplier_value", "name"),
  CONSTRAINT "product_categories_name_nonblank_check"
    CHECK (btrim("name") <> '')
);

CREATE INDEX "product_categories_supplier_value_name_idx"
  ON "product_categories" ("supplier_value", "name");

CREATE TABLE "product_heads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "category_id" UUID NOT NULL,
  "name" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_heads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_heads_category_id_name_key"
    UNIQUE ("category_id", "name"),
  CONSTRAINT "product_heads_name_nonblank_check"
    CHECK (btrim("name") <> ''),
  CONSTRAINT "product_heads_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "product_categories" ("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "product_heads_category_id_name_idx"
  ON "product_heads" ("category_id", "name");

-- ProductTaxonomyBackfillPreconditions
-- 供应商必填是本次口径；任何历史空供应商都必须先人工补齐，不能由迁移擅自猜测。
-- 分类/产品头仍允许历史产品同时为空，但不允许只有一边有值。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "products" WHERE "supplier_value" IS NULL) THEN
    RAISE EXCEPTION 'product taxonomy migration requires non-null supplier_value';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "products"
    WHERE ("category_name" IS NULL) <> ("product_head_name" IS NULL)
  ) THEN
    RAISE EXCEPTION 'product taxonomy migration requires paired category_name and product_head_name';
  END IF;
END;
$$;

-- BackfillCategoriesAndHeads
INSERT INTO "product_categories" ("supplier_value", "name")
SELECT DISTINCT "supplier_value", "category_name"
FROM "products"
WHERE "supplier_value" IS NOT NULL
  AND "category_name" IS NOT NULL;

INSERT INTO "product_heads" ("category_id", "name")
SELECT category."id", source."product_head_name"
FROM (
  SELECT DISTINCT "supplier_value", "category_name", "product_head_name"
  FROM "products"
  WHERE "supplier_value" IS NOT NULL
    AND "category_name" IS NOT NULL
    AND "product_head_name" IS NOT NULL
) AS source
JOIN "product_categories" AS category
  ON category."supplier_value" = source."supplier_value"
  AND category."name" = source."category_name";

ALTER TABLE "products"
  ADD COLUMN "category_id" UUID,
  ADD COLUMN "product_head_id" UUID;

UPDATE "products" AS product
SET
  "category_id" = head."category_id",
  "product_head_id" = head."id"
FROM "product_heads" AS head
JOIN "product_categories" AS category
  ON category."id" = head."category_id"
WHERE product."category_name" IS NOT NULL
  AND category."supplier_value" = product."supplier_value"
  AND category."name" = product."category_name"
  AND head."name" = product."product_head_name";

-- 旧文本列的成对检查与列一起退役；新检查改为约束两个稳定 ID。
ALTER TABLE "products" DROP CONSTRAINT "products_taxonomy_pair_check";

ALTER TABLE "products"
  ADD CONSTRAINT "products_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "product_categories" ("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "products_product_head_id_fkey"
    FOREIGN KEY ("product_head_id") REFERENCES "product_heads" ("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "products_taxonomy_pair_check"
    CHECK (
      ("category_id" IS NULL AND "product_head_id" IS NULL)
      OR ("category_id" IS NOT NULL AND "product_head_id" IS NOT NULL)
    );

-- ProductTaxonomyScopeGuard
-- 分类必须属于产品的供应商，产品头必须属于产品的分类。两条关系跨越不同父行，
-- 单列外键无法表达；触发器在数据库层守住这条不变量，应用层仍先做可读校验。
CREATE FUNCTION "products_taxonomy_scope_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  category_supplier VARCHAR(64);
  head_category UUID;
BEGIN
  IF NEW."category_id" IS NULL AND NEW."product_head_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "supplier_value"
  INTO category_supplier
  FROM "product_categories"
  WHERE "id" = NEW."category_id";

  IF NOT FOUND OR category_supplier IS DISTINCT FROM NEW."supplier_value" THEN
    RAISE EXCEPTION 'product category does not belong to supplier'
      USING ERRCODE = '23514';
  END IF;

  SELECT "category_id"
  INTO head_category
  FROM "product_heads"
  WHERE "id" = NEW."product_head_id";

  IF NOT FOUND OR head_category IS DISTINCT FROM NEW."category_id" THEN
    RAISE EXCEPTION 'product head does not belong to category'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "products_taxonomy_scope_guard"
BEFORE INSERT OR UPDATE OF "supplier_value", "category_id", "product_head_id"
ON "products"
FOR EACH ROW
EXECUTE FUNCTION "products_taxonomy_scope_guard"();

-- 历史文本列在回填验证后退役；分类/产品头改由稳定 ID 承担身份。
ALTER TABLE "products" ALTER COLUMN "supplier_value" SET NOT NULL;
DROP INDEX IF EXISTS "products_category_head_name_idx";
ALTER TABLE "products"
  DROP COLUMN "category_name",
  DROP COLUMN "product_head_name";

CREATE INDEX "products_category_id_name_idx"
  ON "products" ("category_id", "name");
CREATE INDEX "products_product_head_id_name_idx"
  ON "products" ("product_head_id", "name");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "products" WHERE "supplier_value" IS NULL) THEN
    RAISE EXCEPTION 'product taxonomy migration left null supplier_value';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_taxonomy_pair_check'
      AND conrelid = '"products"'::regclass
  ) THEN
    RAISE EXCEPTION 'product taxonomy migration is missing products_taxonomy_pair_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'products_taxonomy_scope_guard'
      AND tgrelid = '"products"'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'product taxonomy migration is missing products_taxonomy_scope_guard';
  END IF;
END;
$$;

COMMIT;
