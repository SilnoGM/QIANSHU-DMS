BEGIN;

-- 看机预约从「登记 + 只读」扩展为可编辑、可推进状态并录入反馈。
-- update 与 create 分离：采运需要推进状态，但不应该能新建预约。
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'MACHINE_VIEWING_APPOINTMENT_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'MACHINE_VIEWING_APPOINTMENT_STATUS_CHANGED';

INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES (
  '00000000-0000-4000-8000-000000002435',
  'machine-viewings:update',
  '更新看机预约',
  '编辑待预约/已预约内容、推进状态、录入或修改反馈，并取消预约',
  false
);

-- 系统管理员始终持有全部权限；稳定 ID 与 code 双重约束避免授权漂移。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" = '00000000-0000-4000-8000-000000002435'
  AND permission."code" = 'machine-viewings:update';

-- 内置业务角色可能尚未 seed（空库重放）；存在时补授权，seed 会为新建角色写入同一权限。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" = 'machine-viewings:update'
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
  WHERE permission."id" = '00000000-0000-4000-8000-000000002435'
    AND permission."code" = 'machine-viewings:update'
    AND permission."name" = '更新看机预约'
    AND permission."system_only" = false;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'machine viewing update permission migration invariant mismatch: catalog';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
  WHERE role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin'
    AND permission."id" = '00000000-0000-4000-8000-000000002435'
    AND permission."code" = 'machine-viewings:update';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'machine viewing update permission migration invariant mismatch: system admin grant';
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
        AND permission."code" = 'machine-viewings:update';

      IF grant_count <> role_count THEN
        RAISE EXCEPTION 'machine viewing update permission migration invariant mismatch: built-in role grant missing for %', role_code;
      END IF;
    END IF;
  END LOOP;

  -- 财务只消费付款与审核结果，不参与看机预约的编辑与状态推进。
  IF EXISTS (
    SELECT 1
    FROM "role_permissions" AS grant_entry
    JOIN "roles" AS role ON role."id" = grant_entry."role_id"
    JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
    WHERE role."code" = 'finance_staff'
      AND permission."code" = 'machine-viewings:update'
  ) THEN
    RAISE EXCEPTION 'machine viewing update permission migration invariant mismatch: finance grant must be absent';
  END IF;
END;
$$;

COMMIT;
