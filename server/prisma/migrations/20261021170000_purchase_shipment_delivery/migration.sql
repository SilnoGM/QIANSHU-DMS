BEGIN;

-- 客户签收是货件的最终物流事实，与仓库入仓（warehouse_received_at）和采购单签收（仓库收货）不同。
-- 新增事实列与一次性写入保护，并由延迟约束触发器保证「销售订单已签收 ⇒ 其下全部有效货件已签收」。
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_SHIPMENT_DELIVERED';

ALTER TABLE purchase_order_parts
  ADD COLUMN delivered_at TIMESTAMPTZ(6),
  ADD COLUMN delivered_by_id UUID,
  ADD COLUMN delivered_recorded_at TIMESTAMPTZ(6),
  ADD COLUMN delivery_remark VARCHAR(500),
  ADD CONSTRAINT purchase_order_parts_delivered_by_id_fkey
    FOREIGN KEY (delivered_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT purchase_order_parts_delivered_facts_check CHECK (
    (delivered_at IS NULL AND delivered_by_id IS NULL AND delivered_recorded_at IS NULL AND delivery_remark IS NULL)
    OR (delivered_at IS NOT NULL AND delivered_by_id IS NOT NULL AND delivered_recorded_at IS NOT NULL
      AND status = 'ACTIVE' AND loaded_at IS NOT NULL
      AND delivered_at >= loaded_at AND delivered_at <= delivered_recorded_at)
  );

CREATE INDEX purchase_order_parts_delivered_at_idx
  ON purchase_order_parts (delivered_at)
  WHERE delivered_at IS NOT NULL;

-- 签收时间不能晚于当前时钟；与「不早于装柜时间」的 CHECK 一起封闭事实时序。
CREATE FUNCTION enforce_purchase_delivery_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.delivered_at IS NOT NULL AND NEW.delivered_at > clock_timestamp())
    OR (NEW.delivered_recorded_at IS NOT NULL AND NEW.delivered_recorded_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'Shipment delivery time cannot be in the future'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_delivery_time_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_order_parts_delivery_time_trigger
  BEFORE INSERT OR UPDATE ON purchase_order_parts
  FOR EACH ROW EXECUTE FUNCTION enforce_purchase_delivery_time();

-- 只开放一次性签收事实写入；签收后不可改写、不可清空，也不能借签收变更发货、入仓或装柜事实。
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
    -- 装柜事实只允许一次写入：由装柜明细的服务端事务在关联前写入，之后不可改写、不可清空。
    IF OLD.loaded_at IS NULL AND OLD.loaded_by_id IS NULL AND OLD.loaded_recorded_at IS NULL
      AND NEW.loaded_at IS NOT NULL AND NEW.loaded_by_id IS NOT NULL AND NEW.loaded_recorded_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['loaded_at', 'loaded_by_id', 'loaded_recorded_at'])
        = (to_jsonb(OLD) - ARRAY['loaded_at', 'loaded_by_id', 'loaded_recorded_at'])
    THEN RETURN NEW; END IF;
    -- 客户签收事实只允许一次写入；签收后不可改写、不可清空。
    IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE'
      AND OLD.delivered_at IS NULL AND OLD.delivered_by_id IS NULL
      AND OLD.delivered_recorded_at IS NULL AND OLD.delivery_remark IS NULL
      AND NEW.delivered_at IS NOT NULL AND NEW.delivered_by_id IS NOT NULL
      AND NEW.delivered_recorded_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['delivered_at', 'delivered_by_id', 'delivered_recorded_at', 'delivery_remark'])
        = (to_jsonb(OLD) - ARRAY['delivered_at', 'delivered_by_id', 'delivered_recorded_at', 'delivery_remark'])
    THEN RETURN NEW; END IF;
    -- 补号只允许双空字段一次合法赋值；状态、唛头、分配身份、创建和发货事实必须完全不变。
    IF OLD.shipment_no IS NULL AND OLD.numbering_issuance_id IS NULL
      AND NEW.shipment_no IS NOT NULL AND NEW.numbering_issuance_id IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['shipment_no', 'numbering_issuance_id'])
        = (to_jsonb(OLD) - ARRAY['shipment_no', 'numbering_issuance_id'])
      AND purchase_shipment_number_matches(NEW.id, NEW.purchase_order_id, NEW.key, NEW.shipment_no, NEW.numbering_issuance_id)
    THEN RETURN NEW; END IF;
    -- 目的地仓库与物流单号随发货事实一次冻结；新发货必须记录仓库，重放、入仓与补号均不能改写。
    IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE'
      AND OLD.shipped_at IS NULL AND NEW.shipped_at IS NOT NULL
      AND NEW.destination_warehouse_value IS NOT NULL
      AND NEW.shipped_by_id IS NOT NULL AND NEW.shipment_recorded_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['shipped_at', 'shipped_by_id', 'shipment_recorded_at', 'shipment_remark', 'tracking_no', 'destination_warehouse_value'])
        = (to_jsonb(OLD) - ARRAY['shipped_at', 'shipped_by_id', 'shipment_recorded_at', 'shipment_remark', 'tracking_no', 'destination_warehouse_value'])
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
          AND orders.create_request_fingerprint_version IN ('purchase-order.create.v5', 'purchase-order.create.v6', 'purchase-order.create.v7')
          AND orders.order_status = 'PENDING_REVIEW' AND orders.fulfillment_status = 'ORDERED';
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

-- 存量回填：已签收销售订单的签收时间取自最近一次履约签收历史；历史缺失时退回有效签收单创建时间。
-- 任何已签收订单存在待审核或未装柜的有效货件、或签收时间早于装柜时间时，迁移失败关闭并交人工核对。
DO $$
DECLARE blocking_order TEXT;
BEGIN
  SELECT so.order_no INTO blocking_order
  FROM sales_orders so
  WHERE so.fulfillment_status = 'SIGNED'
    AND NOT EXISTS (
      SELECT 1 FROM sales_order_status_history h
      WHERE h.sales_order_id = so.id AND h.dimension = 'FULFILLMENT' AND h.to_status = 'SIGNED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM sales_order_documents d
      WHERE d.sales_order_id = so.id AND d.document_type = 'DELIVERY_RECEIPT' AND d.detached_at IS NULL
    )
  LIMIT 1;
  IF blocking_order IS NOT NULL THEN
    RAISE EXCEPTION 'Signed sales order % has no sign time evidence', blocking_order
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_shipment_delivery_backfill_check';
  END IF;

  SELECT so.order_no INTO blocking_order
  FROM sales_orders so
  JOIN purchase_orders po ON po.sales_order_id = so.id
    AND po.purchase_type = 'SALES_LINKED' AND po.order_status <> 'CANCELLED'
  JOIN purchase_order_parts p ON p.purchase_order_id = po.id
  WHERE so.fulfillment_status = 'SIGNED'
    AND (p.status = 'PENDING_REVIEW' OR (p.status = 'ACTIVE' AND p.loaded_at IS NULL))
  LIMIT 1;
  IF blocking_order IS NOT NULL THEN
    RAISE EXCEPTION 'Signed sales order % contains a pending-review or unloaded shipment', blocking_order
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_shipment_delivery_backfill_check';
  END IF;

  SELECT so.order_no INTO blocking_order
  FROM sales_orders so
  JOIN purchase_orders po ON po.sales_order_id = so.id
    AND po.purchase_type = 'SALES_LINKED' AND po.order_status <> 'CANCELLED'
  JOIN purchase_order_parts p ON p.purchase_order_id = po.id
  LEFT JOIN LATERAL (
    SELECT h.changed_at FROM sales_order_status_history h
    WHERE h.sales_order_id = so.id AND h.dimension = 'FULFILLMENT' AND h.to_status = 'SIGNED'
    ORDER BY h.changed_at DESC, h.id DESC LIMIT 1
  ) history ON true
  LEFT JOIN LATERAL (
    SELECT d.created_at FROM sales_order_documents d
    WHERE d.sales_order_id = so.id AND d.document_type = 'DELIVERY_RECEIPT' AND d.detached_at IS NULL
    ORDER BY d.created_at DESC, d.id DESC LIMIT 1
  ) receipt ON true
  WHERE so.fulfillment_status = 'SIGNED'
    AND p.status = 'ACTIVE'
    AND COALESCE(history.changed_at, receipt.created_at) < p.loaded_at
  LIMIT 1;
  IF blocking_order IS NOT NULL THEN
    RAISE EXCEPTION 'Signed sales order % has a sign time before shipment loading', blocking_order
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_shipment_delivery_backfill_check';
  END IF;
END $$;

WITH sign_facts AS (
  SELECT so.id AS sales_order_id,
         COALESCE(history.changed_at, receipt.created_at) AS signed_at,
         COALESCE(history.changed_by_user_id, receipt.created_by_user_id) AS signed_by
  FROM sales_orders so
  LEFT JOIN LATERAL (
    SELECT h.changed_at, h.changed_by_user_id FROM sales_order_status_history h
    WHERE h.sales_order_id = so.id AND h.dimension = 'FULFILLMENT' AND h.to_status = 'SIGNED'
    ORDER BY h.changed_at DESC, h.id DESC LIMIT 1
  ) history ON true
  LEFT JOIN LATERAL (
    SELECT d.created_at, d.created_by_user_id FROM sales_order_documents d
    WHERE d.sales_order_id = so.id AND d.document_type = 'DELIVERY_RECEIPT' AND d.detached_at IS NULL
    ORDER BY d.created_at DESC, d.id DESC LIMIT 1
  ) receipt ON true
  WHERE so.fulfillment_status = 'SIGNED'
)
UPDATE purchase_order_parts part
   SET delivered_at = facts.signed_at,
       delivered_by_id = facts.signed_by,
       delivered_recorded_at = facts.signed_at
  FROM purchase_orders orders
  JOIN sign_facts facts ON facts.sales_order_id = orders.sales_order_id
 WHERE part.purchase_order_id = orders.id
   AND orders.purchase_type = 'SALES_LINKED'
   AND orders.order_status <> 'CANCELLED'
   AND part.status = 'ACTIVE'
   AND part.delivered_at IS NULL;

-- 销售订单与货件两侧任一行变化都在提交时复核；签收事实与订单已签收必须同时成立。
CREATE FUNCTION enforce_sales_order_shipment_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_sales_order_id UUID;
  target_fulfillment TEXT;
  blocking_shipment TEXT;
BEGIN
  IF TG_TABLE_NAME = 'sales_orders' THEN
    target_sales_order_id := NEW.id;
  ELSE
    SELECT orders.sales_order_id INTO target_sales_order_id
    FROM purchase_orders orders
    WHERE orders.id = NEW.purchase_order_id;
  END IF;
  IF target_sales_order_id IS NULL THEN RETURN NULL; END IF;

  SELECT orders.fulfillment_status::text INTO target_fulfillment
  FROM sales_orders orders WHERE orders.id = target_sales_order_id;
  IF NOT FOUND OR target_fulfillment <> 'SIGNED' THEN RETURN NULL; END IF;

  SELECT COALESCE(part.shipment_no, '货件-' || part.part_number::text) INTO blocking_shipment
  FROM purchase_orders orders
  JOIN purchase_order_parts part ON part.purchase_order_id = orders.id
  WHERE orders.sales_order_id = target_sales_order_id
    AND orders.purchase_type = 'SALES_LINKED'
    AND orders.order_status <> 'CANCELLED'
    AND part.status <> 'CANCELLED'
    AND part.delivered_at IS NULL
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Sales order signed but shipment % is not delivered', blocking_shipment
      USING ERRCODE = '23514', CONSTRAINT = 'sales_orders_shipment_delivery_check';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sales_orders_shipment_delivery_trigger
  AFTER INSERT OR UPDATE ON sales_orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_sales_order_shipment_delivery();
CREATE CONSTRAINT TRIGGER purchase_order_parts_shipment_delivery_trigger
  AFTER INSERT OR UPDATE ON purchase_order_parts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_sales_order_shipment_delivery();

-- 结构自校验：列、约束与审计取值缺失即整单回滚。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'purchase_order_parts' AND column_name = 'delivered_at') THEN
    RAISE EXCEPTION 'Shipment delivery columns missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_event_type' AND e.enumlabel = 'PURCHASE_SHIPMENT_DELIVERED') THEN
    RAISE EXCEPTION 'Shipment delivery audit event missing' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM sales_orders so
    WHERE so.fulfillment_status = 'SIGNED'
      AND EXISTS (
        SELECT 1 FROM purchase_orders po
        JOIN purchase_order_parts p ON p.purchase_order_id = po.id
        WHERE po.sales_order_id = so.id
          AND po.purchase_type = 'SALES_LINKED'
          AND po.order_status <> 'CANCELLED'
          AND p.status <> 'CANCELLED'
          AND p.delivered_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'Shipment delivery backfill is incomplete' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
