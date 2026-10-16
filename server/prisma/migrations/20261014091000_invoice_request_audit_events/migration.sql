-- 开票申请与审批的审计事件：提交、重新提交、退回、审核并通知、上传发票照片、结算入账、取消。
-- 新值只供本迁移提交后的运行时代码使用，因此单独成一条迁移，避免在同一 PostgreSQL 事务内提前引用。
BEGIN;

ALTER TYPE "audit_event_type" ADD VALUE 'INVOICE_REQUEST_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'INVOICE_REQUEST_RESUBMITTED';
ALTER TYPE "audit_event_type" ADD VALUE 'INVOICE_REQUEST_RETURNED';
ALTER TYPE "audit_event_type" ADD VALUE 'INVOICE_REQUEST_NOTIFIED';
ALTER TYPE "audit_event_type" ADD VALUE 'INVOICE_REQUEST_DOCUMENT_UPLOADED';
ALTER TYPE "audit_event_type" ADD VALUE 'INVOICE_REQUEST_SETTLED';
ALTER TYPE "audit_event_type" ADD VALUE 'INVOICE_REQUEST_CANCELLED';

-- 值集合不变量校验：只读 pg_enum，按声明顺序比对追加结果。
DO $$
DECLARE
  actual_values text[];
BEGIN
  SELECT array_agg(enum_value."enumlabel"::text ORDER BY enum_value."enumsortorder")
  INTO actual_values
  FROM "pg_type" enum_type
  JOIN "pg_enum" enum_value ON enum_value."enumtypid" = enum_type."oid"
  JOIN "pg_namespace" enum_namespace ON enum_namespace."oid" = enum_type."typnamespace"
  WHERE enum_type."typname" = 'audit_event_type' AND enum_namespace."nspname" = current_schema();

  IF actual_values IS NULL
    OR actual_values[array_length(actual_values, 1) - 6 : array_length(actual_values, 1)]
      IS DISTINCT FROM ARRAY[
        'INVOICE_REQUEST_CREATED',
        'INVOICE_REQUEST_RESUBMITTED',
        'INVOICE_REQUEST_RETURNED',
        'INVOICE_REQUEST_NOTIFIED',
        'INVOICE_REQUEST_DOCUMENT_UPLOADED',
        'INVOICE_REQUEST_SETTLED',
        'INVOICE_REQUEST_CANCELLED'
      ]::text[] THEN
    RAISE EXCEPTION 'invoice request audit event enum invariant mismatch' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
