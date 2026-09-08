BEGIN;

-- 订单状态 Enum 替换必须与订单写入互斥，避免迁移窗口同时接收旧状态集合。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

LOCK TABLE "sales_orders" IN ACCESS EXCLUSIVE MODE;

CREATE TYPE "sales_order_status_next" AS ENUM (
  'DRAFT',
  'CONFIRMED',
  'PENDING_RECONCILIATION',
  'COMPLETED',
  'CANCELLED'
);

ALTER TABLE "sales_orders"
  ALTER COLUMN "order_status" DROP DEFAULT;

-- 旧三类状态按同名编码无损转换；本 migration 不自动推进任何业务订单。
ALTER TABLE "sales_orders"
  ALTER COLUMN "order_status"
  TYPE "sales_order_status_next"
  USING ("order_status"::text::"sales_order_status_next");

DROP TYPE "sales_order_status";
ALTER TYPE "sales_order_status_next"
  RENAME TO "sales_order_status";

ALTER TABLE "sales_orders"
  ALTER COLUMN "order_status"
  SET DEFAULT 'DRAFT';

-- 已完成是最终业务事实，数据库层拒绝任何不满足签收和付清条件的写入。
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_completed_requires_signed_paid_check"
  CHECK (
    "order_status" <> 'COMPLETED'
    OR (
      "fulfillment_status" = 'SIGNED'
      AND "payment_status" = 'PAID'
    )
  );

DO $$
DECLARE
  actual_values text[];
BEGIN
  SELECT array_agg(enum_value."enumlabel" ORDER BY enum_value."enumsortorder")
  INTO actual_values
  FROM "pg_type" AS enum_type
  INNER JOIN "pg_enum" AS enum_value
    ON enum_value."enumtypid" = enum_type."oid"
  INNER JOIN "pg_namespace" AS enum_namespace
    ON enum_namespace."oid" = enum_type."typnamespace"
  WHERE enum_type."typname" = 'sales_order_status'
    AND enum_namespace."nspname" = current_schema();

  IF actual_values IS DISTINCT FROM ARRAY[
    'DRAFT',
    'CONFIRMED',
    'PENDING_RECONCILIATION',
    'COMPLETED',
    'CANCELLED'
  ]::text[] THEN
    RAISE EXCEPTION 'sales order status migration invariant mismatch: enum values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "sales_orders"
    WHERE "order_status"::text NOT IN (
      'DRAFT',
      'CONFIRMED',
      'PENDING_RECONCILIATION',
      'COMPLETED',
      'CANCELLED'
    )
  ) THEN
    RAISE EXCEPTION 'sales order status migration invariant mismatch: current status';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "sales_orders"
    WHERE "order_status" = 'COMPLETED'
      AND (
        "fulfillment_status" <> 'SIGNED'
        OR "payment_status" <> 'PAID'
      )
  ) THEN
    RAISE EXCEPTION 'sales order status migration invariant mismatch: completed order';
  END IF;
END;
$$;

COMMIT;
