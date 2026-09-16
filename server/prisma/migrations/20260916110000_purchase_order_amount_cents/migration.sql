BEGIN;

-- 先锁定再核对全部实际金额，防止校验与精度变更之间写入新的非零厘/毫。
-- 历史参考成本、金额修订、图片快照与 hash 不参与迁移，不回写永久请求身份。
LOCK TABLE "purchase_orders", "purchase_order_lines", "purchase_order_payments" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM purchase_orders WHERE
      line_subtotal_amount <> trunc(line_subtotal_amount, 2)
      OR purchase_total_amount <> trunc(purchase_total_amount, 2)
      OR deposit_due_amount <> trunc(deposit_due_amount, 2)
      OR balance_due_amount <> trunc(balance_due_amount, 2))
    OR EXISTS (SELECT 1 FROM purchase_order_lines WHERE
      actual_purchase_unit_price_amount <> trunc(actual_purchase_unit_price_amount, 2)
      OR line_total_amount <> trunc(line_total_amount, 2))
    OR EXISTS (SELECT 1 FROM purchase_order_payments WHERE amount <> trunc(amount, 2))
  THEN
    RAISE EXCEPTION 'Purchase operational amounts contain nonzero sub-cent values; reconcile them before migration'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_operational_amount_cents_required';
  END IF;
END;
$$;

-- PostgreSQL 禁止改动 UPDATE OF 触发器依赖列的类型。全程持有排他锁，
-- 在同一事务内暂时移除两个精确依赖，改完后原样恢复延迟约束语义。
DROP TRIGGER "purchase_orders_line_subtotal_trigger" ON "purchase_orders";
DROP TRIGGER "purchase_orders_payment_summary_trigger" ON "purchase_orders";

ALTER TABLE "purchase_orders"
  ALTER COLUMN "line_subtotal_amount" TYPE DECIMAL(30,2),
  ALTER COLUMN "purchase_total_amount" TYPE DECIMAL(30,2),
  ALTER COLUMN "deposit_due_amount" TYPE DECIMAL(30,2),
  ALTER COLUMN "balance_due_amount" TYPE DECIMAL(30,2),
  ALTER COLUMN "create_request_fingerprint_version" SET DEFAULT 'purchase-order.create.v6',
  DROP CONSTRAINT "purchase_orders_amount_scales_check",
  ADD CONSTRAINT "purchase_orders_amount_scales_check" CHECK (
    scale(line_subtotal_amount) <= 2 AND scale(purchase_total_amount) <= 2
    AND scale(deposit_due_amount) <= 2 AND scale(balance_due_amount) <= 2
  );
ALTER TABLE "purchase_order_lines"
  ALTER COLUMN "actual_purchase_unit_price_amount" TYPE DECIMAL(30,2),
  ALTER COLUMN "line_total_amount" TYPE DECIMAL(30,2),
  DROP CONSTRAINT "purchase_order_lines_amount_scales_check",
  ADD CONSTRAINT "purchase_order_lines_amount_scales_check" CHECK (
    scale(reference_purchase_unit_price_amount) <= 4
    AND scale(actual_purchase_unit_price_amount) <= 2 AND scale(line_total_amount) <= 2
  );
ALTER TABLE "purchase_order_payments"
  ALTER COLUMN "amount" TYPE DECIMAL(30,2),
  DROP CONSTRAINT "purchase_order_payments_amount_check",
  ADD CONSTRAINT "purchase_order_payments_amount_check" CHECK (amount > 0 AND scale(amount) <= 2);

CREATE CONSTRAINT TRIGGER "purchase_orders_line_subtotal_trigger"
AFTER INSERT OR UPDATE OF "line_subtotal_amount" ON "purchase_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_line_subtotal"();

CREATE CONSTRAINT TRIGGER "purchase_orders_payment_summary_trigger"
AFTER INSERT OR UPDATE OF "purchase_total_amount", "payment_status" ON "purchase_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_payment_summary"();

-- v6 与 v5 共享审核派码生命周期；旧 v3/v4 的永久身份与已有派发仍按原规则校验。
-- 仅把新 INSERT 切换到 v6，不允许历史 UPDATE 改写指纹版本。
CREATE OR REPLACE FUNCTION "enforce_purchase_order_shipping_mark_issuance"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 配置仍在创建事务最终校验后封存；审核补码不开放重新分箱或修改请求身份。
  IF (TG_OP = 'INSERT' AND NEW.part_configuration_sealed)
    OR (TG_OP = 'UPDATE' AND NEW.part_configuration_sealed IS DISTINCT FROM OLD.part_configuration_sealed
      AND (OLD.part_configuration_sealed OR NOT NEW.part_configuration_sealed OR pg_trigger_depth() <> 2)) THEN
    RAISE EXCEPTION 'Purchase part seal is trigger-owned and irreversible'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_seal_check';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.create_request_fingerprint_version IS DISTINCT FROM OLD.create_request_fingerprint_version
    OR NEW.create_idempotency_key_hash IS DISTINCT FROM OLD.create_idempotency_key_hash
    OR NEW.create_request_fingerprint_hash IS DISTINCT FROM OLD.create_request_fingerprint_hash
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
  ) THEN
    RAISE EXCEPTION 'Purchase order shipping identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_shipping_mark_immutable_check';
  END IF;
  IF TG_OP = 'INSERT' AND (NEW.create_request_fingerprint_version <> 'purchase-order.create.v6'
    OR NEW.order_status <> 'PENDING_REVIEW' OR NEW.fulfillment_status <> 'ORDERED'
    OR NEW.shipping_mark_text IS NOT NULL OR NEW.shipping_mark_issuance_id IS NOT NULL) THEN
    RAISE EXCEPTION 'New purchase order requires unmarked parts and review'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_parts_required_check';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.shipping_mark_text IS DISTINCT FROM OLD.shipping_mark_text
    OR NEW.shipping_mark_issuance_id IS DISTINCT FROM OLD.shipping_mark_issuance_id
  ) AND NOT (
    OLD.create_request_fingerprint_version IN ('purchase-order.create.v5', 'purchase-order.create.v6')
    AND OLD.shipping_mark_text IS NULL AND OLD.shipping_mark_issuance_id IS NULL
    AND NEW.shipping_mark_text IS NOT NULL AND NEW.shipping_mark_issuance_id IS NOT NULL
    AND OLD.part_configuration_sealed AND NEW.part_configuration_sealed
    AND OLD.order_status = 'PENDING_REVIEW' AND OLD.fulfillment_status = 'ORDERED'
    AND NEW.order_status = 'PENDING_REVIEW' AND NEW.fulfillment_status = 'ORDERED'
  ) THEN
    RAISE EXCEPTION 'Purchase order shipping identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_shipping_mark_immutable_check';
  END IF;

  IF NEW.create_request_fingerprint_version IN ('purchase-order.create.v5', 'purchase-order.create.v6') THEN
    IF (NEW.shipping_mark_text IS NULL) <> (NEW.shipping_mark_issuance_id IS NULL)
      OR (NEW.shipping_mark_text IS NULL AND NEW.order_status NOT IN ('PENDING_REVIEW', 'CANCELLED')) THEN
      RAISE EXCEPTION 'Reviewed purchase order requires a base shipping mark'
        USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_review_mark_shape_check';
    END IF;
    IF NEW.shipping_mark_issuance_id IS NULL THEN RETURN NEW; END IF;
    -- 派发键由订单身份确定，不依赖审核按钮点击次数或 HTTP 请求 ID。
    PERFORM 1 FROM "numbering_issuances" issuance
      JOIN "numbering_rules" rule ON rule.id = issuance.rule_id
      WHERE issuance.id = NEW.shipping_mark_issuance_id AND rule.purpose = 'SHIPPING_MARK'
        AND issuance.consumer_code = 'PURCHASE_ORDER.REVIEW_SHIPPING_MARK'
        AND issuance.idempotency_key_hash = sha256(convert_to(NEW.id::text, 'UTF8'))
        AND issuance.request_fingerprint_hash = NEW.create_request_fingerprint_hash
        AND issuance.generated_number = NEW.shipping_mark_text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase order review shipping issuance does not match'
        USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_shipping_mark_issuance_check';
    END IF;
    RETURN NEW;
  END IF;

  -- 已派发编号不因升级而失效；不套用当前绑定和规则状态去重写历史事实。
  IF NEW.create_request_fingerprint_version = 'purchase-order.create.v4' THEN
    IF NEW.shipping_mark_text IS NOT NULL OR NEW.shipping_mark_issuance_id IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy part order cannot store a base order mark'
        USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_part_mark_shape_check';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.shipping_mark_issuance_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM "numbering_issuances" issuance
    JOIN "numbering_rules" rule ON rule.id = issuance.rule_id
    WHERE issuance.id = NEW.shipping_mark_issuance_id AND rule.purpose = 'SHIPPING_MARK'
      AND issuance.consumer_code = 'PURCHASE_ORDER.SHIPPING_MARK'
      AND issuance.idempotency_key_hash = NEW.create_idempotency_key_hash
      AND issuance.request_fingerprint_hash = NEW.create_request_fingerprint_hash
      AND issuance.generated_number = NEW.shipping_mark_text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order shipping mark issuance does not match'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_shipping_mark_issuance_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_purchase_order_part_issuance"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 新配置只能随新采购单写入，提交前不允许预置唛头或借用他单派发记录。
  PERFORM 1 FROM "purchase_orders" orders
    WHERE orders.id = NEW.purchase_order_id AND NOT orders.part_configuration_sealed
      AND orders.create_request_fingerprint_version IN ('purchase-order.create.v5', 'purchase-order.create.v6')
      AND orders.order_status = 'PENDING_REVIEW'
      AND NEW.shipping_mark_text IS NULL AND NEW.shipping_mark_issuance_id IS NULL
      AND NEW.shipping_mark_key_hash IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase part configuration must be new and unmarked'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_issuance_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_purchase_order_part_item_creation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "purchase_order_parts" part JOIN "purchase_orders" orders ON orders.id = part.purchase_order_id
    WHERE part.id = NEW.purchase_order_part_id AND part.purchase_order_id = NEW.purchase_order_id
      AND NOT orders.part_configuration_sealed AND orders.create_request_fingerprint_version IN ('purchase-order.create.v5', 'purchase-order.create.v6');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Committed purchase part items cannot be extended'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_immutable_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_purchase_order_part_coverage"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_id UUID; part_count BIGINT; last_part INTEGER;
BEGIN
  order_id := NEW.id;
  IF NOT EXISTS (SELECT 1 FROM "purchase_orders" WHERE id = order_id
    AND create_request_fingerprint_version IN ('purchase-order.create.v5', 'purchase-order.create.v6')) THEN RETURN NEW; END IF;
  SELECT count(*), max(part_number) INTO part_count, last_part FROM "purchase_order_parts" WHERE purchase_order_id = order_id;
  IF part_count < 1 OR part_count > 1000 OR last_part <> part_count
    OR (SELECT count(*) FROM "purchase_order_part_items" WHERE purchase_order_id = order_id) > 10000
    OR EXISTS (SELECT 1 FROM "purchase_order_parts" part WHERE part.purchase_order_id = order_id
      AND NOT EXISTS (SELECT 1 FROM "purchase_order_part_items" item WHERE item.purchase_order_part_id = part.id))
    OR EXISTS (
      SELECT 1 FROM "purchase_order_lines" line
      LEFT JOIN "purchase_order_part_items" item ON item.purchase_order_line_id = line.id
      WHERE line.purchase_order_id = order_id GROUP BY line.id, line.quantity
      HAVING COALESCE(sum(item.quantity::bigint), 0) <> line.quantity
    ) THEN
    RAISE EXCEPTION 'Purchase part quantities must exactly cover purchase lines'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_coverage_check';
  END IF;
  UPDATE "purchase_orders" SET part_configuration_sealed = true WHERE id = order_id AND NOT part_configuration_sealed;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_purchase_order_review_part_marks"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_mark TEXT; part_count BIGINT;
BEGIN
  IF NEW.create_request_fingerprint_version NOT IN ('purchase-order.create.v5', 'purchase-order.create.v6') THEN RETURN NEW; END IF;
  SELECT shipping_mark_text INTO base_mark FROM "purchase_orders" WHERE id = NEW.id;
  SELECT count(*) INTO part_count FROM "purchase_order_parts" WHERE purchase_order_id = NEW.id;
  -- 审核一次核对全单，防止只写基础号或遗漏任意货件后提交；不按每个货件重扫全单。
  IF base_mark IS NULL OR part_count < 1 OR part_count > 1000 OR EXISTS (
    SELECT 1 FROM "purchase_order_parts" part WHERE part.purchase_order_id = NEW.id
      AND (part.shipping_mark_issuance_id IS NOT NULL OR part.shipping_mark_key_hash IS NOT NULL
        OR part.shipping_mark_text IS DISTINCT FROM CASE WHEN part_count = 1 THEN base_mark
          ELSE base_mark || '/货件-' || lpad(part.part_number::text, greatest(2, length(part.part_number::text)), '0') END)
  ) THEN
    RAISE EXCEPTION 'All purchase part marks must derive from the reviewed order mark'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_review_marks_check';
  END IF;
  RETURN NEW;
END;
$$;

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
          AND orders.create_request_fingerprint_version IN ('purchase-order.create.v5', 'purchase-order.create.v6')
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
