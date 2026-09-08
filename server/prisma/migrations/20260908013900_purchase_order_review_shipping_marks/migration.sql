BEGIN;

-- 只改新单的派发时点，历史 v3/v4 的编号、关联与指纹均保持原样。
-- 唛头是独立业务字段，不把 part_number（本单内序号）当成正式货件编号。
ALTER TABLE "purchase_order_parts" ALTER COLUMN "shipping_mark_text" DROP NOT NULL,
ALTER COLUMN "shipping_mark_text" SET DATA TYPE VARCHAR(72),
ALTER COLUMN "shipping_mark_issuance_id" DROP NOT NULL,
ALTER COLUMN "shipping_mark_key_hash" DROP NOT NULL;

ALTER TABLE "purchase_orders" ALTER COLUMN "create_request_fingerprint_version" SET DEFAULT 'purchase-order.create.v5';
ALTER TABLE "purchase_order_parts" DROP CONSTRAINT "purchase_order_parts_mark_check";
ALTER TABLE "purchase_order_parts" ADD CONSTRAINT "purchase_order_parts_mark_check" CHECK (
  (shipping_mark_text IS NULL OR length(btrim(shipping_mark_text)) > 0)
  AND ((shipping_mark_issuance_id IS NULL AND shipping_mark_key_hash IS NULL)
    OR (shipping_mark_issuance_id IS NOT NULL AND shipping_mark_key_hash IS NOT NULL
      AND octet_length(shipping_mark_key_hash) = 32))
);

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
  IF TG_OP = 'INSERT' AND (NEW.create_request_fingerprint_version <> 'purchase-order.create.v5'
    OR NEW.order_status <> 'PENDING_REVIEW' OR NEW.fulfillment_status <> 'ORDERED'
    OR NEW.shipping_mark_text IS NOT NULL OR NEW.shipping_mark_issuance_id IS NOT NULL) THEN
    RAISE EXCEPTION 'New purchase order requires unmarked parts and review'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_parts_required_check';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.shipping_mark_text IS DISTINCT FROM OLD.shipping_mark_text
    OR NEW.shipping_mark_issuance_id IS DISTINCT FROM OLD.shipping_mark_issuance_id
  ) AND NOT (
    OLD.create_request_fingerprint_version = 'purchase-order.create.v5'
    AND OLD.shipping_mark_text IS NULL AND OLD.shipping_mark_issuance_id IS NULL
    AND NEW.shipping_mark_text IS NOT NULL AND NEW.shipping_mark_issuance_id IS NOT NULL
    AND OLD.part_configuration_sealed AND NEW.part_configuration_sealed
    AND OLD.order_status = 'PENDING_REVIEW' AND OLD.fulfillment_status = 'ORDERED'
    AND NEW.order_status = 'CONFIRMED' AND NEW.fulfillment_status = 'PREPARING'
  ) THEN
    RAISE EXCEPTION 'Purchase order shipping identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_shipping_mark_immutable_check';
  END IF;

  IF NEW.create_request_fingerprint_version = 'purchase-order.create.v5' THEN
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
      AND orders.create_request_fingerprint_version = 'purchase-order.create.v5'
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

CREATE OR REPLACE FUNCTION "reject_purchase_order_part_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_mark TEXT; has_multiple_parts BOOLEAN;
BEGIN
  -- 只开放 v5 审核事务中的一次补码，其余字段、分配子项、历史码和删除仍全部锁住。
  IF TG_TABLE_NAME = 'purchase_order_parts' AND TG_OP = 'UPDATE' THEN
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

CREATE OR REPLACE FUNCTION "enforce_purchase_order_part_item_creation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "purchase_order_parts" part JOIN "purchase_orders" orders ON orders.id = part.purchase_order_id
    WHERE part.id = NEW.purchase_order_part_id AND part.purchase_order_id = NEW.purchase_order_id
      AND NOT orders.part_configuration_sealed AND orders.create_request_fingerprint_version = 'purchase-order.create.v5';
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
    AND create_request_fingerprint_version = 'purchase-order.create.v5') THEN RETURN NEW; END IF;
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

CREATE FUNCTION "enforce_purchase_order_review_part_marks"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_mark TEXT; part_count BIGINT;
BEGIN
  IF NEW.create_request_fingerprint_version <> 'purchase-order.create.v5' THEN RETURN NEW; END IF;
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
CREATE CONSTRAINT TRIGGER "purchase_orders_review_part_marks_trigger" AFTER UPDATE ON "purchase_orders"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.shipping_mark_issuance_id IS NULL AND NEW.shipping_mark_issuance_id IS NOT NULL)
  EXECUTE FUNCTION "enforce_purchase_order_review_part_marks"();

COMMIT;
