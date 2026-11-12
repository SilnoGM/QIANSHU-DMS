BEGIN;

-- 运营在终止销售单时释放未处理货件，采运在货件详情直接释放。
-- 全新数据库可能尚未执行角色种子，此时不创建角色，只跳过授权；seed 会为新建角色写入同一权限。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" = 'shipment-storage:release'
WHERE role."code" IN ('operations_staff', 'purchasing_staff')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  expected_role_count integer;
  granted_role_count integer;
BEGIN
  SELECT count(*) INTO expected_role_count
  FROM "roles"
  WHERE "code" IN ('operations_staff', 'purchasing_staff');

  IF expected_role_count > 0 THEN
    SELECT count(*) INTO granted_role_count
    FROM "role_permissions" AS grant_row
    JOIN "roles" AS role ON role."id" = grant_row."role_id"
    JOIN "permissions" AS permission ON permission."id" = grant_row."permission_id"
    WHERE role."code" IN ('operations_staff', 'purchasing_staff')
      AND permission."code" = 'shipment-storage:release';

    IF granted_role_count <> expected_role_count THEN
      RAISE EXCEPTION 'Shipment storage release role grants are incomplete'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_release_role_grant_check';
    END IF;
  END IF;
END $$;

COMMIT;
