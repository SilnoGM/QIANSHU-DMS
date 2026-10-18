BEGIN;

-- ProductStatusOnlyActiveOrInactive
-- 新建产品固定启用；历史 DRAFT 统一收敛为 INACTIVE，保留其不可选状态。
ALTER TABLE "products" ALTER COLUMN "status" DROP DEFAULT;

-- 供应商现已 NOT NULL，旧的 ACTIVE 供应商检查与旧枚举比较；类型切换前移除。
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_active_supplier_required_check";

CREATE TYPE "product_status_new" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "products"
  ALTER COLUMN "status" TYPE "product_status_new"
  USING (
    CASE
      WHEN "status"::text = 'ACTIVE' THEN 'ACTIVE'::"product_status_new"
      ELSE 'INACTIVE'::"product_status_new"
    END
  );

ALTER TABLE "products"
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"product_status_new";

DROP TYPE "product_status";
ALTER TYPE "product_status_new" RENAME TO "product_status";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum AS enum_value
    JOIN pg_type AS enum_type
      ON enum_type."oid" = enum_value."enumtypid"
    WHERE enum_type."typname" = 'product_status'
      AND enum_value."enumlabel" NOT IN ('ACTIVE', 'INACTIVE')
  ) THEN
    RAISE EXCEPTION 'product status migration left a retired status value';
  END IF;
END;
$$;

COMMIT;
