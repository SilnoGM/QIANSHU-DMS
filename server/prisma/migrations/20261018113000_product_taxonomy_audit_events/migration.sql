BEGIN;

-- Product taxonomy catalogue changes are audited independently from product writes so
-- category/head renames and deletions remain traceable even when no Product changes.
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PRODUCT_CATEGORY_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PRODUCT_CATEGORY_RENAMED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PRODUCT_CATEGORY_DELETED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PRODUCT_HEAD_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PRODUCT_HEAD_RENAMED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PRODUCT_HEAD_DELETED';

COMMIT;
