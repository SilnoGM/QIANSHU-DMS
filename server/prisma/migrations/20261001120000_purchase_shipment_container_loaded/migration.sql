BEGIN;

-- 装柜事实：货件被装柜明细行关联即写一次，此后不可改写、不可清空，「不回退」由此在数据层封闭。
-- 事实与审核状态正交：历史存量可能挂在非活跃货件上，采购单取消也不清除该事实，故两处约束都不带 status 条件。
ALTER TABLE purchase_order_parts
  ADD COLUMN loaded_at TIMESTAMPTZ(6),
  ADD COLUMN loaded_by_id UUID,
  ADD COLUMN loaded_recorded_at TIMESTAMPTZ(6),
  ADD CONSTRAINT "purchase_order_parts_loaded_by_id_fkey" FOREIGN KEY ("loaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT purchase_order_parts_container_loaded_facts_check CHECK (
    (loaded_at IS NULL AND loaded_by_id IS NULL AND loaded_recorded_at IS NULL)
    OR (loaded_at IS NOT NULL AND loaded_by_id IS NOT NULL AND loaded_recorded_at IS NOT NULL
      AND loaded_at <= loaded_recorded_at)
  );

ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_SHIPMENT_CONTAINER_LOADED';

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

-- 存量回填：真实装柜时刻没有独立记录，以最早的装柜明细写入事实作为可考证据。
-- 明细创建人缺失时取该货件最早有创建人的明细；若全部缺失则中断迁移交由人工核对，不伪造操作人。
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM container_loading_items item
    WHERE item.shipment_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM container_loading_items origin
        WHERE origin.shipment_id = item.shipment_id AND origin.created_by_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Container loading items without a creator cannot backfill the shipment loading fact'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_container_loaded_backfill_check';
  END IF;
END $$;

UPDATE purchase_order_parts part
   SET loaded_at = origin.created_at, loaded_by_id = origin.created_by_id, loaded_recorded_at = clock_timestamp()
  FROM (
    SELECT DISTINCT ON (shipment_id) shipment_id, created_at, created_by_id
    FROM container_loading_items
    WHERE shipment_id IS NOT NULL AND created_by_id IS NOT NULL
    ORDER BY shipment_id, created_at, id
  ) origin
 WHERE part.id = origin.shipment_id AND part.loaded_at IS NULL;


-- 关联必须建立在已存在的装柜事实上：覆盖包括未来入口在内的全部写入路径，绕过服务端也会被拒绝。
CREATE OR REPLACE FUNCTION enforce_container_loading_shipment_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shipment_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.shipment_id IS NOT DISTINCT FROM OLD.shipment_id
      AND NEW.container_batch_id = OLD.container_batch_id THEN RETURN NEW; END IF;
  -- REPEATABLE READ 的旧快照在等待锁后仍看不到其他柜次已提交的分配；此命令不得使用该隔离级别。
  IF current_setting('transaction_isolation') = 'repeatable read' THEN
    RAISE EXCEPTION 'Shipment allocation requires read committed or serializable isolation'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_isolation_check';
  END IF;
  PERFORM id FROM purchase_order_parts WHERE id = NEW.shipment_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM purchase_order_parts WHERE id = NEW.shipment_id AND loaded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Shipment must record the container loading fact before allocation'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_shipment_loaded_check';
  END IF;
  IF EXISTS (SELECT 1 FROM container_loading_items WHERE shipment_id = NEW.shipment_id
      AND container_batch_id <> NEW.container_batch_id AND id <> NEW.id) THEN
    RAISE EXCEPTION 'Shipment cannot be split across container batches'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_shipment_same_batch_check';
  END IF;
  RETURN NEW;
END;
$$;

-- 结构自校验：装柜事实列、审计取值或存量回填完整性缺失即整单回滚。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'purchase_order_parts' AND column_name = 'loaded_at') THEN
    RAISE EXCEPTION 'Shipment container loading columns missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_event_type' AND e.enumlabel = 'PURCHASE_SHIPMENT_CONTAINER_LOADED') THEN
    RAISE EXCEPTION 'Shipment container loading audit event missing' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM container_loading_items item JOIN purchase_order_parts part ON part.id = item.shipment_id
    WHERE item.shipment_id IS NOT NULL AND part.loaded_at IS NULL) THEN
    RAISE EXCEPTION 'Shipment container loading backfill is incomplete' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
