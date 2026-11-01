BEGIN;

-- 销售单终止态：货物不再为该订单履约，但采购单、付款与已收款事实保持原样。
ALTER TYPE "sales_order_status" ADD VALUE 'TERMINATED';

-- 终止是与取消不同的业务事实，单独审计。
ALTER TYPE "audit_event_type" ADD VALUE 'SALES_ORDER_TERMINATED';

COMMIT;
