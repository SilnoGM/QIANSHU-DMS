BEGIN;

-- 千树小助理渠道退役后的审计日志清理：只删除事件类型以 ASSISTANT 开头的
-- 历史审计行，不修改其他业务审计。审计枚举标签保留，避免高风险的共享枚举
-- 重建；RESTRICT 外键不涉及 audit_events，删除不可逆。
DELETE FROM "audit_events"
WHERE "event_type"::text LIKE 'ASSISTANT%';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "audit_events"
    WHERE "event_type"::text LIKE 'ASSISTANT%'
  ) THEN
    RAISE EXCEPTION 'assistant audit events still exist after purge migration';
  END IF;
END $$;

COMMIT;
