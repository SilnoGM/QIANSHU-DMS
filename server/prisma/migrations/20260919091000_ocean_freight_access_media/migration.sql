-- 结构与约束必须完整提交；失败时不留下半应用状态。
BEGIN;

-- 新领域默认只授予内置系统管理员，不扩展已有业务角色，也不附带资金权限。
INSERT INTO permissions(id,code,name,description,system_only) VALUES
  (gen_random_uuid(),'container-batches:read','查看柜次','查看柜次和装柜明细',false),
  (gen_random_uuid(),'container-batches:create','新建柜次','新建柜次和装柜明细',false),
  (gen_random_uuid(),'container-batches:update','维护柜次','维护柜次和装柜明细',false),
  (gen_random_uuid(),'ocean-freight-bills:read','查看海运账单','查看海运账单及费用明细',false),
  (gen_random_uuid(),'ocean-freight-bills:create','新建海运账单','新建海运账单和账单明细',false),
  (gen_random_uuid(),'ocean-freight-bills:update','维护海运账单','维护海运账单和费用明细',false),
  (gen_random_uuid(),'ocean-freight-bills:reconcile','核对海运账单','核对或重新打开海运账单明细',false);
INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id,permission.id FROM roles role CROSS JOIN permissions permission
WHERE role.code = 'system_admin' AND permission.code IN (
  'container-batches:read','container-batches:create','container-batches:update',
  'ocean-freight-bills:read','ocean-freight-bills:create','ocean-freight-bills:update','ocean-freight-bills:reconcile'
);

ALTER TABLE media_assets DROP CONSTRAINT media_assets_upload_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_upload_purpose_check
  CHECK (upload_purpose IS NULL OR upload_purpose IN ('PAYMENT_RECIPIENT_QR','PURCHASE_PAYMENT_VOUCHER','PACKAGING_PAYMENT_VOUCHER','OCEAN_FREIGHT_SOURCE_XLSX'));

-- 来源资料与其他媒体领域共用引用保护。挂载后禁止转入回收状态或伪装成其他文件类型。
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
  ELSIF TG_TABLE_NAME IN ('container_batches', 'ocean_freight_bills') THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD.source_file_id; ELSE reference_asset_id := NEW.source_file_id; END IF;
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
    AND NOT EXISTS (SELECT 1 FROM container_batches reference WHERE reference.source_file_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM ocean_freight_bills reference WHERE reference.source_file_id = reference_asset_id)
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
  IF EXISTS (SELECT 1 FROM container_batches WHERE source_file_id = reference_asset_id)
    OR EXISTS (SELECT 1 FROM ocean_freight_bills WHERE source_file_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'DOCUMENT' AND upload_purpose = 'OCEAN_FREIGHT_SOURCE_XLSX'
      AND mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 52428800;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ocean freight source must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'ocean_freight_source_ready_check';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE CONSTRAINT TRIGGER container_batches_source_ready_trigger AFTER INSERT OR UPDATE OR DELETE ON container_batches
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ready_media_asset_reference();
CREATE CONSTRAINT TRIGGER ocean_freight_bills_source_ready_trigger AFTER INSERT OR UPDATE OR DELETE ON ocean_freight_bills
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ready_media_asset_reference();

-- 移走旧来源文件时也复核旧引用，避免留下无业务引用的 READY 文件。
CREATE FUNCTION enforce_ocean_freight_old_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_file_id IS NOT NULL AND OLD.source_file_id IS DISTINCT FROM NEW.source_file_id THEN
    UPDATE media_assets SET updated_at = updated_at WHERE id = OLD.source_file_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER container_batches_old_source_trigger AFTER UPDATE ON container_batches
FOR EACH ROW EXECUTE FUNCTION enforce_ocean_freight_old_source();
CREATE TRIGGER ocean_freight_bills_old_source_trigger AFTER UPDATE ON ocean_freight_bills
FOR EACH ROW EXECUTE FUNCTION enforce_ocean_freight_old_source();

COMMIT;
