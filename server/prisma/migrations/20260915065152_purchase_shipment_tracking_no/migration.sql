BEGIN;

-- 历史货件未记录单号时保留空值；不从唛头或编号推断物流单号。
ALTER TABLE "purchase_order_parts" ADD COLUMN "tracking_no" VARCHAR(100);
ALTER TABLE "purchase_order_parts" ADD CONSTRAINT "purchase_order_parts_tracking_no_check"
  CHECK (tracking_no IS NULL OR (
    shipped_at IS NOT NULL AND tracking_no !~ '^[[:space:]]*$' AND tracking_no !~ '[[:cntrl:]]'
  ));

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
    -- 物流单号随发货事实一次写入；既有单号不能通过重放、入仓或补号修改。
    IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE'
      AND OLD.shipped_at IS NULL AND NEW.shipped_at IS NOT NULL
      AND NEW.shipped_by_id IS NOT NULL AND NEW.shipment_recorded_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['shipped_at', 'shipped_by_id', 'shipment_recorded_at', 'shipment_remark', 'tracking_no'])
        = (to_jsonb(OLD) - ARRAY['shipped_at', 'shipped_by_id', 'shipment_recorded_at', 'shipment_remark', 'tracking_no'])
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

COMMIT;
