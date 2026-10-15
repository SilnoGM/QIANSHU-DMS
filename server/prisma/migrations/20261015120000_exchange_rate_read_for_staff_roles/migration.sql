BEGIN;

-- GrantExchangeRateReadToInvoiceRoles
-- 2026-10-15 决策：开票流程的两端都要读系统台币汇率——运营在「开票申请」页做成本预估、
-- 财务在结算入账前按当前汇率核对入账金额。exchange-rates:read 是可委派的普通业务权限，
-- 这里把它授予两个内置业务角色；不修改 schema、权限目录、任何其它角色的授权与数据行。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" IN ('operations_staff', 'finance_staff')
  AND permission."code" = 'exchange-rates:read'
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" AS grant_entry
    WHERE grant_entry."role_id" = role."id"
      AND grant_entry."permission_id" = permission."id"
  );

-- MigrationSelfCheck
-- 同一事务内证明：权限目录里该码唯一且可委派；两个角色凡存在就必须已持有该授权
-- （角色由 seed 建立，全新库此处可为空集），任一不满足即整体回滚。
DO $$
DECLARE
  delegable_total INTEGER;
  role_total INTEGER;
  grant_total INTEGER;
BEGIN
  SELECT count(*)::integer
  INTO delegable_total
  FROM "permissions"
  WHERE "code" = 'exchange-rates:read'
    AND "system_only" = false;

  IF delegable_total <> 1 THEN
    RAISE EXCEPTION 'exchange rate read migration invariant mismatch: permission catalog';
  END IF;

  SELECT count(*)::integer
  INTO role_total
  FROM "roles"
  WHERE "code" IN ('operations_staff', 'finance_staff');

  SELECT count(*)::integer
  INTO grant_total
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role
    ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission
    ON permission."id" = grant_entry."permission_id"
  WHERE role."code" IN ('operations_staff', 'finance_staff')
    AND permission."code" = 'exchange-rates:read';

  IF grant_total <> role_total THEN
    RAISE EXCEPTION 'exchange rate read migration invariant mismatch: role grants';
  END IF;
END;
$$;

COMMIT;
