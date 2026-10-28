BEGIN;

-- 寄仓域：释放批次、寄仓记录、位置事件、认领行与成本事件。
-- 货件行、来源分配与物流事实保持不变；本迁移不改 purchase_order_parts 任何列。

-- CreateEnum
CREATE TYPE "shipment_storage_status" AS ENUM ('IN_STORAGE', 'RESERVED', 'CLAIMED', 'VOIDED');

-- CreateEnum
CREATE TYPE "shipment_storage_location_scope" AS ENUM ('MAINLAND', 'OVERSEAS');

-- CreateEnum
CREATE TYPE "shipment_cost_direction" AS ENUM ('RELEASE', 'CLAIM');

-- AlterEnum
ALTER TYPE "shipment_ownership_reason" ADD VALUE 'OTHER';

-- 审计事件：释放、寄仓记录、位置移动、认领、成本转移。
ALTER TYPE "audit_event_type" ADD VALUE 'SHIPMENT_OWNERSHIP_RELEASED';
ALTER TYPE "audit_event_type" ADD VALUE 'SHIPMENT_STORAGE_RECORDED';
ALTER TYPE "audit_event_type" ADD VALUE 'SHIPMENT_STORAGE_LOCATION_CHANGED';
ALTER TYPE "audit_event_type" ADD VALUE 'SHIPMENT_STORAGE_CLAIMED';
ALTER TYPE "audit_event_type" ADD VALUE 'SHIPMENT_COST_TRANSFERRED';

-- CreateTable
CREATE TABLE "shipment_release_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reason" VARCHAR(32) NOT NULL,
    "origin_sales_order_id" UUID,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_key" UUID NOT NULL,
    "payload_hash" BYTEA NOT NULL,
    "note" VARCHAR(500),

    CONSTRAINT "shipment_release_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipment_release_batches_reason_check" CHECK ("reason" ~ '[^[:space:]]')
);

-- CreateTable
CREATE TABLE "shipment_storage_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "release_batch_id" UUID NOT NULL,
    "status" "shipment_storage_status" NOT NULL DEFAULT 'IN_STORAGE',
    "location_scope" "shipment_storage_location_scope" NOT NULL,
    "warehouse_value" VARCHAR(64) NOT NULL,
    "warehouse_label_snapshot" VARCHAR(128),
    "location_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "shipment_no_snapshot" VARCHAR(64),
    "shipping_mark_snapshot" VARCHAR(72),
    "origin_purchase_order_id" UUID NOT NULL,
    "origin_purchase_order_no_snapshot" VARCHAR(64) NOT NULL,
    "origin_sales_order_id" UUID NOT NULL,
    "origin_sales_order_no_snapshot" VARCHAR(64) NOT NULL,
    "origin_customer_name_snapshot" VARCHAR(128) NOT NULL,
    "origin_issuer_user_id" UUID NOT NULL,
    "origin_allocations" JSONB NOT NULL,
    "container_snapshot" JSONB,
    "cost_snapshot" JSONB NOT NULL,
    "snapshot_at" TIMESTAMPTZ(6) NOT NULL,
    "claimed_sales_order_id" UUID,
    "claimed_at" TIMESTAMPTZ(6),
    "claimed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_storage_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipment_storage_records_claim_shape_check" CHECK (
      ("status" = 'CLAIMED') = (
        "claimed_sales_order_id" IS NOT NULL
        AND "claimed_at" IS NOT NULL
        AND "claimed_by" IS NOT NULL
      )
    )
);

-- CreateTable
CREATE TABLE "shipment_storage_location_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_record_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "location_scope" "shipment_storage_location_scope" NOT NULL,
    "warehouse_value" VARCHAR(64) NOT NULL,
    "warehouse_label_snapshot" VARCHAR(128),
    "reason" VARCHAR(500) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID NOT NULL,
    "request_key" UUID NOT NULL,
    "payload_hash" BYTEA NOT NULL,

    CONSTRAINT "shipment_storage_location_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipment_storage_location_events_sequence_check" CHECK ("sequence" >= 1),
    CONSTRAINT "shipment_storage_location_events_reason_check" CHECK ("reason" ~ '[^[:space:]]')
);

-- CreateTable
CREATE TABLE "shipment_claim_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_record_id" UUID NOT NULL,
    "sales_order_line_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "claimed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_by" UUID NOT NULL,

    CONSTRAINT "shipment_claim_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipment_claim_lines_quantity_check" CHECK ("quantity" > 0)
);

-- CreateTable
CREATE TABLE "shipment_cost_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_record_id" UUID NOT NULL,
    "direction" "shipment_cost_direction" NOT NULL,
    "transfer_group_id" UUID NOT NULL,
    "fund_posting_batch_ids" JSONB NOT NULL,
    "amount_cny" DECIMAL(30,2) NOT NULL,
    "legs_snapshot" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID NOT NULL,
    "request_key" UUID NOT NULL,
    "payload_hash" BYTEA NOT NULL,

    CONSTRAINT "shipment_cost_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipment_cost_events_amount_check" CHECK ("amount_cny" >= 0)
);

-- CreateIndex
CREATE INDEX "shipment_release_batches_occurred_idx" ON "shipment_release_batches"("occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "shipment_release_batches_actor_request_key" ON "shipment_release_batches"("actor_user_id", "request_key");

-- CreateIndex
CREATE INDEX "shipment_storage_records_status_location_idx" ON "shipment_storage_records"("status", "location_scope", "warehouse_value");

-- CreateIndex
CREATE INDEX "shipment_storage_records_shipment_created_idx" ON "shipment_storage_records"("shipment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "shipment_storage_records_origin_order_idx" ON "shipment_storage_records"("origin_sales_order_id", "created_at" DESC);

-- 同一货件只允许一条占用中的寄仓记录（在仓或已预留）。
CREATE UNIQUE INDEX "shipment_storage_records_active_key" ON "shipment_storage_records"("shipment_id") WHERE "status" IN ('IN_STORAGE', 'RESERVED');

-- CreateIndex
CREATE UNIQUE INDEX "shipment_storage_location_events_record_sequence_key" ON "shipment_storage_location_events"("storage_record_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_storage_location_events_actor_request_key" ON "shipment_storage_location_events"("actor_user_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_claim_lines_record_line_key" ON "shipment_claim_lines"("storage_record_id", "sales_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_cost_events_record_direction_key" ON "shipment_cost_events"("storage_record_id", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_cost_events_actor_request_key" ON "shipment_cost_events"("actor_user_id", "request_key");

-- AddForeignKey
ALTER TABLE "shipment_storage_records" ADD CONSTRAINT "shipment_storage_records_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "purchase_order_parts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_storage_records" ADD CONSTRAINT "shipment_storage_records_release_batch_id_fkey" FOREIGN KEY ("release_batch_id") REFERENCES "shipment_release_batches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_storage_location_events" ADD CONSTRAINT "shipment_storage_location_events_storage_record_id_fkey" FOREIGN KEY ("storage_record_id") REFERENCES "shipment_storage_records"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_claim_lines" ADD CONSTRAINT "shipment_claim_lines_storage_record_id_fkey" FOREIGN KEY ("storage_record_id") REFERENCES "shipment_storage_records"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_cost_events" ADD CONSTRAINT "shipment_cost_events_storage_record_id_fkey" FOREIGN KEY ("storage_record_id") REFERENCES "shipment_storage_records"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 寄仓记录不可删除；只允许状态推进、认领字段与位置字段更新。
CREATE FUNCTION enforce_shipment_storage_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  location_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Shipment storage records are append-only'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_records_immutable_check';
  END IF;
  location_changed :=
    NEW.location_scope IS DISTINCT FROM OLD.location_scope
    OR NEW.warehouse_value IS DISTINCT FROM OLD.warehouse_value
    OR NEW.warehouse_label_snapshot IS DISTINCT FROM OLD.warehouse_label_snapshot
    OR NEW.location_updated_at IS DISTINCT FROM OLD.location_updated_at;
  IF (to_jsonb(NEW) - ARRAY['status', 'claimed_sales_order_id', 'claimed_at', 'claimed_by', 'location_scope', 'warehouse_value', 'warehouse_label_snapshot', 'location_updated_at', 'updated_at'])
     <> (to_jsonb(OLD) - ARRAY['status', 'claimed_sales_order_id', 'claimed_at', 'claimed_by', 'location_scope', 'warehouse_value', 'warehouse_label_snapshot', 'location_updated_at', 'updated_at']) THEN
    RAISE EXCEPTION 'Shipment storage snapshot is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_records_immutable_check';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'IN_STORAGE' AND NEW.status IN ('RESERVED', 'CLAIMED', 'VOIDED'))
    OR (OLD.status = 'RESERVED' AND NEW.status IN ('CLAIMED', 'VOIDED'))
  ) THEN
    RAISE EXCEPTION 'Shipment storage status transition is invalid'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_records_status_check';
  END IF;
  IF location_changed AND OLD.status <> 'IN_STORAGE' THEN
    RAISE EXCEPTION 'Shipment storage location is frozen after reservation'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_records_location_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shipment_storage_records_immutable_trigger
  BEFORE UPDATE OR DELETE ON shipment_storage_records
  FOR EACH ROW EXECUTE FUNCTION enforce_shipment_storage_record_mutation();

-- 位置事件只追加、序号连续。
CREATE FUNCTION reject_shipment_storage_location_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Shipment storage location events are append-only'
    USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_location_events_immutable_check';
END $$;
CREATE TRIGGER shipment_storage_location_events_immutable_trigger
  BEFORE UPDATE OR DELETE ON shipment_storage_location_events
  FOR EACH ROW EXECUTE FUNCTION reject_shipment_storage_location_event_mutation();

CREATE FUNCTION enforce_shipment_storage_location_event_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected integer;
BEGIN
  PERFORM 1 FROM shipment_storage_records WHERE id = NEW.storage_record_id FOR UPDATE;
  SELECT COALESCE(MAX(sequence), 0) + 1 INTO expected
  FROM shipment_storage_location_events WHERE storage_record_id = NEW.storage_record_id;
  IF NEW.sequence <> expected THEN
    RAISE EXCEPTION 'Shipment storage location sequence must be contiguous'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_location_events_sequence_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shipment_storage_location_events_sequence_trigger
  BEFORE INSERT ON shipment_storage_location_events
  FOR EACH ROW EXECUTE FUNCTION enforce_shipment_storage_location_event_sequence();

-- 认领行与成本事件只追加。
CREATE FUNCTION reject_shipment_claim_line_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Shipment claim lines are append-only'
    USING ERRCODE = '23514', CONSTRAINT = 'shipment_claim_lines_immutable_check';
END $$;
CREATE TRIGGER shipment_claim_lines_immutable_trigger
  BEFORE UPDATE OR DELETE ON shipment_claim_lines
  FOR EACH ROW EXECUTE FUNCTION reject_shipment_claim_line_mutation();

CREATE FUNCTION reject_shipment_cost_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Shipment cost events are append-only'
    USING ERRCODE = '23514', CONSTRAINT = 'shipment_cost_events_immutable_check';
END $$;
CREATE TRIGGER shipment_cost_events_immutable_trigger
  BEFORE UPDATE OR DELETE ON shipment_cost_events
  FOR EACH ROW EXECUTE FUNCTION reject_shipment_cost_event_mutation();

-- 寄仓权限：查看/释放/位置移动/认领；首期仅系统管理员。
INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES
  ('00000000-0000-4000-8000-000000002420'::uuid, 'shipment-storage:read', '寄仓管理：查看', '查看寄仓记录与详情。', false),
  ('00000000-0000-4000-8000-000000002421'::uuid, 'shipment-storage:release', '寄仓管理：释放', '把货件从原销售单释放进寄仓池。', false),
  ('00000000-0000-4000-8000-000000002422'::uuid, 'shipment-storage:relocate', '寄仓管理：移动位置', '在海外仓之间移动寄仓货件。', false),
  ('00000000-0000-4000-8000-000000002423'::uuid, 'shipment-storage:claim', '寄仓管理：认领', '把寄仓货件认领到新销售单。', false);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" = 'system_admin'
  AND permission."code" IN (
    'shipment-storage:read',
    'shipment-storage:release',
    'shipment-storage:relocate',
    'shipment-storage:claim'
  )
ON CONFLICT DO NOTHING;

-- 结构自校验：表、权限与审计取值缺失即整体回滚。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'shipment_storage_records') THEN
    RAISE EXCEPTION 'Shipment storage tables are missing'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_schema_check';
  END IF;
  IF (SELECT count(*) FROM permissions WHERE code LIKE 'shipment-storage:%') <> 4 THEN
    RAISE EXCEPTION 'Shipment storage permissions are incomplete'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_permissions_check';
  END IF;
  IF (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'audit_event_type'
        AND e.enumlabel IN (
          'SHIPMENT_OWNERSHIP_RELEASED',
          'SHIPMENT_STORAGE_RECORDED',
          'SHIPMENT_STORAGE_LOCATION_CHANGED',
          'SHIPMENT_STORAGE_CLAIMED',
          'SHIPMENT_COST_TRANSFERRED'
        )) <> 5 THEN
    RAISE EXCEPTION 'Shipment storage audit events are missing'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_audit_check';
  END IF;
END $$;

COMMIT;
