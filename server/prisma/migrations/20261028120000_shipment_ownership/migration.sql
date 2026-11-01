BEGIN;

-- 货件归属层：来源采购单保持不变，当前业务归属由追加事件表达。
-- 本迁移只新增表、枚举、索引与触发器，并回填初始归属；不改动 purchase_order_parts 任何列。

-- CreateEnum
CREATE TYPE "shipment_owner_type" AS ENUM ('SALES_ORDER', 'STORAGE_POOL', 'COMPANY');

-- CreateEnum
CREATE TYPE "shipment_ownership_state" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateEnum
CREATE TYPE "shipment_ownership_reason" AS ENUM ('PURCHASE_CREATED', 'ORDER_CANCELLED', 'CUSTOMER_CANCEL', 'CUSTOMER_REJECT', 'RELEASE', 'CLAIM', 'CORRECTION');

-- CreateTable
CREATE TABLE "shipment_ownership_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "owner_type" "shipment_owner_type" NOT NULL,
    "owner_sales_order_id" UUID,
    "state" "shipment_ownership_state" NOT NULL DEFAULT 'ACTIVE',
    "reason" "shipment_ownership_reason" NOT NULL,
    "release_batch_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID NOT NULL,
    "request_key" UUID NOT NULL,
    "payload_hash" BYTEA NOT NULL,

    CONSTRAINT "shipment_ownership_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipment_ownership_events_sequence_check" CHECK ("sequence" >= 1),
    CONSTRAINT "shipment_ownership_events_owner_shape_check" CHECK (("owner_type" = 'SALES_ORDER') = ("owner_sales_order_id" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "shipment_ownership_current" (
    "shipment_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "owner_type" "shipment_owner_type" NOT NULL,
    "owner_sales_order_id" UUID,
    "state" "shipment_ownership_state" NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shipment_ownership_current_pkey" PRIMARY KEY ("shipment_id"),
    CONSTRAINT "shipment_ownership_current_owner_shape_check" CHECK (("owner_type" = 'SALES_ORDER') = ("owner_sales_order_id" IS NOT NULL))
);

-- CreateIndex
CREATE INDEX "shipment_ownership_events_shipment_sequence_idx" ON "shipment_ownership_events"("shipment_id", "sequence" DESC);

-- CreateIndex
CREATE INDEX "shipment_ownership_events_owner_occurred_idx" ON "shipment_ownership_events"("owner_sales_order_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "shipment_ownership_events_shipment_sequence_key" ON "shipment_ownership_events"("shipment_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_ownership_events_actor_request_key" ON "shipment_ownership_events"("actor_user_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_ownership_current_event_key" ON "shipment_ownership_current"("event_id");

-- CreateIndex
CREATE INDEX "shipment_ownership_current_owner_idx" ON "shipment_ownership_current"("owner_sales_order_id");

-- CreateIndex
CREATE INDEX "shipment_ownership_current_type_state_idx" ON "shipment_ownership_current"("owner_type", "state");

-- AddForeignKey
ALTER TABLE "shipment_ownership_events" ADD CONSTRAINT "shipment_ownership_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "purchase_order_parts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_ownership_events" ADD CONSTRAINT "shipment_ownership_events_owner_sales_order_id_fkey" FOREIGN KEY ("owner_sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_ownership_events" ADD CONSTRAINT "shipment_ownership_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_ownership_current" ADD CONSTRAINT "shipment_ownership_current_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "purchase_order_parts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_ownership_current" ADD CONSTRAINT "shipment_ownership_current_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "shipment_ownership_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_ownership_current" ADD CONSTRAINT "shipment_ownership_current_owner_sales_order_id_fkey" FOREIGN KEY ("owner_sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 归属事件只追加；与编号账本同一保护模式。
CREATE FUNCTION reject_shipment_ownership_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Shipment ownership events are append-only'
    USING ERRCODE = '23514', CONSTRAINT = 'shipment_ownership_events_immutable_check';
END $$;
CREATE TRIGGER shipment_ownership_events_immutable_trigger
  BEFORE UPDATE OR DELETE ON shipment_ownership_events
  FOR EACH ROW EXECUTE FUNCTION reject_shipment_ownership_event_mutation();

-- 同一货件的 sequence 必须连续；锁货件行串行化并发追加。
CREATE FUNCTION enforce_shipment_ownership_event_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected integer;
BEGIN
  PERFORM 1 FROM purchase_order_parts WHERE id = NEW.shipment_id FOR UPDATE;
  SELECT COALESCE(MAX(sequence), 0) + 1 INTO expected
  FROM shipment_ownership_events WHERE shipment_id = NEW.shipment_id;
  IF NEW.sequence <> expected THEN
    RAISE EXCEPTION 'Shipment ownership sequence must be contiguous'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_ownership_events_sequence_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shipment_ownership_events_sequence_trigger
  BEFORE INSERT ON shipment_ownership_events
  FOR EACH ROW EXECUTE FUNCTION enforce_shipment_ownership_event_sequence();

-- 当前归属投影由事件维护，读取方只查投影表。
CREATE FUNCTION project_shipment_ownership_current() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO shipment_ownership_current (
    shipment_id, event_id, owner_type, owner_sales_order_id, state, updated_at
  ) VALUES (
    NEW.shipment_id, NEW.id, NEW.owner_type, NEW.owner_sales_order_id, NEW.state, NEW.occurred_at
  )
  ON CONFLICT (shipment_id) DO UPDATE SET
    event_id = EXCLUDED.event_id,
    owner_type = EXCLUDED.owner_type,
    owner_sales_order_id = EXCLUDED.owner_sales_order_id,
    state = EXCLUDED.state,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END $$;
CREATE TRIGGER shipment_ownership_events_projection_trigger
  AFTER INSERT ON shipment_ownership_events
  FOR EACH ROW EXECUTE FUNCTION project_shipment_ownership_current();

-- 初始归属镜像现有采购链：SALES_LINKED 归销售单，STOCK/无来源归公司，已取消货件标记 VOIDED。
-- 不推断历史、不伪造时间：occurred_at 取货件创建时间，操作人取采购单创建人。
INSERT INTO shipment_ownership_events (
  id, shipment_id, sequence, owner_type, owner_sales_order_id, state, reason,
  occurred_at, actor_user_id, request_key, payload_hash
)
SELECT
  gen_random_uuid(),
  part.id,
  1,
  CASE
    WHEN orders.purchase_type = 'SALES_LINKED' AND orders.sales_order_id IS NOT NULL THEN 'SALES_ORDER'::shipment_owner_type
    ELSE 'COMPANY'::shipment_owner_type
  END,
  CASE WHEN orders.purchase_type = 'SALES_LINKED' THEN orders.sales_order_id ELSE NULL END,
  CASE
    WHEN part.status = 'CANCELLED' THEN 'VOIDED'::shipment_ownership_state
    ELSE 'ACTIVE'::shipment_ownership_state
  END,
  CASE
    WHEN part.status = 'CANCELLED' THEN 'ORDER_CANCELLED'::shipment_ownership_reason
    ELSE 'PURCHASE_CREATED'::shipment_ownership_reason
  END,
  part.created_at,
  orders.created_by_user_id,
  part.id,
  sha256(convert_to('shipment-ownership.backfill.v1:' || part.id::text, 'UTF8'))
FROM purchase_order_parts part
JOIN purchase_orders orders ON orders.id = part.purchase_order_id;

-- 结构自校验：任一项不成立即整体回滚。
DO $$
DECLARE
  part_count bigint;
  event_count bigint;
  current_count bigint;
BEGIN
  SELECT count(*) INTO part_count FROM purchase_order_parts;
  SELECT count(*) INTO event_count FROM shipment_ownership_events;
  SELECT count(*) INTO current_count FROM shipment_ownership_current;
  IF part_count <> event_count OR part_count <> current_count THEN
    RAISE EXCEPTION 'Shipment ownership backfill did not cover every part'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_ownership_backfill_coverage_check';
  END IF;
  IF EXISTS (SELECT 1 FROM shipment_ownership_events WHERE sequence <> 1) THEN
    RAISE EXCEPTION 'Shipment ownership backfill produced non-initial sequence'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_ownership_backfill_sequence_check';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM shipment_ownership_current current
    JOIN purchase_order_parts part ON part.id = current.shipment_id
    WHERE (part.status = 'CANCELLED') <> (current.state = 'VOIDED')
  ) THEN
    RAISE EXCEPTION 'Shipment ownership backfill state does not match part status'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_ownership_backfill_state_check';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM shipment_ownership_current current
    JOIN purchase_order_parts part ON part.id = current.shipment_id
    JOIN purchase_orders orders ON orders.id = part.purchase_order_id
    WHERE current.owner_type = 'SALES_ORDER'
      AND (orders.sales_order_id IS NULL OR current.owner_sales_order_id <> orders.sales_order_id)
  ) THEN
    RAISE EXCEPTION 'Shipment ownership backfill owner does not match purchase source'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_ownership_backfill_owner_check';
  END IF;
END $$;

COMMIT;
