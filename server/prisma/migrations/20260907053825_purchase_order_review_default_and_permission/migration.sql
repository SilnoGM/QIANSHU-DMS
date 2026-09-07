-- 仅改变新采购单的默认值；历史采购单保持已审核的原业务状态。
ALTER TABLE "purchase_orders" ALTER COLUMN "order_status" SET DEFAULT 'PENDING_REVIEW';

-- 审核独立于通用更新权限，默认仅管理员拥有；system_only=false 允许后续按角色配置。
INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES (
  '00000000-0000-4000-8000-000000000165',
  'purchase-orders:review',
  '审核采购订单',
  '审核采购订单并确认进入备货',
  false
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."code" = 'purchase-orders:review';
