BEGIN;

-- 删除履约枚举值需要替换 PostgreSQL Enum。迁移窗口锁定采购订单写入，避免并发事务写回旧状态。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

LOCK TABLE "purchase_orders" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "purchase_order_status_history" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "audit_events" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "purchase_orders"
  ALTER COLUMN "fulfillment_status" DROP DEFAULT;

CREATE TYPE "purchase_order_fulfillment_status_next" AS ENUM (
  'ORDERED',
  'PREPARING',
  'SHIPPED',
  'SIGNED'
);

ALTER TABLE "purchase_orders"
  ALTER COLUMN "fulfillment_status"
  TYPE "purchase_order_fulfillment_status_next"
  USING (
    CASE "fulfillment_status"::text
      WHEN 'PENDING_ORDER' THEN 'ORDERED'
      ELSE "fulfillment_status"::text
    END::"purchase_order_fulfillment_status_next"
  );

DROP TYPE "purchase_order_fulfillment_status";
ALTER TYPE "purchase_order_fulfillment_status_next"
  RENAME TO "purchase_order_fulfillment_status";

ALTER TABLE "purchase_orders"
  ALTER COLUMN "fulfillment_status"
  SET DEFAULT 'ORDERED';

-- 历史与审计保存的是字符串快照，仅做等价编码收敛，不制造新的状态变更事件。
UPDATE "purchase_order_status_history"
SET "from_status" = 'ORDERED'
WHERE "dimension" = 'FULFILLMENT'
  AND "from_status" = 'PENDING_ORDER';

UPDATE "purchase_order_status_history"
SET "to_status" = 'ORDERED'
WHERE "dimension" = 'FULFILLMENT'
  AND "to_status" = 'PENDING_ORDER';

UPDATE "audit_events"
SET "metadata" = jsonb_set(
  "metadata",
  '{fromStatus}',
  to_jsonb('ORDERED'::text),
  false
)
WHERE "event_type" = 'PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED'
  AND "metadata" ->> 'fromStatus' = 'PENDING_ORDER';

UPDATE "audit_events"
SET "metadata" = jsonb_set(
  "metadata",
  '{toStatus}',
  to_jsonb('ORDERED'::text),
  false
)
WHERE "event_type" = 'PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED'
  AND "metadata" ->> 'toStatus' = 'PENDING_ORDER';

-- 迁移末尾验证当前状态、历史和审计均不再残留已废弃编码，异常时回滚整个事务。
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
  WHERE enum_type."typname" = 'purchase_order_fulfillment_status'
    AND enum_namespace."nspname" = current_schema();

  IF actual_values IS DISTINCT FROM ARRAY[
    'ORDERED',
    'PREPARING',
    'SHIPPED',
    'SIGNED'
  ]::text[] THEN
    RAISE EXCEPTION 'purchase order fulfillment migration invariant mismatch: enum values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "purchase_order_status_history"
    WHERE "dimension" = 'FULFILLMENT'
      AND ("from_status" = 'PENDING_ORDER' OR "to_status" = 'PENDING_ORDER')
  ) THEN
    RAISE EXCEPTION 'purchase order fulfillment migration invariant mismatch: status history';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "audit_events"
    WHERE "event_type" = 'PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED'
      AND (
        "metadata" ->> 'fromStatus' = 'PENDING_ORDER'
        OR "metadata" ->> 'toStatus' = 'PENDING_ORDER'
      )
  ) THEN
    RAISE EXCEPTION 'purchase order fulfillment migration invariant mismatch: audit metadata';
  END IF;
END
$$;

COMMIT;
