BEGIN;

-- SeedAdminWorkbenchPermission
-- 管理员工作台准入码。该工作台此前用「基础数据、产品管理、用户与角色、收款资料配置
-- 四个子模块读取权限的并集」做 any-of 门槛，任何业务角色一旦获得并集中的一条就会看到
-- 并进入管理员工作台：2026-10-15 授予运营与财务 `exchange-rates:read`（开票成本预估与
-- 结算核对）后，两个业务角色立即命中了该门槛。
-- 准入码可委派（system_only = false）：与另外三条 workbench 准入码一致，管理员工作台
-- 仍可由 `system_admin` 按需在角色权限里勾选授予，组内页面继续按各自业务码收敛。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000182',
    'workbench:admin',
    '进入管理员工作台',
    '顶级导航准入：可见并进入管理员工作台；组内页面仍按各自业务权限收敛',
    false
  );

-- GrantSystemAdministratorPermissions
-- 通过稳定 ID 与 code 双重约束目标，避免角色或权限目录发生漂移时静默授权错误对象。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" = '00000000-0000-4000-8000-000000000182'
  AND permission."code" = 'workbench:admin';

-- MigrationSelfCheck
-- 迁移必须在同一事务内证明权限目录与管理员授权都完整，否则整体回滚。
-- 不检查「其它角色未持有」：准入码本身可委派，后续由角色权限管理分配。
DO $$
DECLARE
  actual_count INTEGER;
BEGIN
  WITH expected_permission("id", "code", "name", "description") AS (
    VALUES
      (
        '00000000-0000-4000-8000-000000000182'::uuid,
        'workbench:admin',
        '进入管理员工作台',
        '顶级导航准入：可见并进入管理员工作台；组内页面仍按各自业务权限收敛'
      )
  )
  SELECT count(*)::integer
  INTO actual_count
  FROM expected_permission AS expected
  JOIN "permissions" AS permission
    ON permission."id" = expected."id"
    AND permission."code" = expected."code"
    AND permission."name" = expected."name"
    AND permission."description" = expected."description"
    AND permission."system_only" = false;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'admin workbench permission migration invariant mismatch: permission catalog';
  END IF;

  WITH expected_permission("id", "code") AS (
    VALUES ('00000000-0000-4000-8000-000000000182'::uuid, 'workbench:admin')
  )
  SELECT count(*)::integer
  INTO actual_count
  FROM expected_permission AS expected
  JOIN "permissions" AS permission
    ON permission."id" = expected."id"
    AND permission."code" = expected."code"
  JOIN "role_permissions" AS grant_entry
    ON grant_entry."permission_id" = permission."id"
  JOIN "roles" AS role
    ON role."id" = grant_entry."role_id"
  WHERE role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'admin workbench permission migration invariant mismatch: system admin grant';
  END IF;
END;
$$;

COMMIT;
