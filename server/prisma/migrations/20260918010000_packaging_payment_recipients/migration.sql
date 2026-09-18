-- AlterEnum
ALTER TYPE "audit_event_type" ADD VALUE 'PACKAGING_PAYMENT_PROFILE_SAVED';

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "packaging_cost_upload_id" UUID;

-- AlterTable
ALTER TABLE "payment_recipient_profiles" ADD COLUMN     "packaging_request_id" UUID,
ADD COLUMN     "packaging_vendor" VARCHAR(64);

-- AlterTable
ALTER TABLE "packaging_cost_requests" ADD COLUMN     "payment_fingerprint_hash" BYTEA,
ADD COLUMN     "payment_remark" VARCHAR(500),
ADD COLUMN     "payment_voucher_media_asset_id" UUID,
ADD COLUMN     "recipient_qr_media_asset_id" UUID,
ADD COLUMN     "recipient_snapshot" JSONB;

-- CreateIndex
CREATE INDEX "media_assets_packaging_cost_upload_idx" ON "media_assets"("packaging_cost_upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_recipient_profiles_packaging_vendor_key" ON "payment_recipient_profiles"("packaging_vendor");

-- CreateIndex
CREATE UNIQUE INDEX "payment_recipient_profiles_packaging_request_key" ON "payment_recipient_profiles"("packaging_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_cost_requests_payment_voucher_key" ON "packaging_cost_requests"("payment_voucher_media_asset_id");

-- CreateIndex
CREATE INDEX "packaging_cost_requests_recipient_qr_idx" ON "packaging_cost_requests"("recipient_qr_media_asset_id");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_packaging_cost_upload_id_fkey" FOREIGN KEY ("packaging_cost_upload_id") REFERENCES "packaging_cost_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_recipient_profiles" ADD CONSTRAINT "payment_recipient_profiles_packaging_request_id_fkey" FOREIGN KEY ("packaging_request_id") REFERENCES "packaging_cost_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "packaging_cost_requests" ADD CONSTRAINT "packaging_cost_requests_payment_voucher_media_asset_id_fkey" FOREIGN KEY ("payment_voucher_media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "packaging_cost_requests" ADD CONSTRAINT "packaging_cost_requests_recipient_qr_media_asset_id_fkey" FOREIGN KEY ("recipient_qr_media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- 四种显式归属互斥，包装厂商仅有首版已定义的诚信木箱。
ALTER TABLE payment_recipient_profiles DROP CONSTRAINT payment_recipient_profiles_owner_check;
ALTER TABLE payment_recipient_profiles ADD CONSTRAINT payment_recipient_profiles_owner_check
  CHECK (num_nonnulls(supplier_value,purchase_order_id,packaging_vendor,packaging_request_id) = 1),
  ADD CONSTRAINT payment_recipient_profiles_packaging_vendor_check CHECK (packaging_vendor IS NULL OR packaging_vendor = 'CHENGXIN');
ALTER TABLE media_assets DROP CONSTRAINT media_assets_upload_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_upload_purpose_check
  CHECK (upload_purpose IS NULL OR upload_purpose IN ('PAYMENT_RECIPIENT_QR','PURCHASE_PAYMENT_VOUCHER','PACKAGING_PAYMENT_VOUCHER')),
  ADD CONSTRAINT media_assets_packaging_cost_upload_check CHECK ((packaging_cost_upload_id IS NOT NULL) = (upload_purpose IS NOT DISTINCT FROM 'PACKAGING_PAYMENT_VOUCHER'));
ALTER TABLE packaging_cost_requests ADD CONSTRAINT packaging_cost_payment_shape_check CHECK (
  (recipient_snapshot IS NULL AND recipient_qr_media_asset_id IS NULL AND payment_voucher_media_asset_id IS NULL AND payment_remark IS NULL AND payment_fingerprint_hash IS NULL)
  OR (status = 'PAID' AND recipient_snapshot IS NOT NULL AND recipient_qr_media_asset_id IS NOT NULL AND payment_voucher_media_asset_id IS NOT NULL
    AND payment_fingerprint_hash IS NOT NULL AND octet_length(payment_fingerprint_hash) = 32
    AND jsonb_typeof(recipient_snapshot) = 'object' AND recipient_snapshot->>'paymentMethod' IN ('ALIPAY','WECHAT')
    AND recipient_snapshot->>'qrMediaAssetId' = recipient_qr_media_asset_id::text AND length(recipient_snapshot->>'recipientName') > 0)
);

CREATE OR REPLACE FUNCTION enforce_payment_recipient_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Recipient identity cannot be deleted' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_identity_check'; END IF;
  IF TG_TABLE_NAME = 'payment_recipient_profiles' THEN
    IF TG_OP = 'UPDATE' AND (ROW(NEW.id,NEW.supplier_value,NEW.purchase_order_id,NEW.packaging_vendor,NEW.packaging_request_id,NEW.created_by_user_id,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.supplier_value,OLD.purchase_order_id,OLD.packaging_vendor,OLD.packaging_request_id,OLD.created_by_user_id,OLD.created_at) OR NEW.version <> OLD.version + 1) THEN
      RAISE EXCEPTION 'Recipient profile identity is immutable' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_identity_check';
    END IF;
    IF NEW.packaging_request_id IS NOT NULL AND (TG_OP = 'UPDATE' OR NOT EXISTS (SELECT 1 FROM packaging_cost_requests WHERE id = NEW.packaging_request_id AND packaging_vendor = 'OTHER' AND status = 'PENDING_PAYMENT')) THEN
      RAISE EXCEPTION 'Request recipient requires an immutable OTHER packaging submission' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_packaging_request_check';
    END IF;
    IF NEW.purchase_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = NEW.purchase_order_id AND product_mode = 'CUSTOM') THEN
      RAISE EXCEPTION 'Order recipient requires a custom purchase' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_order_check';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND ROW(NEW.id,NEW.profile_id,NEW.payment_method,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.profile_id,OLD.payment_method,OLD.created_at) THEN
    RAISE EXCEPTION 'Recipient account identity is immutable' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_identity_check';
  END IF;
  IF TG_TABLE_NAME = 'payment_recipient_accounts' THEN
    IF EXISTS (SELECT 1 FROM payment_recipient_profiles WHERE id = NEW.profile_id AND packaging_request_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Submitted recipient account cannot be changed' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_packaging_immutable_check';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION enforce_media_asset_upload_purpose() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.upload_purpose IS DISTINCT FROM OLD.upload_purpose AND (OLD.upload_purpose IS NOT NULL OR OLD.status <> 'UPLOADING') THEN
    RAISE EXCEPTION 'Media upload purpose is immutable after assignment' USING ERRCODE = '23514', CONSTRAINT = 'media_assets_upload_purpose_immutable_check';
  END IF;
  IF NEW.purchase_payable_upload_id IS DISTINCT FROM OLD.purchase_payable_upload_id
    AND (OLD.purchase_payable_upload_id IS NOT NULL OR OLD.status <> 'UPLOADING') THEN
    RAISE EXCEPTION 'Voucher upload installment is immutable after assignment' USING ERRCODE = '23514', CONSTRAINT = 'media_assets_purchase_payable_upload_immutable_check';
  END IF;
  IF NEW.packaging_cost_upload_id IS DISTINCT FROM OLD.packaging_cost_upload_id AND (OLD.packaging_cost_upload_id IS NOT NULL OR OLD.status <> 'UPLOADING') THEN
    RAISE EXCEPTION 'Packaging voucher target is immutable after assignment' USING ERRCODE = '23514', CONSTRAINT = 'media_assets_packaging_upload_immutable_check';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION enforce_packaging_cost_identity() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR (to_jsonb(NEW) - ARRAY['status','paid_by_user_id','paid_at','version','updated_at','recipient_snapshot','recipient_qr_media_asset_id','payment_voucher_media_asset_id','payment_remark','payment_fingerprint_hash']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','paid_by_user_id','paid_at','version','updated_at','recipient_snapshot','recipient_qr_media_asset_id','payment_voucher_media_asset_id','payment_remark','payment_fingerprint_hash']) THEN
    RAISE EXCEPTION 'Packaging cost evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_immutable_check';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.recipient_snapshot IS NULL OR NEW.recipient_qr_media_asset_id IS NULL OR NEW.payment_voucher_media_asset_id IS NULL OR NEW.payment_fingerprint_hash IS NULL) THEN
    RAISE EXCEPTION 'Packaging payment requires recipient and voucher evidence' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_payment_required_check';
  END IF;
  RETURN NEW;
END $$;

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
  ELSIF TG_TABLE_NAME = 'payment_recipient_accounts' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD.qr_media_asset_id; ELSE reference_asset_id := NEW.qr_media_asset_id; END IF;
  ELSIF TG_TABLE_NAME = 'purchase_order_payments' THEN
    reference_asset_id := NEW.recipient_qr_media_asset_id;
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
    AND NOT EXISTS (SELECT 1 FROM packaging_cost_requests reference WHERE reference.packaging_image_media_asset_id = reference_asset_id OR reference.quotation_image_media_asset_id = reference_asset_id OR reference.payment_voucher_media_asset_id = reference_asset_id OR reference.recipient_qr_media_asset_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM payment_recipient_accounts reference WHERE reference.qr_media_asset_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM purchase_order_payments reference WHERE reference.recipient_qr_media_asset_id = reference_asset_id)
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
  IF current_status <> 'READY' AND EXISTS (SELECT 1 FROM packaging_cost_requests WHERE packaging_image_media_asset_id = reference_asset_id OR quotation_image_media_asset_id = reference_asset_id OR payment_voucher_media_asset_id = reference_asset_id OR recipient_qr_media_asset_id = reference_asset_id) THEN
    RAISE EXCEPTION 'Packaging evidence must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_image_ready_check';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_recipient_accounts WHERE qr_media_asset_id = reference_asset_id)
    OR EXISTS (SELECT 1 FROM purchase_order_payments WHERE recipient_qr_media_asset_id = reference_asset_id)
    OR EXISTS (SELECT 1 FROM packaging_cost_requests WHERE recipient_qr_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'PAYMENT_RECIPIENT_QR'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp') AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recipient code must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_image_ready_check';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 新提交的自定义厂商资料在同一事务中创建；不追溯拒绝升级前无资料的历史提报。
CREATE FUNCTION enforce_packaging_submission_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payment_recipient_profiles p JOIN payment_recipient_accounts a ON a.profile_id = p.id
    WHERE ((NEW.packaging_vendor = 'CHENGXIN' AND p.packaging_vendor = 'CHENGXIN') OR (NEW.packaging_vendor = 'OTHER' AND p.packaging_request_id = NEW.id))
      AND a.enabled AND a.payment_method IN ('ALIPAY','WECHAT')) THEN
    RAISE EXCEPTION 'Packaging submission requires a QR recipient' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_recipient_required_check';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER packaging_cost_recipient_required_trigger AFTER INSERT ON packaging_cost_requests
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_packaging_submission_recipient();

CREATE FUNCTION enforce_packaging_recipient_account_method() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 自定义收款账户仅在创建 profile 的原事务中写入，之后不能补加另一种方式改变已提报资料。
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM payment_recipient_profiles p WHERE p.id = NEW.profile_id
    AND p.packaging_request_id IS NOT NULL AND p.xmin::text <> mod(pg_current_xact_id()::text::numeric, 4294967296)::text) THEN
    RAISE EXCEPTION 'Submitted recipient account cannot be extended' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_packaging_immutable_check';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_recipient_profiles WHERE id = NEW.profile_id AND (packaging_vendor IS NOT NULL OR packaging_request_id IS NOT NULL))
    AND NEW.payment_method NOT IN ('ALIPAY','WECHAT') THEN
    RAISE EXCEPTION 'Packaging recipient only accepts QR methods' USING ERRCODE = '23514', CONSTRAINT = 'packaging_recipient_method_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER packaging_recipient_account_method_trigger BEFORE INSERT OR UPDATE ON payment_recipient_accounts
FOR EACH ROW EXECUTE FUNCTION enforce_packaging_recipient_account_method();

CREATE FUNCTION enforce_packaging_payment_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recipient_snapshot IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM payment_recipient_accounts a JOIN payment_recipient_profiles p ON p.id = a.profile_id
    WHERE a.id::text = NEW.recipient_snapshot->>'id' AND a.enabled
      AND ((NEW.packaging_vendor = 'CHENGXIN' AND p.packaging_vendor = 'CHENGXIN') OR (NEW.packaging_vendor = 'OTHER' AND p.packaging_request_id = NEW.id))
      AND a.payment_method = NEW.recipient_snapshot->>'paymentMethod' AND a.recipient_name = NEW.recipient_snapshot->>'recipientName'
      AND a.qr_media_asset_id = NEW.recipient_qr_media_asset_id AND a.qr_media_asset_id::text = NEW.recipient_snapshot->>'qrMediaAssetId') THEN
    RAISE EXCEPTION 'Packaging payment recipient does not match its source' USING ERRCODE = '23514', CONSTRAINT = 'packaging_payment_recipient_snapshot_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM media_assets WHERE id = NEW.payment_voucher_media_asset_id AND status = 'READY' AND deleted_at IS NULL
    AND upload_purpose = 'PACKAGING_PAYMENT_VOUCHER' AND packaging_cost_upload_id = NEW.id AND created_by_user_id = NEW.paid_by_user_id
    AND media_type = 'IMAGE' AND mime_type IN ('image/jpeg','image/png','image/webp') AND size_bytes > 0 AND size_bytes <= 10485760) THEN
    RAISE EXCEPTION 'Packaging payment requires an owned targeted voucher' USING ERRCODE = '23514', CONSTRAINT = 'packaging_payment_voucher_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER packaging_payment_evidence_trigger BEFORE UPDATE ON packaging_cost_requests FOR EACH ROW EXECUTE FUNCTION enforce_packaging_payment_evidence();
