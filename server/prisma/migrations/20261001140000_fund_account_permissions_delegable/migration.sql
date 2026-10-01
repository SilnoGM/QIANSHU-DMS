BEGIN;

-- MakeFundAccountPermissionsDelegable
-- 2026-10-01 决策：账户管理整组改为可委派。财务人员角色需要资金账户列表与流水，
-- 该域的 7 条权限不再保留 system_only，改由角色权限配置决定；服务端 PermissionGuard
-- 与审计逻辑不变，仍按角色的权限集合判定。既有授权（system_admin）不受影响。
UPDATE "permissions"
SET "system_only" = false
WHERE "code" IN (
  'fund-accounts:read',
  'fund-accounts:create',
  'fund-accounts:update-share-rate',
  'fund-accounts:manual-adjust',
  'fund-transactions:reverse',
  'fund-posting-types:manage',
  'fund-business-sources:manage'
);

-- MigrationSelfCheck
-- 同一事务内证明目录完整、标记已全部撤销且内置管理员授权未被牵连，否则整体回滚。
DO $$
DECLARE
  actual_count INTEGER;
BEGIN
  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions"
  WHERE "code" IN (
    'fund-accounts:read',
    'fund-accounts:create',
    'fund-accounts:update-share-rate',
    'fund-accounts:manual-adjust',
    'fund-transactions:reverse',
    'fund-posting-types:manage',
    'fund-business-sources:manage'
  );

  IF actual_count <> 7 THEN
    RAISE EXCEPTION 'fund account permission migration invariant mismatch: permission catalog';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions"
  WHERE "system_only" = true
    AND "code" IN (
      'fund-accounts:read',
      'fund-accounts:create',
      'fund-accounts:update-share-rate',
      'fund-accounts:manual-adjust',
      'fund-transactions:reverse',
      'fund-posting-types:manage',
      'fund-business-sources:manage'
    );

  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'fund account permission migration invariant mismatch: delegable set';
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
    AND permission."code" IN (
      'fund-accounts:read',
      'fund-accounts:create',
      'fund-accounts:update-share-rate',
      'fund-accounts:manual-adjust',
      'fund-transactions:reverse',
      'fund-posting-types:manage',
      'fund-business-sources:manage'
    );

  IF actual_count <> 7 THEN
    RAISE EXCEPTION 'fund account permission migration invariant mismatch: system admin grant';
  END IF;
END;
$$;

COMMIT;
