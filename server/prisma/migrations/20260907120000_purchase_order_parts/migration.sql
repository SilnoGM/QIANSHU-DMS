BEGIN;

-- 既有请求仍按 v3 恢复，不回填货件、不改写历史唛头或派发记录。
ALTER TABLE "purchase_orders" ADD COLUMN "create_request_fingerprint_version" VARCHAR(32) NOT NULL DEFAULT 'purchase-order.create.v3';
ALTER TABLE "purchase_orders" ALTER COLUMN "create_request_fingerprint_version" SET DEFAULT 'purchase-order.create.v4';
ALTER TABLE "purchase_orders" ADD COLUMN "part_configuration_sealed" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "purchase_order_parts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_order_id" UUID NOT NULL,
  "key" UUID NOT NULL,
  "part_number" SMALLINT NOT NULL,
  "shipping_mark_text" VARCHAR(64) NOT NULL,
  "shipping_mark_issuance_id" UUID NOT NULL,
  "shipping_mark_key_hash" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_order_parts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_parts_number_check" CHECK ("part_number" BETWEEN 1 AND 1000),
  CONSTRAINT "purchase_order_parts_key_check" CHECK ("key"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT "purchase_order_parts_mark_check" CHECK (length(btrim("shipping_mark_text")) > 0 AND octet_length("shipping_mark_key_hash") = 32)
);
CREATE TABLE "purchase_order_part_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_order_id" UUID NOT NULL,
  "purchase_order_part_id" UUID NOT NULL,
  "purchase_order_line_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "purchase_order_part_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_part_items_quantity_check" CHECK ("quantity" > 0)
);
CREATE UNIQUE INDEX "purchase_order_parts_issuance_id_key" ON "purchase_order_parts"("shipping_mark_issuance_id");
CREATE UNIQUE INDEX "purchase_order_parts_id_order_id_key" ON "purchase_order_parts"("id", "purchase_order_id");
CREATE UNIQUE INDEX "purchase_order_parts_order_id_key_key" ON "purchase_order_parts"("purchase_order_id", "key");
CREATE UNIQUE INDEX "purchase_order_parts_order_id_number_key" ON "purchase_order_parts"("purchase_order_id", "part_number");
CREATE INDEX "purchase_order_parts_shipping_mark_text_idx" ON "purchase_order_parts"("shipping_mark_text");
CREATE UNIQUE INDEX "purchase_order_lines_id_order_id_key" ON "purchase_order_lines"("id", "purchase_order_id");
CREATE UNIQUE INDEX "purchase_order_part_items_part_line_key" ON "purchase_order_part_items"("purchase_order_part_id", "purchase_order_line_id");
CREATE INDEX "purchase_order_part_items_line_order_idx" ON "purchase_order_part_items"("purchase_order_line_id", "purchase_order_id");
CREATE INDEX "purchase_order_part_items_order_idx" ON "purchase_order_part_items"("purchase_order_id");
ALTER TABLE "purchase_order_parts" ADD CONSTRAINT "purchase_order_parts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_parts" ADD CONSTRAINT "purchase_order_parts_shipping_mark_issuance_id_fkey" FOREIGN KEY ("shipping_mark_issuance_id") REFERENCES "numbering_issuances"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_part_items" ADD CONSTRAINT "purchase_order_part_items_purchase_order_part_id_purchase__fkey" FOREIGN KEY ("purchase_order_part_id", "purchase_order_id") REFERENCES "purchase_order_parts"("id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_part_items" ADD CONSTRAINT "purchase_order_part_items_purchase_order_line_id_purchase__fkey" FOREIGN KEY ("purchase_order_line_id", "purchase_order_id") REFERENCES "purchase_order_lines"("id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 替换旧 INSERT 必须订单级派发的约束。历史 UPDATE 继续检查旧身份，新单只能走 v4。
CREATE OR REPLACE FUNCTION "enforce_purchase_order_shipping_mark_issuance"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 封存只能由覆盖守卫嵌套触发，不能通过直接写字段或可伪造会话设置跳过校验。
  IF (TG_OP = 'INSERT' AND NEW.part_configuration_sealed)
    OR (TG_OP = 'UPDATE' AND NEW.part_configuration_sealed IS DISTINCT FROM OLD.part_configuration_sealed
      AND (OLD.part_configuration_sealed OR NOT NEW.part_configuration_sealed OR pg_trigger_depth() <> 2)) THEN
    RAISE EXCEPTION 'Purchase part seal is trigger-owned and irreversible'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_seal_check';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.shipping_mark_text IS DISTINCT FROM OLD.shipping_mark_text
    OR NEW.shipping_mark_issuance_id IS DISTINCT FROM OLD.shipping_mark_issuance_id
    OR NEW.create_request_fingerprint_version IS DISTINCT FROM OLD.create_request_fingerprint_version
    OR NEW.create_idempotency_key_hash IS DISTINCT FROM OLD.create_idempotency_key_hash
    OR NEW.create_request_fingerprint_hash IS DISTINCT FROM OLD.create_request_fingerprint_hash
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
  ) THEN
    RAISE EXCEPTION 'Purchase order shipping identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_shipping_mark_immutable_check';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.create_request_fingerprint_version <> 'purchase-order.create.v4' THEN
    RAISE EXCEPTION 'New purchase order requires part configuration'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_parts_required_check';
  END IF;
  IF NEW.create_request_fingerprint_version = 'purchase-order.create.v4' THEN
    IF NEW.shipping_mark_text IS NOT NULL OR NEW.shipping_mark_issuance_id IS NOT NULL THEN
      RAISE EXCEPTION 'Part order cannot store a legacy order mark'
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

CREATE FUNCTION "enforce_purchase_order_part_issuance"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 覆盖守卫通过后立即封存，即使调用方提前 SET CONSTRAINTS 也不能继续追加。
  IF EXISTS (SELECT 1 FROM "purchase_orders" WHERE id = NEW.purchase_order_id AND part_configuration_sealed) THEN
    RAISE EXCEPTION 'Committed purchase part configuration cannot be extended'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_immutable_check';
  END IF;
  -- 由订单键摘要和货件 UUID 重建派发键摘要，数据库独立验证同单、同配置与用途。
  PERFORM 1 FROM "purchase_orders" orders
    JOIN "numbering_issuances" issuance ON issuance.id = NEW.shipping_mark_issuance_id
    JOIN "numbering_rules" rule ON rule.id = issuance.rule_id
    WHERE orders.id = NEW.purchase_order_id
      AND orders.create_request_fingerprint_version = 'purchase-order.create.v4'
      AND rule.purpose = 'SHIPPING_MARK'
      AND issuance.consumer_code = 'PURCHASE_ORDER.PART_SHIPPING_MARK'
      AND issuance.generated_number = NEW.shipping_mark_text
      AND issuance.request_fingerprint_hash = orders.create_request_fingerprint_hash
      AND issuance.idempotency_key_hash = NEW.shipping_mark_key_hash
      AND NEW.shipping_mark_key_hash = sha256(convert_to(encode(orders.create_idempotency_key_hash, 'hex') || ':' || NEW.key::text, 'UTF8'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase part shipping issuance does not match'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_issuance_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "purchase_order_parts_issuance_trigger"
  BEFORE INSERT ON "purchase_order_parts" FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_part_issuance"();

CREATE FUNCTION "reject_purchase_order_part_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Purchase part configuration is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_immutable_check';
END;
$$;
CREATE TRIGGER "purchase_order_parts_immutable_trigger" BEFORE UPDATE OR DELETE ON "purchase_order_parts"
  FOR EACH ROW EXECUTE FUNCTION "reject_purchase_order_part_mutation"();
CREATE TRIGGER "purchase_order_part_items_immutable_trigger" BEFORE UPDATE OR DELETE ON "purchase_order_part_items"
  FOR EACH ROW EXECUTE FUNCTION "reject_purchase_order_part_mutation"();

CREATE FUNCTION "enforce_purchase_order_part_item_creation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 只可为尚未通过最终覆盖守卫的新单写子项；与复合外键一起阻止历史追加和跨单引用。
  PERFORM 1 FROM "purchase_order_parts" part JOIN "purchase_orders" orders ON orders.id = part.purchase_order_id
    WHERE part.id = NEW.purchase_order_part_id AND part.purchase_order_id = NEW.purchase_order_id
      AND NOT orders.part_configuration_sealed AND orders.create_request_fingerprint_version = 'purchase-order.create.v4';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Committed purchase part items cannot be extended'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_immutable_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "purchase_order_part_items_creation_trigger" BEFORE INSERT ON "purchase_order_part_items"
  FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_part_item_creation"();

CREATE FUNCTION "enforce_purchase_order_part_line_immutable"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_id UUID;
BEGIN
  order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.purchase_order_id ELSE NEW.purchase_order_id END;
  -- 先批量保存全部采购行再保存货件。已有货件后禁止增行，防止追加配置绕过不可变守卫。
  IF EXISTS (SELECT 1 FROM "purchase_order_parts" WHERE purchase_order_id = order_id) THEN
    IF TG_OP <> 'UPDATE' OR ROW(NEW.id, NEW.purchase_order_id, NEW.line_number, NEW.quantity, NEW.line_type, NEW.product_id, NEW.source_sales_order_line_id)
      IS DISTINCT FROM ROW(OLD.id, OLD.purchase_order_id, OLD.line_number, OLD.quantity, OLD.line_type, OLD.product_id, OLD.source_sales_order_line_id) THEN
      RAISE EXCEPTION 'Allocated purchase line identity is immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_line_immutable_check';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER "purchase_order_parts_line_immutable_trigger" BEFORE INSERT OR UPDATE OR DELETE ON "purchase_order_lines"
  FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_part_line_immutable"();

CREATE FUNCTION "enforce_purchase_order_part_coverage"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_id UUID; part_count BIGINT; last_part INTEGER;
BEGIN
  order_id := NEW.id;
  IF NOT EXISTS (SELECT 1 FROM "purchase_orders" WHERE id = order_id AND create_request_fingerprint_version = 'purchase-order.create.v4') THEN RETURN NEW; END IF;
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
  -- 不改业务版本、更新时间、审核/履约状态。封存早于任何后续写入，不依赖事务 ID。
  UPDATE "purchase_orders" SET part_configuration_sealed = true WHERE id = order_id AND NOT part_configuration_sealed;
  RETURN NEW;
END;
$$;
-- 每个订单只扫描并封存一次，避免每一件/项都全单重扫导致平方级工作量。
CREATE CONSTRAINT TRIGGER "purchase_orders_part_coverage_trigger" AFTER INSERT ON "purchase_orders"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_part_coverage"();

COMMIT;
