/*
  Warnings:

  - A unique constraint covering the columns `[shipment_no]` on the table `purchase_order_parts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[numbering_issuance_id]` on the table `purchase_order_parts` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_SHIPMENT_NUMBER_ASSIGNED';

-- AlterTable
ALTER TABLE "purchase_order_parts" ADD COLUMN     "numbering_issuance_id" UUID,
ADD COLUMN     "shipment_no" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_parts_shipment_no_key" ON "purchase_order_parts"("shipment_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_parts_numbering_issuance_id_key" ON "purchase_order_parts"("numbering_issuance_id");

-- AddForeignKey
ALTER TABLE "purchase_order_parts" ADD CONSTRAINT "purchase_order_parts_numbering_issuance_id_fkey" FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 历史货件保留双空；新建必须关联本次实际派发账本。此迁移不创建、启用规则或伪造历史时间。
ALTER TABLE purchase_order_parts ADD CONSTRAINT purchase_order_parts_numbering_pair_check
  CHECK ((shipment_no IS NULL) = (numbering_issuance_id IS NULL));

CREATE FUNCTION purchase_shipment_number_matches(part_id UUID, order_id UUID, part_key UUID, shipment_number TEXT, issuance_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM numbering_issuances issuance
    JOIN numbering_rules rule ON rule.id = issuance.rule_id
    WHERE issuance.id = issuance_id AND issuance.generated_number = shipment_number
      AND rule.rule_code = 'SHIPMENT_NO' AND rule.purpose = 'BUSINESS'
      AND issuance.consumer_code = 'SHIPMENT_NO.CREATE'
      AND issuance.idempotency_key_hash = sha256(convert_to(part_id::text, 'UTF8'))
      AND issuance.request_fingerprint_hash = sha256(convert_to(
        'purchase-shipment.number.v1:' || part_id::text || ':' || order_id::text || ':' || part_key::text, 'UTF8'))
  );
$$;

CREATE FUNCTION enforce_purchase_shipment_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shipment_no IS NULL OR NEW.numbering_issuance_id IS NULL THEN
    RAISE EXCEPTION 'New purchase shipments require a shipment number'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_numbering_required_check';
  END IF;
  IF NOT purchase_shipment_number_matches(NEW.id, NEW.purchase_order_id, NEW.key, NEW.shipment_no, NEW.numbering_issuance_id) THEN
    RAISE EXCEPTION 'Shipment number must match its scoped issuance'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_numbering_identity_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_order_parts_numbering_trigger BEFORE INSERT ON purchase_order_parts
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_shipment_number();

CREATE OR REPLACE FUNCTION "reject_purchase_order_part_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_mark TEXT; has_multiple_parts BOOLEAN; parent_status TEXT;
BEGIN
  -- 保留一次补码及不可变配置保护，只开放与父采购单一致的货件生命周期。
  IF TG_TABLE_NAME = 'purchase_order_parts' AND TG_OP = 'UPDATE' THEN
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
