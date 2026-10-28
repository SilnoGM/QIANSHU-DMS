BEGIN;

-- 寄仓管理是运营可见页面；释放/移动/认领仍只授系统管理员。
-- 全新数据库可能尚未执行角色种子，此时不创建角色，只跳过授权。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."code" = 'shipment-storage:read'
WHERE role."code" = 'operations_staff'
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'operations_staff') THEN
    IF (
      SELECT count(*)
      FROM "role_permissions" AS grant_row
      JOIN "roles" AS role ON role."id" = grant_row."role_id"
      JOIN "permissions" AS permission ON permission."id" = grant_row."permission_id"
      WHERE role."code" = 'operations_staff' AND permission."code" = 'shipment-storage:read'
    ) <> 1 THEN
      RAISE EXCEPTION 'Shipment storage read grant is missing'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_read_grant_check';
    END IF;
  END IF;
END $$;

COMMIT;
