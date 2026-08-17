BEGIN;

-- SeedFundAccountReadPermission
-- 资金账户首期只有两个空白读取入口，因此只建立一个系统专用读取权限。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES (
  '00000000-0000-4000-8000-000000000147',
  'fund-accounts:read',
  '查询资金账户',
  '访问资金账户列表与资金账户流水页面',
  true
);

-- GrantSystemAdministratorFundAccountReadPermission
-- 稳定 ID 与 code 双重约束角色和权限，禁止目录漂移时静默授权错误对象。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" = '00000000-0000-4000-8000-000000000147'
  AND permission."code" = 'fund-accounts:read';

-- MigrationSelfCheck
-- 同一事务内证明目录、超级管理员授权及排他授权全部成立，否则整体回滚。
DO $$
DECLARE
  actual_count INTEGER;
BEGIN
  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions"
  WHERE "id" = '00000000-0000-4000-8000-000000000147'
    AND "code" = 'fund-accounts:read'
    AND "name" = '查询资金账户'
    AND "description" = '访问资金账户列表与资金账户流水页面'
    AND "system_only" = true;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'fund account permission migration invariant mismatch: permission catalog';
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
    AND permission."id" = '00000000-0000-4000-8000-000000000147'
    AND permission."code" = 'fund-accounts:read';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'fund account permission migration invariant mismatch: system admin grant';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role
    ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission
    ON permission."id" = grant_entry."permission_id"
  WHERE permission."id" = '00000000-0000-4000-8000-000000000147'
    AND permission."code" = 'fund-accounts:read'
    AND NOT (
      role."id" = '00000000-0000-4000-8000-000000000001'
      AND role."code" = 'system_admin'
    );

  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'fund account permission migration invariant mismatch: exclusive grant';
  END IF;
END;
$$;

COMMIT;
