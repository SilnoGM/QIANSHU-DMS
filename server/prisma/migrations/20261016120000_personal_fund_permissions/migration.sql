BEGIN;

-- SeedPersonalFundPermissions
-- 个人财务（运营自助）与提款审批的三条权限：查看本人资金账户、提交提款申请、审批账户提款。
-- 全部可委派（system_only = false）：运营侧持有本人账户读取与提款提交，财务侧持有提款审批，
-- 由角色权限管理决定具体分配。本人账户读取必须与财务侧的全量 `fund-accounts:read` 分开，
-- 否则运营会连带获得所有人账户与流水的服务端读取资格。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000179',
    'fund-accounts:read-self',
    '查看本人资金账户',
    '查看本人资金账户与本人资金流水；不等于财务侧的全量账户视图',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000180',
    'fund-withdrawals:create',
    '提交提款申请',
    '从本人资金账户提交提款申请并查看本人提款记录',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000181',
    'fund-withdrawals:review',
    '审批账户提款',
    '审批运营提交的提款申请并记录审批结果',
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
    '00000000-0000-4000-8000-000000000179',
    '00000000-0000-4000-8000-000000000180',
    '00000000-0000-4000-8000-000000000181'
  )
  AND permission."code" IN (
    'fund-accounts:read-self',
    'fund-withdrawals:create',
    'fund-withdrawals:review'
  );

-- GrantBusinessRolePermissions
-- 运营持有本人账户读取与提款提交，财务持有提款审批：两个内置业务角色由 seed 建立，
-- 全新库此处可为空集，既有库按角色码与权限码幂等补齐，不改其它角色、不改任何数据行。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE (
    (
      role."code" = 'operations_staff'
      AND permission."code" IN ('fund-accounts:read-self', 'fund-withdrawals:create')
    )
    OR (
      role."code" = 'finance_staff'
      AND permission."code" = 'fund-withdrawals:review'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" AS grant_entry
    WHERE grant_entry."role_id" = role."id"
      AND grant_entry."permission_id" = permission."id"
  );

-- MigrationSelfCheck
-- 迁移必须在同一事务内证明权限目录、管理员授权与业务角色授权三部分都完整，否则整体回滚。
DO $$
DECLARE
  actual_count INTEGER;
  expected_count INTEGER;
BEGIN
  WITH expected_permission("id", "code", "name", "description") AS (
    VALUES
      (
        '00000000-0000-4000-8000-000000000179'::uuid,
        'fund-accounts:read-self',
        '查看本人资金账户',
        '查看本人资金账户与本人资金流水；不等于财务侧的全量账户视图'
      ),
      (
        '00000000-0000-4000-8000-000000000180'::uuid,
        'fund-withdrawals:create',
        '提交提款申请',
        '从本人资金账户提交提款申请并查看本人提款记录'
      ),
      (
        '00000000-0000-4000-8000-000000000181'::uuid,
        'fund-withdrawals:review',
        '审批账户提款',
        '审批运营提交的提款申请并记录审批结果'
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
    RAISE EXCEPTION 'personal fund permission migration invariant mismatch: permission catalog';
  END IF;

  WITH expected_permission("id", "code") AS (
    VALUES
      ('00000000-0000-4000-8000-000000000179'::uuid, 'fund-accounts:read-self'),
      ('00000000-0000-4000-8000-000000000180'::uuid, 'fund-withdrawals:create'),
      ('00000000-0000-4000-8000-000000000181'::uuid, 'fund-withdrawals:review')
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
    RAISE EXCEPTION 'personal fund permission migration invariant mismatch: system admin grants';
  END IF;

  WITH expected_grant("role_code", "permission_code") AS (
    VALUES
      ('operations_staff', 'fund-accounts:read-self'),
      ('operations_staff', 'fund-withdrawals:create'),
      ('finance_staff', 'fund-withdrawals:review')
  ),
  existing_role AS (
    SELECT role."id", role."code"
    FROM "roles" AS role
    WHERE role."code" IN ('operations_staff', 'finance_staff')
  )
  SELECT count(*)::integer
  INTO expected_count
  FROM expected_grant AS expected
  JOIN existing_role AS role
    ON role."code" = expected."role_code";

  WITH expected_grant("role_code", "permission_code") AS (
    VALUES
      ('operations_staff', 'fund-accounts:read-self'),
      ('operations_staff', 'fund-withdrawals:create'),
      ('finance_staff', 'fund-withdrawals:review')
  ),
  existing_role AS (
    SELECT role."id", role."code"
    FROM "roles" AS role
    WHERE role."code" IN ('operations_staff', 'finance_staff')
  )
  SELECT count(*)::integer
  INTO actual_count
  FROM expected_grant AS expected
  JOIN existing_role AS role
    ON role."code" = expected."role_code"
  JOIN "permissions" AS permission
    ON permission."code" = expected."permission_code"
  JOIN "role_permissions" AS grant_entry
    ON grant_entry."role_id" = role."id"
    AND grant_entry."permission_id" = permission."id";

  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'personal fund permission migration invariant mismatch: role grants';
  END IF;
END;
$$;

COMMIT;
