BEGIN;

-- 采运工作台承接寄仓管理：查看全量寄仓、移仓与直接调货。
-- 全新数据库可能尚未执行角色种子，此时不创建角色，只跳过授权。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."code" IN (
  'shipment-storage:read',
  'shipment-storage:relocate',
  'shipment-storage:claim'
)
WHERE role."code" = 'purchasing_staff'
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'purchasing_staff') THEN
    IF (
      SELECT count(*)
      FROM "role_permissions" AS grant_row
      JOIN "roles" AS role ON role."id" = grant_row."role_id"
      JOIN "permissions" AS permission ON permission."id" = grant_row."permission_id"
      WHERE role."code" = 'purchasing_staff'
        AND permission."code" IN (
          'shipment-storage:read',
          'shipment-storage:relocate',
          'shipment-storage:claim'
        )
    ) <> 3 THEN
      RAISE EXCEPTION 'Purchase transport shipment storage grants are incomplete'
        USING ERRCODE = '23514', CONSTRAINT = 'purchase_transport_shipment_storage_grant_check';
    END IF;
  END IF;
END $$;

COMMIT;
