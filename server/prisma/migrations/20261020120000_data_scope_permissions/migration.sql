BEGIN;

-- 数据范围开关：只影响业务查询的单据归属，不替代接口权限码。
-- 运营持有 self；财务、采运与系统管理员持有 all；all 在解析时优先。
INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES
  (
    '00000000-0000-4000-8000-000000002104'::uuid,
    'data-scope:self',
    '数据范围：本人',
    '仅访问本人归属的业务数据；与 data-scope:all 同时存在时以全量为准。',
    false
  ),
  (
    '00000000-0000-4000-8000-000000002105'::uuid,
    'data-scope:all',
    '数据范围：全部',
    '访问全部业务数据；优先于 data-scope:self。',
    false
  );

-- 系统管理员保持完整权限目录；两条都给，解析时 all 优先。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" = 'system_admin'
  AND permission."code" IN ('data-scope:self', 'data-scope:all')
ON CONFLICT DO NOTHING;

-- 运营只拿 self；即使误删该授权，服务端仍以 operations_staff 角色兜底为本人范围。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."code" = 'data-scope:self'
WHERE role."code" = 'operations_staff'
ON CONFLICT DO NOTHING;

-- 财务与采运显式拿 all，确保「运营+财务/采运」多角色用户不会被 self 收窄。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."code" = 'data-scope:all'
WHERE role."code" IN ('finance_staff', 'purchasing_staff')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM "permissions"
    WHERE ("id" = '00000000-0000-4000-8000-000000002104'::uuid AND "code" = 'data-scope:self' AND "system_only" = false)
       OR ("id" = '00000000-0000-4000-8000-000000002105'::uuid AND "code" = 'data-scope:all' AND "system_only" = false)
  ) <> 2 THEN
    RAISE EXCEPTION 'data scope permission migration invariant mismatch: permission catalog';
  END IF;

  IF (
    SELECT count(*) FROM "role_permissions" AS grant_row
    JOIN "roles" AS role ON role."id" = grant_row."role_id"
    JOIN "permissions" AS permission ON permission."id" = grant_row."permission_id"
    WHERE role."code" = 'system_admin'
      AND permission."code" IN ('data-scope:self', 'data-scope:all')
  ) <> 2 THEN
    RAISE EXCEPTION 'data scope permission migration invariant mismatch: system admin grants';
  END IF;

  IF EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'operations_staff') THEN
    IF NOT EXISTS (
      SELECT 1 FROM "role_permissions" AS grant_row
      JOIN "roles" AS role ON role."id" = grant_row."role_id"
      JOIN "permissions" AS permission ON permission."id" = grant_row."permission_id"
      WHERE role."code" = 'operations_staff' AND permission."code" = 'data-scope:self'
    ) THEN
      RAISE EXCEPTION 'data scope permission migration invariant mismatch: operations self grant';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'finance_staff') THEN
    IF NOT EXISTS (
      SELECT 1 FROM "role_permissions" AS grant_row
      JOIN "roles" AS role ON role."id" = grant_row."role_id"
      JOIN "permissions" AS permission ON permission."id" = grant_row."permission_id"
      WHERE role."code" = 'finance_staff' AND permission."code" = 'data-scope:all'
    ) THEN
      RAISE EXCEPTION 'data scope permission migration invariant mismatch: finance all grant';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'purchasing_staff') THEN
    IF NOT EXISTS (
      SELECT 1 FROM "role_permissions" AS grant_row
      JOIN "roles" AS role ON role."id" = grant_row."role_id"
      JOIN "permissions" AS permission ON permission."id" = grant_row."permission_id"
      WHERE role."code" = 'purchasing_staff' AND permission."code" = 'data-scope:all'
    ) THEN
      RAISE EXCEPTION 'data scope permission migration invariant mismatch: purchasing all grant';
    END IF;
  END IF;
END;
$$;

COMMIT;
