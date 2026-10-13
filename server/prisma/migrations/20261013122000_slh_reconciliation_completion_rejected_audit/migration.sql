BEGIN;

-- 完成批次被退回（超收）时的审计事件：重置核对留痕是一次真实的状态变动，必须留痕。
-- 新值只供 migration 提交后的运行时代码使用，避免在同一 PostgreSQL 事务内提前引用。
ALTER TYPE "audit_event_type" ADD VALUE 'SLH_RECONCILIATION_BATCH_COMPLETION_REJECTED';

COMMIT;
