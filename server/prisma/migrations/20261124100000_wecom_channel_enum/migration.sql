BEGIN;

-- WECOM 渠道值必须单独提交，后续迁移才能在同一事务中引用它。
ALTER TYPE "notification_channel" ADD VALUE IF NOT EXISTS 'WECOM';

COMMIT;
