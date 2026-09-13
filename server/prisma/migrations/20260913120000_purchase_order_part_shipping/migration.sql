BEGIN;

ALTER TYPE "purchase_order_fulfillment_status" ADD VALUE 'PARTIALLY_SHIPPED';
-- 部分发货期间，每次提交仍须记录操作；其他维度继续禁止无状态变化的记录。
ALTER TABLE "purchase_order_status_history"
  DROP CONSTRAINT "purchase_order_status_history_status_nonblank_check",
  ADD CONSTRAINT "purchase_order_status_history_status_nonblank_check" CHECK (
    from_status !~ '^[[:space:]]*$' AND to_status !~ '^[[:space:]]*$'
    AND (from_status <> to_status
      OR (dimension::text = 'FULFILLMENT' AND from_status = 'PARTIALLY_SHIPPED' AND to_status = 'PARTIALLY_SHIPPED'))
  );
ALTER TABLE "purchase_order_parts"
  ADD COLUMN "shipped_at" TIMESTAMPTZ(6),
  ADD COLUMN "shipped_by_id" UUID,
  ADD COLUMN "shipment_recorded_at" TIMESTAMPTZ(6),
  ADD COLUMN "shipment_remark" VARCHAR(500),
  ADD CONSTRAINT "purchase_order_parts_shipped_by_id_fkey" FOREIGN KEY ("shipped_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "purchase_order_parts_shipment_fields_check" CHECK (
    (shipped_at IS NULL AND shipped_by_id IS NULL AND shipment_recorded_at IS NULL AND shipment_remark IS NULL)
    OR (shipped_at IS NOT NULL AND shipped_by_id IS NOT NULL AND shipment_recorded_at IS NOT NULL AND status = 'ACTIVE')
  );

CREATE OR REPLACE FUNCTION "reject_purchase_order_part_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_mark TEXT; has_multiple_parts BOOLEAN; parent_status TEXT;
BEGIN
  -- 保留一次补码及不可变配置保护，只开放与父采购单一致的货件生命周期。
  IF TG_TABLE_NAME = 'purchase_order_parts' AND TG_OP = 'UPDATE' THEN
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

-- 历史整单发货只能由真实发货状态事件证明，不用创建或迁移时间代替。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM purchase_orders orders
    WHERE orders.fulfillment_status::text IN ('SHIPPED', 'SIGNED')
      AND (NOT EXISTS (SELECT 1 FROM purchase_order_parts part WHERE part.purchase_order_id = orders.id)
        OR EXISTS (SELECT 1 FROM purchase_order_parts part WHERE part.purchase_order_id = orders.id AND part.status <> 'ACTIVE')
        OR NOT EXISTS (SELECT 1 FROM purchase_order_status_history history
          WHERE history.purchase_order_id = orders.id AND history.dimension::text = 'FULFILLMENT'
            AND history.to_status = 'SHIPPED'))
  ) THEN
    RAISE EXCEPTION 'Historical shipped orders require active parts and a trustworthy SHIPPED history event before migration';
  END IF;
END;
$$;

UPDATE purchase_order_parts part
SET shipped_at = history.changed_at,
    shipped_by_id = history.changed_by_user_id,
    shipment_recorded_at = history.changed_at,
    shipment_remark = history.reason
FROM purchase_orders orders,
LATERAL (SELECT changed_at, changed_by_user_id, reason
  FROM purchase_order_status_history
  WHERE purchase_order_id = orders.id AND dimension::text = 'FULFILLMENT' AND to_status = 'SHIPPED'
  ORDER BY changed_at DESC, id DESC LIMIT 1) history
WHERE part.purchase_order_id = orders.id AND orders.fulfillment_status::text IN ('SHIPPED', 'SIGNED');

COMMIT;
