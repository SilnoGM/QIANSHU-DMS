BEGIN;

-- 代收货款渠道的收款来源与收款类型：由顺联航账单对账完成时的结算回填产生。
-- 新值只供 migration 提交后的运行时代码与后续迁移使用，避免在同一 PostgreSQL 事务内提前引用。
ALTER TYPE "sales_order_payment_origin" ADD VALUE 'COD_SETTLEMENT';
ALTER TYPE "sales_order_payment_type" ADD VALUE 'COD_BALANCE';

-- 值集合不变量校验：只读取 pg_enum，用 text[] 比对，不触碰枚举值本身。
DO $$
DECLARE
  actual_origin text[];
  actual_type text[];
BEGIN
  SELECT array_agg(enum_value."enumlabel" ORDER BY enum_value."enumsortorder")
  INTO actual_origin
  FROM "pg_type" AS enum_type
  INNER JOIN "pg_enum" AS enum_value
    ON enum_value."enumtypid" = enum_type."oid"
  INNER JOIN "pg_namespace" AS enum_namespace
    ON enum_namespace."oid" = enum_type."typnamespace"
  WHERE enum_type."typname" = 'sales_order_payment_origin'
    AND enum_namespace."nspname" = current_schema();

  IF actual_origin IS DISTINCT FROM ARRAY[
    'LEGACY',
    'REVIEWED',
    'COD_SETTLEMENT'
  ]::text[] THEN
    RAISE EXCEPTION 'sales payment origin migration invariant mismatch: enum values';
  END IF;

  SELECT array_agg(enum_value."enumlabel" ORDER BY enum_value."enumsortorder")
  INTO actual_type
  FROM "pg_type" AS enum_type
  INNER JOIN "pg_enum" AS enum_value
    ON enum_value."enumtypid" = enum_type."oid"
  INNER JOIN "pg_namespace" AS enum_namespace
    ON enum_namespace."oid" = enum_type."typnamespace"
  WHERE enum_type."typname" = 'sales_order_payment_type'
    AND enum_namespace."nspname" = current_schema();

  IF actual_type IS DISTINCT FROM ARRAY[
    'DEPOSIT',
    'PROGRESS',
    'INVOICE_TAX',
    'BALANCE',
    'OTHER',
    'COD_BALANCE'
  ]::text[] THEN
    RAISE EXCEPTION 'sales payment type migration invariant mismatch: enum values';
  END IF;
END $$;

COMMIT;
