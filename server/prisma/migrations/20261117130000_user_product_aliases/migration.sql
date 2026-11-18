BEGIN;

-- 运营个人产品别名：只保存“用户 + 产品”的展示名，不修改产品主数据，也不参与产品唯一性。
CREATE TABLE "user_product_aliases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "alias" VARCHAR(36) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_product_aliases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_product_aliases_product_id_user_id_key" UNIQUE ("product_id", "user_id"),
  -- × 已作为唛头数量分隔符，别名本身禁止使用，避免 A×2 与 A 同名 ×2 混淆。
  CONSTRAINT "user_product_aliases_alias_shape_check" CHECK (
    "alias" = btrim("alias")
    AND char_length("alias") BETWEEN 1 AND 36
    AND "alias" !~ '[[:cntrl:]]'
    AND strpos("alias", '×') = 0
  )
);

ALTER TABLE "user_product_aliases"
  ADD CONSTRAINT "user_product_aliases_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "user_product_aliases"
  ADD CONSTRAINT "user_product_aliases_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "user_product_aliases_user_idx" ON "user_product_aliases"("user_id");

-- 审计事件：别名设置/变更与清除分开记录，便于按产品追溯标签变化。
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PRODUCT_ALIAS_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PRODUCT_ALIAS_CLEARED';

-- 客户名和货件唛头进入标签长度预算；先证明存量数据可无损满足，再添加约束。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "sales_orders" WHERE char_length("customer_name") > 24
  ) THEN
    RAISE EXCEPTION 'sales order customer_name exceeds 24 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "purchase_order_parts"
    WHERE "shipping_mark_text" IS NOT NULL AND char_length("shipping_mark_text") > 30
  ) THEN
    RAISE EXCEPTION 'purchase order part shipping_mark_text exceeds 30 characters';
  END IF;
END;
$$;

ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_customer_name_length_check"
  CHECK (char_length("customer_name") BETWEEN 1 AND 24);

ALTER TABLE "purchase_order_parts"
  ADD CONSTRAINT "purchase_order_parts_shipping_mark_text_length_check"
  CHECK ("shipping_mark_text" IS NULL OR char_length("shipping_mark_text") <= 30);

-- 权限：只允许维护本人别名；由服务端从登录上下文取 userId。
INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES (
  '00000000-0000-4000-8000-000000000215',
  'product-aliases:manage',
  '维护产品别名',
  '维护本人的产品别名，用于货件唛头展示',
  false
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" = 'product-aliases:manage'
WHERE role."code" = 'system_admin';

-- 运营产品库需要读取产品、产品媒体，并可维护本人别名。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" IN ('products:read', 'product-media:read', 'product-aliases:manage')
WHERE role."code" = 'operations_staff';

-- MigrationSelfCheck
DO $$
DECLARE
  actual_count INTEGER;
BEGIN
  SELECT count(*) INTO actual_count
  FROM "information_schema"."tables"
  WHERE "table_schema" = current_schema()
    AND "table_name" = 'user_product_aliases';
  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'user product aliases migration invariant mismatch: table missing';
  END IF;

  SELECT count(*) INTO actual_count
  FROM "pg_constraint"
  WHERE "conname" IN (
    'user_product_aliases_product_id_user_id_key',
    'user_product_aliases_alias_shape_check',
    'user_product_aliases_product_id_fkey',
    'user_product_aliases_user_id_fkey',
    'sales_orders_customer_name_length_check',
    'purchase_order_parts_shipping_mark_text_length_check'
  )
  AND "conrelid" IN (
    'user_product_aliases'::regclass,
    'sales_orders'::regclass,
    'purchase_order_parts'::regclass
  );
  IF actual_count <> 6 THEN
    RAISE EXCEPTION 'user product aliases migration invariant mismatch: constraints missing';
  END IF;

  SELECT count(*) INTO actual_count
  FROM "permissions"
  WHERE "id" = '00000000-0000-4000-8000-000000000215'
    AND "code" = 'product-aliases:manage'
    AND "system_only" = false;
  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'user product aliases migration invariant mismatch: permission missing';
  END IF;

  SELECT count(*) INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
  WHERE role."code" = 'system_admin'
    AND permission."code" = 'product-aliases:manage';
  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'user product aliases migration invariant mismatch: system admin grant missing';
  END IF;

  -- operations_staff 由 seed 维护；迁移只做存在时的增量授权，不能要求该角色在
  -- 迁移重放阶段已经存在（CI 空库先迁移、后 seed）。
  SELECT count(*) INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
  WHERE role."code" = 'operations_staff'
    AND permission."code" IN ('products:read', 'product-media:read', 'product-aliases:manage');
  IF EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'operations_staff') AND actual_count <> 3 THEN
    RAISE EXCEPTION 'user product aliases migration invariant mismatch: operations grants missing';
  END IF;

  -- 新增 enum 值在同一事务内不可见/不可使用，不能在当前 DO 块自检；
  -- ALTER TYPE ... ADD VALUE IF NOT EXISTS 本身保证幂等，后续迁移可继续扩展。
END;
$$;

COMMIT;
