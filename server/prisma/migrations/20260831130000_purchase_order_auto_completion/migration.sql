BEGIN;

-- PostgreSQL Enum 替换与采购订单写入互斥，避免迁移窗口接收旧状态集合。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

LOCK TABLE "purchase_orders" IN ACCESS EXCLUSIVE MODE;

-- 该约束触发器声明监听 order_status，必须在 Enum 列替换前移除；事务失败时 DROP 会一并回滚。
DROP TRIGGER "purchase_orders_source_quantity_trigger" ON "purchase_orders";

CREATE TYPE "purchase_order_status_next" AS ENUM (
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED'
);

ALTER TABLE "purchase_orders"
  ALTER COLUMN "order_status" DROP DEFAULT;

ALTER TABLE "purchase_orders"
  ALTER COLUMN "order_status"
  TYPE "purchase_order_status_next"
  USING ("order_status"::text::"purchase_order_status_next");

DROP TYPE "purchase_order_status";
ALTER TYPE "purchase_order_status_next"
  RENAME TO "purchase_order_status";

ALTER TABLE "purchase_orders"
  ALTER COLUMN "order_status"
  SET DEFAULT 'CONFIRMED';

-- migration 没有可信业务操作人，因此只校准当前事实，不伪造状态历史或审计事件。
UPDATE "purchase_orders"
SET "order_status" = 'COMPLETED'
WHERE "order_status" = 'CONFIRMED'
  AND "fulfillment_status" = 'SIGNED'
  AND "payment_status" = 'PAID';

-- 已完成必须始终同时满足已签收和已付清；服务层使用单次 UPDATE 维护三个状态维度。
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_completed_requires_signed_paid_check"
  CHECK (
    "order_status" <> 'COMPLETED'
    OR (
      "fulfillment_status" = 'SIGNED'
      AND "payment_status" = 'PAID'
    )
  );

-- 恢复采购来源数量约束；函数本身无需重建，且完成态仍属于未取消采购数量。
CREATE CONSTRAINT TRIGGER "purchase_orders_source_quantity_trigger"
AFTER INSERT OR UPDATE OF "order_status" ON "purchase_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_source_quantity"();

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
  WHERE enum_type."typname" = 'purchase_order_status'
    AND enum_namespace."nspname" = current_schema();

  IF actual_values IS DISTINCT FROM ARRAY[
    'CONFIRMED',
    'COMPLETED',
    'CANCELLED'
  ]::text[] THEN
    RAISE EXCEPTION 'purchase order completion migration invariant mismatch: enum values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "purchase_orders"
    WHERE "order_status" = 'COMPLETED'
      AND (
        "fulfillment_status" <> 'SIGNED'
        OR "payment_status" <> 'PAID'
      )
  ) THEN
    RAISE EXCEPTION 'purchase order completion migration invariant mismatch: completed order';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "purchase_orders"
    WHERE "order_status" = 'CONFIRMED'
      AND "fulfillment_status" = 'SIGNED'
      AND "payment_status" = 'PAID'
  ) THEN
    RAISE EXCEPTION 'purchase order completion migration invariant mismatch: backfill';
  END IF;
END;
$$;

COMMIT;
