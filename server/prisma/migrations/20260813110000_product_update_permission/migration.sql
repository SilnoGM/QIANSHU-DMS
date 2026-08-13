BEGIN;

-- SeedProductUpdatePermission
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES (
  '00000000-0000-4000-8000-000000000145',
  'products:update',
  '编辑产品',
  '访问产品编辑页面并修改产品资料',
  false
);

-- GrantSystemAdministratorProductUpdatePermission
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" = '00000000-0000-4000-8000-000000000145'
  AND permission."code" = 'products:update';

-- MigrationSelfCheck
DO $$
DECLARE
  actual_count INTEGER;
BEGIN
  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions"
  WHERE "id" = '00000000-0000-4000-8000-000000000145'
    AND "code" = 'products:update'
    AND "name" = '编辑产品'
    AND "description" = '访问产品编辑页面并修改产品资料'
    AND "system_only" = false;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'product update permission migration invariant mismatch: permission catalog';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role
    ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission
    ON permission."id" = grant_entry."permission_id"
  WHERE role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin'
    AND permission."id" = '00000000-0000-4000-8000-000000000145'
    AND permission."code" = 'products:update';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'product update permission migration invariant mismatch: system admin grant';
  END IF;
END;
$$;

COMMIT;
