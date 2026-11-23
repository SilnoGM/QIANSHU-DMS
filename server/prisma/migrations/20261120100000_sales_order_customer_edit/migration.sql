BEGIN;

-- 销售订单客户信息与出单信息编辑：只追加审计事件与状态历史维度，不建表、不改列、不回填。
-- 新增枚举值在本事务内不可比较，因此本文件不做依赖新值的数据自检；业务表结构完全不变。
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'SALES_ORDER_CUSTOMER_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'SALES_ORDER_SALES_INFO_UPDATED';
ALTER TYPE "sales_order_status_dimension" ADD VALUE IF NOT EXISTS 'CUSTOMER';
ALTER TYPE "sales_order_status_dimension" ADD VALUE IF NOT EXISTS 'SALES_INFO';

COMMIT;
