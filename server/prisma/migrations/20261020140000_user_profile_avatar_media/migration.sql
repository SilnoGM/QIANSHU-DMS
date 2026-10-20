-- 个人头像进入统一媒体管线。
-- avatar_url 仍是公开地址；avatar_media_asset_id 只承担 READY 引用保护与回收。
ALTER TABLE "user_profiles"
  ADD COLUMN "avatar_media_asset_id" UUID;

CREATE UNIQUE INDEX "user_profiles_avatar_media_asset_id_key"
  ON "user_profiles"("avatar_media_asset_id");

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_avatar_media_asset_id_fkey"
  FOREIGN KEY ("avatar_media_asset_id") REFERENCES "media_assets"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 头像用途必须进入专用用途白名单，避免临时上传被其它业务域消费。
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_upload_purpose_check";
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_upload_purpose_check"
  CHECK (upload_purpose IS NULL OR upload_purpose IN (
    'PAYMENT_RECIPIENT_QR',
    'PURCHASE_PAYMENT_VOUCHER',
    'PACKAGING_PAYMENT_VOUCHER',
    'OCEAN_FREIGHT_SOURCE_XLSX',
    'SLH_BILL_SOURCE_XLSX',
    'INVOICE_REQUEST_DOCUMENT',
    'FUND_WITHDRAWAL_PAYMENT_PROOF',
    'USER_AVATAR'
  ));

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
  ELSIF TG_TABLE_NAME = 'container_batches' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD.source_file_id; ELSE reference_asset_id := NEW.source_file_id; END IF;
  ELSIF TG_TABLE_NAME = 'slh_bills' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD.source_file_id; ELSE reference_asset_id := NEW.source_file_id; END IF;
  ELSIF TG_TABLE_NAME = 'payment_recipient_accounts' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD.qr_media_asset_id; ELSE reference_asset_id := NEW.qr_media_asset_id; END IF;
  ELSIF TG_TABLE_NAME = 'purchase_order_payments' THEN
    reference_asset_id := NEW.recipient_qr_media_asset_id;
  ELSIF TG_TABLE_NAME = 'sales_receipt_requests' THEN
    reference_asset_id := NEW."voucher_media_asset_id";
  ELSIF TG_TABLE_NAME = 'invoice_requests' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD."document_media_asset_id"; ELSE reference_asset_id := NEW."document_media_asset_id"; END IF;
  ELSIF TG_TABLE_NAME = 'fund_withdrawal_requests' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD."payment_proof_media_asset_id"; ELSE reference_asset_id := NEW."payment_proof_media_asset_id"; END IF;
  ELSIF TG_TABLE_NAME = 'user_profiles' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD."avatar_media_asset_id"; ELSE reference_asset_id := NEW."avatar_media_asset_id"; END IF;
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
    AND NOT EXISTS (SELECT 1 FROM container_batches reference WHERE reference.source_file_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM slh_bills reference WHERE reference.source_file_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM invoice_requests reference WHERE reference.document_media_asset_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM fund_withdrawal_requests reference WHERE reference.payment_proof_media_asset_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM user_profiles reference WHERE reference.avatar_media_asset_id = reference_asset_id)
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
  IF EXISTS (SELECT 1 FROM container_batches WHERE source_file_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'DOCUMENT' AND upload_purpose = 'OCEAN_FREIGHT_SOURCE_XLSX'
      AND mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 52428800;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ocean freight source must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'ocean_freight_source_ready_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM slh_bills WHERE source_file_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'DOCUMENT' AND upload_purpose = 'SLH_BILL_SOURCE_XLSX'
      AND mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 52428800;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SLH bill source must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'slh_bill_source_ready_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_requests WHERE document_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'INVOICE_REQUEST_DOCUMENT'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice document must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'invoice_requests_document_ready_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM fund_withdrawal_requests WHERE payment_proof_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'FUND_WITHDRAWAL_PAYMENT_PROOF'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fund withdrawal payment proof must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'fund_withdrawal_requests_proof_ready_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM user_profiles WHERE avatar_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'USER_AVATAR'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'User avatar must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'user_profiles_avatar_ready_check';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "user_profiles_avatar_reference_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "user_profiles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_ready_media_asset_reference"();
