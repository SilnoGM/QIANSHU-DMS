BEGIN;

-- SeedPermissions
-- 顺联航账单领域尚未建立业务表或 API；本迁移只建立已确认页面所需的最小权限目录。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000166',
    'slh-bills:read',
    '查看顺联航账单',
    '访问顺联航账单管理页面',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000167',
    'slh-bills:reconcile',
    '核对顺联航账单',
    '访问顺联航账单对账页面',
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
    '00000000-0000-4000-8000-000000000166',
    '00000000-0000-4000-8000-000000000167'
  )
  AND permission."code" IN (
    'slh-bills:read',
    'slh-bills:reconcile'
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
        '00000000-0000-4000-8000-000000000166'::uuid,
        'slh-bills:read',
        '查看顺联航账单',
        '访问顺联航账单管理页面'
      ),
      (
        '00000000-0000-4000-8000-000000000167'::uuid,
        'slh-bills:reconcile',
        '核对顺联航账单',
        '访问顺联航账单对账页面'
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

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'slh bill permission migration invariant mismatch: permission catalog';
  END IF;

  WITH expected_permission("id", "code") AS (
    VALUES
      ('00000000-0000-4000-8000-000000000166'::uuid, 'slh-bills:read'),
      ('00000000-0000-4000-8000-000000000167'::uuid, 'slh-bills:reconcile')
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

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'slh bill permission migration invariant mismatch: system admin grants';
  END IF;
END;
$$;

COMMIT;
