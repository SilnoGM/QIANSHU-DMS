BEGIN;

-- 旧签收记录没有可靠的逐货件入仓事实，不能用签收状态或迁移时间伪造实际到仓时间。
-- 有历史 SIGNED 的环境须先核验真实历史资料并明确补录策略，本迁移将整体回滚。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM purchase_orders WHERE fulfillment_status = 'SIGNED') THEN
    RAISE EXCEPTION 'Historical SIGNED purchase orders require verified warehouse receipt history before migration'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_warehouse_historical_signed_check';
  END IF;
END $$;

ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED';
ALTER TABLE purchase_order_parts
  ADD COLUMN warehouse_received_at TIMESTAMPTZ(6),
  ADD COLUMN warehouse_received_by_id UUID,
  ADD COLUMN warehouse_recorded_at TIMESTAMPTZ(6),
  ADD COLUMN warehouse_remark VARCHAR(500),
  ADD CONSTRAINT purchase_order_parts_warehouse_received_by_id_fkey FOREIGN KEY (warehouse_received_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT purchase_order_parts_warehouse_receipt_facts_check CHECK (
    (warehouse_received_at IS NULL AND warehouse_received_by_id IS NULL AND warehouse_recorded_at IS NULL AND warehouse_remark IS NULL)
    OR (warehouse_received_at IS NOT NULL AND warehouse_received_by_id IS NOT NULL AND warehouse_recorded_at IS NOT NULL
      AND status = 'ACTIVE' AND shipped_at IS NOT NULL
      AND warehouse_received_at >= shipped_at AND warehouse_received_at <= warehouse_recorded_at)
  );

-- 新货件不能带入仓事实；后续记录时间必须来自当前真实时钟，不能写入未来。
CREATE FUNCTION enforce_purchase_warehouse_receipt_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.warehouse_received_at IS NOT NULL)
    OR NEW.warehouse_recorded_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Warehouse receipts require a shipped part and a non-future recorded time'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_warehouse_receipt_time_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_order_parts_warehouse_time_trigger BEFORE INSERT OR UPDATE ON purchase_order_parts
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_warehouse_receipt_time();

CREATE OR REPLACE FUNCTION "reject_purchase_order_part_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_mark TEXT; has_multiple_parts BOOLEAN; parent_status TEXT;
BEGIN
  -- 保留一次补码及不可变配置保护，只开放与父采购单一致的货件生命周期。
  IF TG_TABLE_NAME = 'purchase_order_parts' AND TG_OP = 'UPDATE' THEN
    -- 入仓事实只允许已发有效货件一次写入；不能借此变更发货、编号、唛头或分配。
    IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE' AND OLD.shipped_at IS NOT NULL
      AND OLD.warehouse_received_at IS NULL AND OLD.warehouse_received_by_id IS NULL
      AND OLD.warehouse_recorded_at IS NULL AND OLD.warehouse_remark IS NULL
      AND NEW.warehouse_received_at IS NOT NULL AND NEW.warehouse_received_by_id IS NOT NULL
      AND NEW.warehouse_recorded_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['warehouse_received_at', 'warehouse_received_by_id', 'warehouse_recorded_at', 'warehouse_remark'])
        = (to_jsonb(OLD) - ARRAY['warehouse_received_at', 'warehouse_received_by_id', 'warehouse_recorded_at', 'warehouse_remark'])
      AND EXISTS (SELECT 1 FROM purchase_orders WHERE id = NEW.purchase_order_id
        AND order_status = 'CONFIRMED' AND fulfillment_status IN ('PARTIALLY_SHIPPED', 'SHIPPED'))
    THEN RETURN NEW; END IF;
    -- 补号只允许双空字段一次合法赋值；状态、唛头、分配身份、创建和发货事实必须完全不变。
    IF OLD.shipment_no IS NULL AND OLD.numbering_issuance_id IS NULL
      AND NEW.shipment_no IS NOT NULL AND NEW.numbering_issuance_id IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['shipment_no', 'numbering_issuance_id'])
        = (to_jsonb(OLD) - ARRAY['shipment_no', 'numbering_issuance_id'])
      AND purchase_shipment_number_matches(NEW.id, NEW.purchase_order_id, NEW.key, NEW.shipment_no, NEW.numbering_issuance_id)
    THEN RETURN NEW; END IF;
    -- 已发货事实只允许一次写入；不得借发货修改货件配置。
    IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE'
      AND OLD.shipped_at IS NULL AND NEW.shipped_at IS NOT NULL
      AND NEW.shipped_by_id IS NOT NULL AND NEW.shipment_recorded_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['shipped_at', 'shipped_by_id', 'shipment_recorded_at', 'shipment_remark'])
        = (to_jsonb(OLD) - ARRAY['shipped_at', 'shipped_by_id', 'shipment_recorded_at', 'shipment_remark'])
      AND EXISTS (SELECT 1 FROM purchase_orders WHERE id = NEW.purchase_order_id
        AND order_status::text IN ('CONFIRMED', 'COMPLETED')
        AND fulfillment_status::text IN ('PREPARING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'SIGNED'))
    THEN RETURN NEW; END IF;
    IF OLD.shipped_at IS NULL AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
      SELECT order_status::text INTO parent_status FROM "purchase_orders" WHERE id = NEW.purchase_order_id;
      IF FOUND AND (
        -- NULL 仅存在于本事务内的历史回填阶段；迁移完成后列的非空约束封闭此入口。
        (OLD.status IS NULL AND NEW.status::text = CASE parent_status
          WHEN 'PENDING_REVIEW' THEN 'PENDING_REVIEW'
          WHEN 'CANCELLED' THEN 'CANCELLED'
          ELSE 'ACTIVE' END)
        OR (OLD.status = 'PENDING_REVIEW' AND NEW.status = 'ACTIVE' AND parent_status = 'CONFIRMED')
        OR (OLD.status IN ('PENDING_REVIEW', 'ACTIVE') AND NEW.status = 'CANCELLED' AND parent_status = 'CANCELLED')
      ) THEN RETURN NEW; END IF;
    END IF;
    IF OLD.shipping_mark_text IS NULL AND NEW.shipping_mark_text IS NOT NULL
      AND (to_jsonb(NEW) - 'shipping_mark_text') = (to_jsonb(OLD) - 'shipping_mark_text') THEN
      SELECT orders.shipping_mark_text,
        EXISTS (SELECT 1 FROM "purchase_order_parts" part
          WHERE part.purchase_order_id = orders.id AND part.part_number = 2)
        INTO base_mark, has_multiple_parts
        FROM "purchase_orders" orders
        WHERE orders.id = NEW.purchase_order_id AND orders.part_configuration_sealed
          AND orders.create_request_fingerprint_version = 'purchase-order.create.v5'
          AND orders.order_status = 'CONFIRMED' AND orders.fulfillment_status = 'PREPARING';
      IF FOUND AND base_mark IS NOT NULL AND NEW.shipping_mark_text = (CASE WHEN has_multiple_parts
        THEN base_mark || '/货件-' || lpad(NEW.part_number::text, greatest(2, length(NEW.part_number::text)), '0')
        ELSE base_mark END) THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Purchase part configuration is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_immutable_check';
END;
$$;

-- 应用按“父单 -> 货件”的锁序先写货件、后推导父单，提交时统一检验，禁止绕过任一侧。
CREATE FUNCTION enforce_purchase_warehouse_receipt_aggregate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id UUID; parent_fulfillment TEXT; all_received BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'purchase_orders' THEN parent_id := NEW.id;
  ELSE parent_id := NEW.purchase_order_id; END IF;
  SELECT fulfillment_status::text INTO parent_fulfillment FROM purchase_orders WHERE id = parent_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT EXISTS (SELECT 1 FROM purchase_order_parts WHERE purchase_order_id = parent_id AND status = 'ACTIVE')
    AND NOT EXISTS (SELECT 1 FROM purchase_order_parts WHERE purchase_order_id = parent_id AND status <> 'CANCELLED'
      AND (status <> 'ACTIVE' OR warehouse_received_at IS NULL)) INTO all_received;
  IF (parent_fulfillment = 'SIGNED') <> all_received THEN
    RAISE EXCEPTION 'Purchase signing must equal receipt of all valid shipments'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_warehouse_receipt_aggregate_check';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER purchase_orders_warehouse_aggregate_trigger AFTER INSERT OR UPDATE ON purchase_orders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_purchase_warehouse_receipt_aggregate();
CREATE CONSTRAINT TRIGGER purchase_order_parts_warehouse_aggregate_trigger AFTER INSERT OR UPDATE ON purchase_order_parts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_purchase_warehouse_receipt_aggregate();

COMMIT;
