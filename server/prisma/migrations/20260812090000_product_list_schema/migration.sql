BEGIN;

CREATE TYPE "product_status" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

CREATE TABLE "products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(128) NOT NULL,
  "product_no" VARCHAR(64) NOT NULL,
  "status" "product_status" NOT NULL DEFAULT 'DRAFT',
  "supplier_value" VARCHAR(64),
  "main_image" VARCHAR(2048),
  "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "videos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "twd_sale_price_amount" NUMERIC(30, 4),
  "twd_sale_price_currency" CHAR(3) NOT NULL DEFAULT 'TWD',
  "myr_sale_price_amount" NUMERIC(30, 4),
  "myr_sale_price_currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "purchase_cost_amount" NUMERIC(30, 4),
  "purchase_cost_currency" CHAR(3) NOT NULL DEFAULT 'CNY',
  "attributes" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_by_user_id" UUID,
  "updated_by_user_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "products_name_nonblank_check"
    CHECK (btrim("name") <> ''),
  CONSTRAINT "products_product_no_nonblank_check"
    CHECK (btrim("product_no") <> ''),
  CONSTRAINT "products_supplier_value_nonblank_check"
    CHECK ("supplier_value" IS NULL OR btrim("supplier_value") <> ''),
  CONSTRAINT "products_active_supplier_required_check"
    CHECK ("status" <> 'ACTIVE' OR "supplier_value" IS NOT NULL),
  CONSTRAINT "products_twd_currency_check"
    CHECK ("twd_sale_price_currency" = 'TWD'),
  CONSTRAINT "products_myr_currency_check"
    CHECK ("myr_sale_price_currency" = 'MYR'),
  CONSTRAINT "products_purchase_currency_format_check"
    CHECK ("purchase_cost_currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "products_twd_sale_price_amount_nonnegative_check"
    CHECK ("twd_sale_price_amount" IS NULL OR "twd_sale_price_amount" >= 0),
  CONSTRAINT "products_myr_sale_price_amount_nonnegative_check"
    CHECK ("myr_sale_price_amount" IS NULL OR "myr_sale_price_amount" >= 0),
  CONSTRAINT "products_purchase_cost_amount_nonnegative_check"
    CHECK ("purchase_cost_amount" IS NULL OR "purchase_cost_amount" >= 0),
  CONSTRAINT "products_attributes_array_check"
    CHECK (jsonb_typeof("attributes") = 'array'),
  CONSTRAINT "products_version_positive_check"
    CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "products_product_no_key"
ON "products"("product_no");

CREATE INDEX "products_status_updated_at_id_idx"
ON "products"("status", "updated_at" DESC, "id" DESC);

CREATE INDEX "products_supplier_value_updated_at_id_idx"
ON "products"("supplier_value", "updated_at" DESC, "id" DESC);

CREATE INDEX "products_updated_at_id_idx"
ON "products"("updated_at" DESC, "id" DESC);

ALTER TABLE "products"
ADD CONSTRAINT "products_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "products"
ADD CONSTRAINT "products_updated_by_user_id_fkey"
FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 已派发编号与数据库主键共同构成 Product 身份；业务字段仍由未来写服务按版本更新。
CREATE FUNCTION "enforce_product_identity_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."product_no" IS DISTINCT FROM OLD."product_no" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'product identity is immutable',
      CONSTRAINT = 'products_identity_immutable_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "products_identity_immutable_trigger"
BEFORE UPDATE OF "id", "product_no"
ON "products"
FOR EACH ROW
EXECUTE FUNCTION "enforce_product_identity_immutability"();

-- Migration 自检只验证结构身份；不会读取或修改编号规则、字典与业务数据。
DO $$
BEGIN
  IF to_regclass('products') IS NULL
    OR to_regprocedure('enforce_product_identity_immutability()') IS NULL THEN
    RAISE EXCEPTION 'product list schema migration invariant mismatch';
  END IF;
END;
$$;

COMMIT;
