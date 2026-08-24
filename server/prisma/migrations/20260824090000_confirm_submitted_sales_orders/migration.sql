BEGIN;

-- 历史新增页执行的是正式提交并派号，但旧实现依赖默认值将订单保存为草稿。
-- 仅修复仍为 DRAFT 的订单，保留既有 CONFIRMED/CANCELLED 及付款、履约状态。
UPDATE "sales_orders"
SET
  "order_status" = 'CONFIRMED',
  "version" = "version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "order_status" = 'DRAFT';

COMMIT;
