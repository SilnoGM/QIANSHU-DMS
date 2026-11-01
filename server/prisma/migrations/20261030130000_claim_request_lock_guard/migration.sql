BEGIN;

-- 同一寄仓记录只允许一个 PENDING 申请，由创建事务在存储记录行锁内检查；
-- 不再使用 Prisma schema 无法表达的部分唯一索引，避免物理结构与 migration 历史漂移。
DROP INDEX IF EXISTS "shipment_storage_claim_requests_pending_record_key";

COMMIT;
