BEGIN;

-- CreateEnum
CREATE TYPE "packaging_cost_status" AS ENUM ('PENDING_PAYMENT', 'PAID');

-- CreateEnum
CREATE TYPE "packaging_cost_vendor" AS ENUM ('CHENGXIN', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_event_type" ADD VALUE 'PACKAGING_COST_SUBMITTED';
ALTER TYPE "audit_event_type" ADD VALUE 'PACKAGING_COST_PAID';

-- CreateTable
CREATE TABLE "packaging_cost_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "shipment_no" VARCHAR(64) NOT NULL,
    "shipping_mark_text" VARCHAR(72) NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "purchase_order_no" VARCHAR(64) NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "sales_order_no" VARCHAR(64) NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "packaging_type" VARCHAR(64) NOT NULL,
    "packaging_type_name" VARCHAR(128) NOT NULL,
    "packaging_vendor" "packaging_cost_vendor" NOT NULL,
    "amount" DECIMAL(30,4) NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'CNY',
    "packaging_image_media_asset_id" UUID NOT NULL,
    "quotation_image_media_asset_id" UUID NOT NULL,
    "remark" VARCHAR(500),
    "status" "packaging_cost_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "submitted_by_user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_by_user_id" UUID,
    "paid_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key_hash" BYTEA NOT NULL,
    "request_fingerprint_hash" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaging_cost_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "packaging_cost_requests_packaging_image_key" ON "packaging_cost_requests"("packaging_image_media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_cost_requests_quotation_image_key" ON "packaging_cost_requests"("quotation_image_media_asset_id");

-- CreateIndex
CREATE INDEX "packaging_cost_requests_status_submitted_idx" ON "packaging_cost_requests"("status", "submitted_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "packaging_cost_requests_shipment_submitted_idx" ON "packaging_cost_requests"("shipment_id", "submitted_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "packaging_cost_requests_submitter_idempotency_key" ON "packaging_cost_requests"("submitted_by_user_id", "idempotency_key_hash");

-- AddForeignKey
ALTER TABLE "packaging_cost_requests" ADD CONSTRAINT "packaging_cost_requests_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "purchase_order_parts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "packaging_cost_requests" ADD CONSTRAINT "packaging_cost_requests_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "packaging_cost_requests" ADD CONSTRAINT "packaging_cost_requests_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "packaging_cost_requests" ADD CONSTRAINT "packaging_cost_requests_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "packaging_cost_requests" ADD CONSTRAINT "packaging_cost_requests_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "packaging_cost_requests" ADD CONSTRAINT "packaging_cost_requests_paid_by_user_id_fkey" FOREIGN KEY ("paid_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "packaging_cost_requests" ADD CONSTRAINT "packaging_cost_requests_packaging_image_media_asset_id_fkey" FOREIGN KEY ("packaging_image_media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "packaging_cost_requests" ADD CONSTRAINT "packaging_cost_requests_quotation_image_media_asset_id_fkey" FOREIGN KEY ("quotation_image_media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 提报与付款仅各发生一次；付款不修改原始金额、归属或两张截图。
ALTER TABLE packaging_cost_requests
  ADD CONSTRAINT packaging_cost_requests_amount_check CHECK (amount > 0 AND amount = trunc(amount, 2) AND currency_code = 'CNY'),
  ADD CONSTRAINT packaging_cost_requests_images_check CHECK (packaging_image_media_asset_id <> quotation_image_media_asset_id),
  ADD CONSTRAINT packaging_cost_requests_hash_check CHECK (octet_length(idempotency_key_hash) = 32 AND octet_length(request_fingerprint_hash) = 32),
  ADD CONSTRAINT packaging_cost_requests_time_check CHECK (paid_at IS NULL OR paid_at >= submitted_at),
  ADD CONSTRAINT packaging_cost_requests_state_check CHECK (
    (status = 'PENDING_PAYMENT' AND paid_by_user_id IS NULL AND paid_at IS NULL AND version = 1)
    OR (status = 'PAID' AND paid_by_user_id IS NOT NULL AND paid_at IS NOT NULL AND version = 2)
  );

CREATE FUNCTION enforce_packaging_cost_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Packaging cost evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_immutable_check';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING_PAYMENT' OR NEW.version <> 1 OR NEW.paid_at IS NOT NULL OR NEW.paid_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Packaging cost must begin pending payment' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_state_check';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM purchase_order_parts part
      JOIN purchase_orders purchase ON purchase.id = part.purchase_order_id
      JOIN sales_orders sale ON sale.id = purchase.sales_order_id
      WHERE part.id = NEW.shipment_id AND part.status = 'ACTIVE'
        AND part.shipped_at IS NOT NULL AND part.warehouse_received_at IS NOT NULL
        AND purchase.order_status IN ('CONFIRMED', 'COMPLETED')
        AND part.shipment_no = NEW.shipment_no AND part.shipping_mark_text = NEW.shipping_mark_text
        AND purchase.id = NEW.purchase_order_id AND purchase.order_no = NEW.purchase_order_no
        AND sale.id = NEW.sales_order_id AND sale.order_no = NEW.sales_order_no AND sale.issuer_user_id = NEW.owner_user_id
    ) THEN
      RAISE EXCEPTION 'Packaging cost requires an arrived shipment and its sales identity' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_source_check';
    END IF;
  ELSIF OLD.status <> 'PENDING_PAYMENT' OR NEW.status <> 'PAID' OR NEW.version <> OLD.version + 1
    OR (to_jsonb(NEW) - ARRAY['status','paid_by_user_id','paid_at','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','paid_by_user_id','paid_at','version','updated_at']) THEN
    RAISE EXCEPTION 'Packaging cost evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_immutable_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER packaging_cost_requests_identity_trigger BEFORE INSERT OR UPDATE OR DELETE ON packaging_cost_requests
FOR EACH ROW EXECUTE FUNCTION enforce_packaging_cost_identity();

-- 两张必需图片均由提报人上传，与业务记录在同一事务中激活，永不被临时文件回收。
CREATE FUNCTION enforce_packaging_cost_images() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row packaging_cost_requests%ROWTYPE; asset_id UUID;
BEGIN
  SELECT * INTO row FROM packaging_cost_requests WHERE id = NEW.id;
  FOREACH asset_id IN ARRAY ARRAY[row.packaging_image_media_asset_id, row.quotation_image_media_asset_id] LOOP
    PERFORM 1 FROM media_assets asset WHERE asset.id = asset_id AND asset.status = 'READY'
      AND asset.created_by_user_id = row.submitted_by_user_id AND asset.deleted_at IS NULL
      AND asset.media_type = 'IMAGE' AND asset.mime_type IN ('image/jpeg','image/png','image/webp')
      AND asset.size_bytes > 0 AND asset.size_bytes <= 10485760 AND asset.object_key IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Packaging cost evidence requires a ready owned image' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_image_ready_check';
    END IF;
    IF EXISTS (SELECT 1 FROM packaging_cost_requests other WHERE other.id <> row.id AND (other.packaging_image_media_asset_id = asset_id OR other.quotation_image_media_asset_id = asset_id)) THEN
      RAISE EXCEPTION 'Packaging cost image cannot belong to another request' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_image_reuse_check';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER packaging_cost_requests_images_trigger AFTER INSERT OR UPDATE ON packaging_cost_requests
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_packaging_cost_images();

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
    AND NOT EXISTS (SELECT 1 FROM packaging_cost_requests reference WHERE reference.packaging_image_media_asset_id = reference_asset_id OR reference.quotation_image_media_asset_id = reference_asset_id)
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
  IF current_status <> 'READY' AND EXISTS (SELECT 1 FROM packaging_cost_requests WHERE packaging_image_media_asset_id = reference_asset_id OR quotation_image_media_asset_id = reference_asset_id) THEN
    RAISE EXCEPTION 'Packaging evidence must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_image_ready_check';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 新能力默认仅授予系统管理员，由现有角色管理明确向运营和财务分配。
INSERT INTO permissions(id, code, name, description, system_only) VALUES
(gen_random_uuid(), 'packaging-costs:create', '提报打木架费用', '上传包装截图并提报已到仓货件包装费用', false),
(gen_random_uuid(), 'packaging-costs:read', '查看打木架付款', '查看包装费用提报与截图凭证', false),
(gen_random_uuid(), 'packaging-costs:pay', '确认打木架付款', '确认提报金额并记录付款人和时间', false);
INSERT INTO role_permissions(role_id, permission_id)
SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE role.code = 'system_admin' AND permission.code IN ('packaging-costs:create','packaging-costs:read','packaging-costs:pay');
COMMIT;
