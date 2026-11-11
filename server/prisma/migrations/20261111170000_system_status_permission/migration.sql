BEGIN;

-- SeedSystemStatusPermission
-- 系统状态页会暴露版本、环境、宿主资源与依赖健康信息，只允许内置系统管理员查看。
-- 该权限为 system_only，角色权限管理不会把它分配给普通角色；页面所在的
-- 「系统管理」分组仍由 audit:read 收敛，两者共同保证只有管理员能进入。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000002432',
    'system-status:read',
    '查看系统状态',
    '查看服务健康、资源使用、性能与运行信息；仅系统管理员可用',
    true
  );

-- GrantSystemAdministratorPermission
-- 通过稳定 ID 与 code 双重约束目标，避免角色或权限目录漂移时静默授权错误对象。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" = '00000000-0000-4000-8000-000000002432'
  AND permission."code" = 'system-status:read';

-- MigrationSelfCheck
-- 迁移必须在同一事务内证明权限目录与管理员授权都完整，否则整体回滚。
DO $$
DECLARE
  actual_count INTEGER;
BEGIN
  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions" AS permission
  WHERE permission."id" = '00000000-0000-4000-8000-000000002432'
    AND permission."code" = 'system-status:read'
    AND permission."name" = '查看系统状态'
    AND permission."description" = '查看服务健康、资源使用、性能与运行信息；仅系统管理员可用'
    AND permission."system_only" = true;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'system status permission migration invariant mismatch: permission catalog';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions" AS permission
  JOIN "role_permissions" AS grant_entry
    ON grant_entry."permission_id" = permission."id"
  JOIN "roles" AS role
    ON role."id" = grant_entry."role_id"
  WHERE permission."id" = '00000000-0000-4000-8000-000000002432'
    AND permission."code" = 'system-status:read'
    AND role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'system status permission migration invariant mismatch: system admin grant';
  END IF;
END;
$$;

COMMIT;
