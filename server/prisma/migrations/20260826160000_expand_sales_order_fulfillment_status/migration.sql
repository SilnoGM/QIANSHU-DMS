BEGIN;

-- 履约状态编码迁移必须与订单写入互斥，避免在 Enum 替换期间接收旧状态。
-- 历史表和审计表一并锁定，确保当前状态、历史记录和审计元数据在同一事务中完成转换。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

LOCK TABLE "sales_orders" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "sales_order_status_history" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "audit_events" IN SHARE ROW EXCLUSIVE MODE;

CREATE TYPE "sales_order_fulfillment_status_next" AS ENUM (
  'PENDING',
  'PREPARING',
  'LAND_TRANSIT',
  'WAREHOUSE_ARRIVED',
  'SEA_TRANSIT',
  'SIGNED'
);

ALTER TABLE "sales_orders"
  ALTER COLUMN "fulfillment_status" DROP DEFAULT;

ALTER TABLE "sales_orders"
  ALTER COLUMN "fulfillment_status"
  TYPE "sales_order_fulfillment_status_next"
  USING (
    CASE "fulfillment_status"::text
      WHEN 'SHIPPED' THEN 'LAND_TRANSIT'
      ELSE "fulfillment_status"::text
    END::"sales_order_fulfillment_status_next"
  );

DROP TYPE "sales_order_fulfillment_status";
ALTER TYPE "sales_order_fulfillment_status_next"
  RENAME TO "sales_order_fulfillment_status";

ALTER TABLE "sales_orders"
  ALTER COLUMN "fulfillment_status"
  SET DEFAULT 'PENDING';

-- 状态历史使用字符串保存编码。这里只做等价编码迁移，不制造新的业务流转记录。
UPDATE "sales_order_status_history"
SET "from_status" = 'LAND_TRANSIT'
WHERE "dimension" = 'FULFILLMENT'
  AND "from_status" = 'SHIPPED';

UPDATE "sales_order_status_history"
SET "to_status" = 'LAND_TRANSIT'
WHERE "dimension" = 'FULFILLMENT'
  AND "to_status" = 'SHIPPED';

-- 审计事件只替换履约状态字段，保留其他元数据和原始事件身份。
UPDATE "audit_events"
SET "metadata" = jsonb_set(
  "metadata",
  '{fromStatus}',
  to_jsonb('LAND_TRANSIT'::text),
  false
)
WHERE "event_type" = 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED'
  AND "metadata" ->> 'fromStatus' = 'SHIPPED';

UPDATE "audit_events"
SET "metadata" = jsonb_set(
  "metadata",
  '{toStatus}',
  to_jsonb('LAND_TRANSIT'::text),
  false
)
WHERE "event_type" = 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED'
  AND "metadata" ->> 'toStatus' = 'SHIPPED';

-- 迁移后对三类持久化状态逐项断言，任一残留都会回滚整个事务。
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
  WHERE enum_type."typname" = 'sales_order_fulfillment_status'
    AND enum_namespace."nspname" = current_schema();

  IF actual_values IS DISTINCT FROM ARRAY[
    'PENDING',
    'PREPARING',
    'LAND_TRANSIT',
    'WAREHOUSE_ARRIVED',
    'SEA_TRANSIT',
    'SIGNED'
  ]::text[] THEN
    RAISE EXCEPTION 'fulfillment status migration invariant mismatch: enum values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "sales_orders"
    WHERE "fulfillment_status"::text NOT IN (
      'PENDING',
      'PREPARING',
      'LAND_TRANSIT',
      'WAREHOUSE_ARRIVED',
      'SEA_TRANSIT',
      'SIGNED'
    )
  ) THEN
    RAISE EXCEPTION 'fulfillment status migration invariant mismatch: current status';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "sales_order_status_history"
    WHERE "dimension" = 'FULFILLMENT'
      AND ("from_status" = 'SHIPPED' OR "to_status" = 'SHIPPED')
  ) THEN
    RAISE EXCEPTION 'fulfillment status migration invariant mismatch: history';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "audit_events"
    WHERE "event_type" = 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED'
      AND (
        "metadata" ->> 'fromStatus' = 'SHIPPED'
        OR "metadata" ->> 'toStatus' = 'SHIPPED'
      )
  ) THEN
    RAISE EXCEPTION 'fulfillment status migration invariant mismatch: audit metadata';
  END IF;
END;
$$;

COMMIT;
