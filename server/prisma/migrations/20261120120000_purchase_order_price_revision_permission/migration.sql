BEGIN;

-- 审核后修改采购金额使用独立权限：与入仓、取消等通用更新能力分离，避免任意
-- 「可更新采购单」的角色都能改价。运营从「全部采购」入口使用，采运从审核页使用；
-- 财务只负责付款，不授予改价。
INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES (
  '00000000-0000-4000-8000-000000002434',
  'purchase-orders:price-revision',
  '修改采购金额',
  '审核后修改采购单价与定金，并同步采购尾款应付',
  false
);

-- 系统管理员始终持有全部权限；稳定 ID 与 code 双重约束避免授权漂移。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" = '00000000-0000-4000-8000-000000002434'
  AND permission."code" = 'purchase-orders:price-revision';

-- 内置业务角色可能尚未 seed（空库重放）；存在时补授权，seed 会为新建角色写入同一权限。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" = 'purchase-orders:price-revision'
WHERE role."code" IN ('operations_staff', 'purchasing_staff')
ON CONFLICT DO NOTHING;

-- MigrationSelfCheck
DO $$
DECLARE
  actual_count integer;
  role_code text;
  role_count integer;
  grant_count integer;
BEGIN
  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions" AS permission
  WHERE permission."id" = '00000000-0000-4000-8000-000000002434'
    AND permission."code" = 'purchase-orders:price-revision'
    AND permission."name" = '修改采购金额'
    AND permission."system_only" = false;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'purchase price revision permission migration invariant mismatch: catalog';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
  WHERE role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin'
    AND permission."id" = '00000000-0000-4000-8000-000000002434'
    AND permission."code" = 'purchase-orders:price-revision';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'purchase price revision permission migration invariant mismatch: system admin grant';
  END IF;

  FOREACH role_code IN ARRAY ARRAY['operations_staff', 'purchasing_staff']
  LOOP
    SELECT count(*)::integer INTO role_count
    FROM "roles"
    WHERE "code" = role_code;

    IF role_count > 0 THEN
      SELECT count(*)::integer INTO grant_count
      FROM "role_permissions" AS grant_entry
      JOIN "roles" AS role ON role."id" = grant_entry."role_id"
      JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
      WHERE role."code" = role_code
        AND permission."code" = 'purchase-orders:price-revision';

      IF grant_count <> role_count THEN
        RAISE EXCEPTION 'purchase price revision permission migration invariant mismatch: built-in role grant missing for %', role_code;
      END IF;
    END IF;
  END LOOP;

  -- 财务只消费已确认的付款阶段，不能修改采购定价。
  IF EXISTS (
    SELECT 1
    FROM "role_permissions" AS grant_entry
    JOIN "roles" AS role ON role."id" = grant_entry."role_id"
    JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
    WHERE role."code" = 'finance_staff'
      AND permission."code" = 'purchase-orders:price-revision'
  ) THEN
    RAISE EXCEPTION 'purchase price revision permission migration invariant mismatch: finance grant must be absent';
  END IF;
END;
$$;

COMMIT;
