BEGIN;

-- 运营域独立于财务与系统域；新枚举值单独提交，后续迁移才可使用。
ALTER TYPE "notification_template_domain" ADD VALUE 'OPERATIONS';

COMMIT;
