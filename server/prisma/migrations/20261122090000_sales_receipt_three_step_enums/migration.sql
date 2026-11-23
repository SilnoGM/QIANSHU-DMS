BEGIN;

-- 表外收款审核拆三步：提交（待发群）→ 发送水单（待确认）→ 确认收到（待入账）→ 核对入账（已完成）。
-- 本文件只追加枚举值；新增值在同一事务内不可比较，因此不做依赖新值的数据自检。
-- 状态机约束与触发器改写见下一个迁移。
ALTER TYPE "sales_receipt_request_status" ADD VALUE IF NOT EXISTS 'PENDING_CONFIRM';
ALTER TYPE "sales_receipt_request_status" ADD VALUE IF NOT EXISTS 'PENDING_POSTING';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'SALES_RECEIPT_VOUCHER_SENT';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'SALES_RECEIPT_CONFIRMED';

COMMIT;
