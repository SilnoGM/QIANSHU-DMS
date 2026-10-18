-- 产品分类与产品头：additive 文本列，不重写存量业务数据。
-- 存量产品两列保持 NULL，由页面显示「未分类 / 未填写产品头」并逐步补录。

BEGIN;

ALTER TABLE "products"
  ADD COLUMN "category_name" varchar(64),
  ADD COLUMN "product_head_name" varchar(64);

ALTER TABLE "products"
  ADD CONSTRAINT "products_category_name_nonblank_check"
    CHECK ("category_name" IS NULL OR btrim("category_name") <> ''),
  ADD CONSTRAINT "products_product_head_name_nonblank_check"
    CHECK ("product_head_name" IS NULL OR btrim("product_head_name") <> ''),
  ADD CONSTRAINT "products_taxonomy_pair_check"
    CHECK (("category_name" IS NULL) = ("product_head_name" IS NULL));

CREATE INDEX "products_category_head_name_idx"
  ON "products" ("category_name", "product_head_name", "name");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'products'
      AND column_name = 'category_name'
      AND character_maximum_length = 64
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'products'
      AND column_name = 'product_head_name'
      AND character_maximum_length = 64
  ) THEN
    RAISE EXCEPTION 'product taxonomy columns are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'products'::regclass
      AND conname = 'products_taxonomy_pair_check'
  ) THEN
    RAISE EXCEPTION 'product taxonomy pair constraint is missing';
  END IF;

  IF to_regclass('products_category_head_name_idx') IS NULL THEN
    RAISE EXCEPTION 'product taxonomy index is missing';
  END IF;
END;
$$;

COMMIT;
