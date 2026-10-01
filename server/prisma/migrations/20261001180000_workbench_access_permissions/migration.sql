BEGIN;

-- SeedWorkbenchAccessPermissions
-- 工作台准入码：决定顶级导航分组的可见与直接 URL 准入，与业务域权限解耦。
-- 业务域权限码在工作台之间共享（`purchase-orders:payment` 同时是运营侧申请付款与
-- 财务侧采购付款的门槛，`purchase-orders:read` 同时服务运营与采运工作台），用它做
-- 分组门槛会让一个角色同时看到多个工作台；准入码只授权工作台本身，组内页面继续
-- 按业务码收敛。三条码都可分配给普通角色，由角色权限管理决定谁能进入哪个工作台。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000168',
    'workbench:operations',
    '进入运营工作台',
    '顶级导航准入：可见并进入千树运营工作台',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000169',
    'workbench:finance',
    '进入财务工作台',
    '顶级导航准入：可见并进入千树财务工作台',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000170',
    'workbench:purchase-transport',
    '进入采运工作台',
    '顶级导航准入：可见并进入千树采运工作台',
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
  AND permission."id" IN (
    '00000000-0000-4000-8000-000000000168',
    '00000000-0000-4000-8000-000000000169',
    '00000000-0000-4000-8000-000000000170'
  )
  AND permission."code" IN (
    'workbench:operations',
    'workbench:finance',
    'workbench:purchase-transport'
  );

-- MigrationSelfCheck
-- 迁移必须在同一事务内证明权限目录与管理员授权都完整，否则整体回滚。
DO $$
DECLARE
  actual_count INTEGER;
BEGIN
  WITH expected_permission("id", "code", "name", "description") AS (
    VALUES
      (
        '00000000-0000-4000-8000-000000000168'::uuid,
        'workbench:operations',
        '进入运营工作台',
        '顶级导航准入：可见并进入千树运营工作台'
      ),
      (
        '00000000-0000-4000-8000-000000000169'::uuid,
        'workbench:finance',
        '进入财务工作台',
        '顶级导航准入：可见并进入千树财务工作台'
      ),
      (
        '00000000-0000-4000-8000-000000000170'::uuid,
        'workbench:purchase-transport',
        '进入采运工作台',
        '顶级导航准入：可见并进入千树采运工作台'
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

  IF actual_count <> 3 THEN
    RAISE EXCEPTION 'workbench access permission migration invariant mismatch: permission catalog';
  END IF;

  WITH expected_permission("id", "code") AS (
    VALUES
      ('00000000-0000-4000-8000-000000000168'::uuid, 'workbench:operations'),
      ('00000000-0000-4000-8000-000000000169'::uuid, 'workbench:finance'),
      ('00000000-0000-4000-8000-000000000170'::uuid, 'workbench:purchase-transport')
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

  IF actual_count <> 3 THEN
    RAISE EXCEPTION 'workbench access permission migration invariant mismatch: system admin grants';
  END IF;
END;
$$;

COMMIT;
