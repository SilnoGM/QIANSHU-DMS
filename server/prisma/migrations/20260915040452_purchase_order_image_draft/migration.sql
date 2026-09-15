BEGIN;

-- 当前草稿唯一；历史草稿只保存失效/归档事实，不覆盖已经预览过的文件身份。

-- 唛头只提前到生成图片步骤，仍为正式永久派发，不推进订单或货件审核态。
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_REVIEW_MARKS_PREPARED';
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_IMAGE_GENERATED';

-- CreateTable
CREATE TABLE "purchase_order_image_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "order_version" INTEGER NOT NULL,
    "snapshot_hash" VARCHAR(64) NOT NULL,
    "template_version" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "generated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidated_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "purchase_order_image_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_image_drafts_media_asset_key" ON "purchase_order_image_drafts"("media_asset_id");
CREATE UNIQUE INDEX purchase_order_image_drafts_current_key ON purchase_order_image_drafts(purchase_order_id)
  WHERE invalidated_at IS NULL AND archived_at IS NULL;
ALTER TABLE purchase_order_image_drafts ADD CONSTRAINT purchase_order_image_drafts_shape_check CHECK (
  order_version > 0 AND snapshot_hash ~ '^[a-f0-9]{64}$' AND length(btrim(template_version)) > 0
  AND jsonb_typeof(snapshot) = 'object' AND NOT (invalidated_at IS NOT NULL AND archived_at IS NOT NULL)
  AND (invalidated_at IS NULL OR invalidated_at >= created_at)
  AND (archived_at IS NULL OR archived_at >= created_at)
);

-- CreateIndex
CREATE INDEX "purchase_order_image_drafts_order_created_idx" ON "purchase_order_image_drafts"("purchase_order_id", "created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "purchase_order_image_drafts" ADD CONSTRAINT "purchase_order_image_drafts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_order_image_drafts" ADD CONSTRAINT "purchase_order_image_drafts_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_order_image_drafts" ADD CONSTRAINT "purchase_order_image_drafts_generated_by_user_id_fkey" FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

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
    AND NEW.order_status = 'PENDING_REVIEW' AND NEW.fulfillment_status = 'ORDERED'
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

CREATE OR REPLACE FUNCTION "enforce_ready_media_asset_reference"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reference_asset_id UUID;
  current_status "media_asset_status";
BEGIN
  IF TG_TABLE_NAME = 'media_assets' THEN
    reference_asset_id := NEW."id";
  ELSIF TG_TABLE_NAME = 'sales_receipt_requests' THEN
    reference_asset_id := NEW."voucher_media_asset_id";
  ELSIF TG_OP = 'DELETE' THEN
    reference_asset_id := OLD."media_asset_id";
  ELSE
    reference_asset_id := NEW."media_asset_id";
  END IF;

  SELECT asset."status"
  INTO current_status
  FROM "media_assets" AS asset
  WHERE asset."id" = reference_asset_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF current_status = 'READY'
    AND NOT EXISTS (
      SELECT 1
      FROM "product_media" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "sales_order_documents" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "purchase_order_documents" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM "sales_receipt_requests" AS reference
      WHERE reference."voucher_media_asset_id" = reference_asset_id
    )
    AND NOT EXISTS (SELECT 1 FROM purchase_order_image_drafts reference WHERE reference.media_asset_id = reference_asset_id AND reference.invalidated_at IS NULL AND reference.archived_at IS NULL)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'READY media asset requires an active domain reference',
      CONSTRAINT = 'media_assets_ready_reference_check';
  END IF;

  IF current_status <> 'READY' AND EXISTS (
    SELECT 1 FROM sales_receipt_requests WHERE voucher_media_asset_id = reference_asset_id
  ) THEN
    RAISE EXCEPTION 'Receipt evidence must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_voucher_ready_check';
  END IF;
  IF current_status <> 'READY' AND EXISTS (SELECT 1 FROM purchase_order_image_drafts WHERE media_asset_id = reference_asset_id AND invalidated_at IS NULL AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Current purchase image draft must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_image_drafts_ready_check';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 文件内容与生成快照不可改写；草稿仅能一次失效或归档，避免审核预览被替换。
CREATE FUNCTION enforce_purchase_order_image_draft_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Purchase image draft history is immutable' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_image_drafts_immutable_check';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.invalidated_at IS NOT NULL OR NEW.archived_at IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM purchase_orders WHERE id = NEW.purchase_order_id AND order_status = 'PENDING_REVIEW'
        AND fulfillment_status = 'ORDERED' AND version = NEW.order_version
    ) THEN
      RAISE EXCEPTION 'Image draft requires the current pending order' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_image_drafts_order_check';
    END IF;
  ELSIF OLD.invalidated_at IS NOT NULL OR OLD.archived_at IS NOT NULL
    OR (to_jsonb(NEW) - ARRAY['invalidated_at','archived_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['invalidated_at','archived_at'])
    OR (NEW.invalidated_at IS NULL AND NEW.archived_at IS NULL) THEN
    RAISE EXCEPTION 'Purchase image draft history is immutable' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_image_drafts_immutable_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_order_image_drafts_identity_trigger BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_image_drafts
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_order_image_draft_identity();

-- 与媒体准备/激活共用提交边界，持久草稿不能被临时上传回收，也不能关联非图片资产。
CREATE FUNCTION enforce_purchase_order_image_draft_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE draft RECORD;
BEGIN
  SELECT * INTO draft FROM purchase_order_image_drafts WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF draft.invalidated_at IS NULL AND draft.archived_at IS NULL THEN
    PERFORM 1 FROM media_assets WHERE id = draft.media_asset_id AND status = 'READY'
      AND media_type = 'IMAGE' AND mime_type = 'image/png' AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = draft.purchase_order_id AND order_status = 'PENDING_REVIEW') THEN
      RAISE EXCEPTION 'Current image draft requires a ready PNG and pending order' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_image_drafts_ready_check';
    END IF;
  ELSIF draft.archived_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM purchase_order_documents WHERE purchase_order_id = draft.purchase_order_id
      AND media_asset_id = draft.media_asset_id AND document_type = 'ORDER_ISSUANCE_VOUCHER'
  ) THEN
    RAISE EXCEPTION 'Archived image requires its purchase document' USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_image_drafts_archive_check';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER purchase_order_image_drafts_reference_trigger AFTER INSERT OR UPDATE ON purchase_order_image_drafts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_purchase_order_image_draft_reference();
CREATE CONSTRAINT TRIGGER purchase_order_image_drafts_ready_reference_trigger AFTER INSERT OR UPDATE ON purchase_order_image_drafts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ready_media_asset_reference();

-- 只约束升级后的新审核，不为历史已审核采购单伪造图片。
CREATE FUNCTION enforce_purchase_order_review_image() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.order_status = 'PENDING_REVIEW' AND NEW.order_status = 'CONFIRMED' AND NOT EXISTS (
    SELECT 1 FROM purchase_order_image_drafts draft JOIN purchase_order_documents document
      ON document.purchase_order_id = draft.purchase_order_id AND document.media_asset_id = draft.media_asset_id
    WHERE draft.purchase_order_id = NEW.id AND draft.order_version = OLD.version AND draft.archived_at IS NOT NULL
      AND draft.invalidated_at IS NULL AND document.document_type = 'ORDER_ISSUANCE_VOUCHER' AND document.detached_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Review requires the generated purchase image' USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_review_image_check';
  END IF;
  IF NEW.order_status <> 'PENDING_REVIEW' AND EXISTS (SELECT 1 FROM purchase_order_image_drafts WHERE purchase_order_id = NEW.id AND invalidated_at IS NULL AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Terminal order cannot retain a current draft' USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_image_draft_state_check';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER purchase_orders_review_image_trigger AFTER UPDATE ON purchase_orders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_purchase_order_review_image();
COMMIT;
