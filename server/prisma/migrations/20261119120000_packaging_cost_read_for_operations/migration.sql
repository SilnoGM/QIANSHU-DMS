BEGIN;

-- 运营在「仓储运输 → 木架付款」查看本人提报的付款状态：装柜后货件离开到仓视图，
-- 提报人此前没有任何读取入口。只补读权限，写权限与付款权限仍只在财务侧。
-- 全新数据库可能尚未执行角色种子，此时不创建角色，只跳过授权；seed 会为新建角色写入同一权限。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" = 'packaging-costs:read'
WHERE role."code" = 'operations_staff'
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  expected_role_count integer;
  granted_role_count integer;
BEGIN
  SELECT count(*) INTO expected_role_count
  FROM "roles"
  WHERE "code" = 'operations_staff';

  IF expected_role_count > 0 THEN
    SELECT count(*) INTO granted_role_count
    FROM "role_permissions" AS grant_row
    JOIN "roles" AS role ON role."id" = grant_row."role_id"
    JOIN "permissions" AS permission ON permission."id" = grant_row."permission_id"
    WHERE role."code" = 'operations_staff'
      AND permission."code" = 'packaging-costs:read';

    IF granted_role_count <> expected_role_count THEN
      RAISE EXCEPTION 'Packaging cost read role grant is incomplete'
        USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_read_role_grant_check';
    END IF;
  END IF;
END $$;

COMMIT;
