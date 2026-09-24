-- 海运账单领域退役：删除账单三表、账单专属枚举与函数，把仍服务柜次的函数和权限目录收敛到现存对象。
-- 全部删除都带 IF EXISTS，便于在已被手工 teardown 过的库上安全重放。

-- 1) 账单三表：索引、触发器与账单专属约束随表删除。
DROP TABLE IF EXISTS "ocean_freight_bill_charges" CASCADE;
DROP TABLE IF EXISTS "ocean_freight_bill_lines" CASCADE;
DROP TABLE IF EXISTS "ocean_freight_bills" CASCADE;

-- 2) 账单专属枚举。
DROP TYPE IF EXISTS "ocean_freight_charge_nature";
DROP TYPE IF EXISTS "ocean_freight_charge_type";
DROP TYPE IF EXISTS "ocean_freight_currency_code";
DROP TYPE IF EXISTS "ocean_freight_line_type";
DROP TYPE IF EXISTS "ocean_freight_pricing_basis";
DROP TYPE IF EXISTS "ocean_freight_reconciliation_status";

-- 3) 审计事件枚举去掉两个账单事件：PostgreSQL 不能删除枚举值，只能重建类型。
ALTER TYPE "audit_event_type" RENAME TO "audit_event_type_retired";
CREATE TYPE "audit_event_type" AS ENUM (
  'CONTAINER_BATCH_UPDATED',
  'CONTAINER_LOADING_ITEM_UPDATED',
  'CONTAINER_LOADING_ITEM_CREATED',
  'CONTAINER_BATCH_CREATED',
  'PACKAGING_COST_SUBMITTED',
  'PACKAGING_COST_PAID',
  'PACKAGING_COST_AMOUNT_UPDATED',
  'AUTH_LOGIN_SUCCEEDED',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT',
  'AUTH_LOGOUT_ALL',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_ENABLED',
  'USER_DISABLED',
  'USER_PASSWORD_CHANGED',
  'USER_PASSWORD_RESET',
  'USER_ROLES_CHANGED',
  'ROLE_CREATED',
  'ROLE_UPDATED',
  'ROLE_PERMISSIONS_CHANGED',
  'REGION_CREATED',
  'REGION_UPDATED',
  'REGION_ENABLED',
  'REGION_DISABLED',
  'CURRENCY_CREATED',
  'CURRENCY_UPDATED',
  'CURRENCY_ENABLED',
  'CURRENCY_DISABLED',
  'EXCHANGE_RATE_CREATED',
  'EXCHANGE_RATE_UPDATED',
  'NUMBERING_RULE_CREATED',
  'NUMBERING_RULE_UPDATED',
  'NUMBERING_RULE_VERSION_PUBLISHED',
  'NUMBERING_RULE_ENABLED',
  'NUMBERING_RULE_DISABLED',
  'SHIPPING_MARK_BINDING_CREATED',
  'SHIPPING_MARK_BINDING_UPDATED',
  'PACKAGING_PAYMENT_PROFILE_SAVED',
  'SUPPLIER_PAYMENT_PROFILE_SAVED',
  'DICTIONARY_TYPE_CREATED',
  'DICTIONARY_TYPE_UPDATED',
  'DICTIONARY_TYPE_ENABLED',
  'DICTIONARY_TYPE_DISABLED',
  'DICTIONARY_ITEM_CREATED',
  'DICTIONARY_ITEM_UPDATED',
  'DICTIONARY_ITEM_ENABLED',
  'DICTIONARY_ITEM_DISABLED',
  'SYSTEM_BOOTSTRAP',
  'SYSTEM_ADMIN_RECOVERED',
  'AUTH_RETENTION_PURGED',
  'PRODUCT_CREATED',
  'PRODUCT_UPDATED',
  'FUND_ACCOUNT_CREATED',
  'FUND_ACCOUNT_SHARE_RATE_UPDATED',
  'FUND_POSTING_TYPE_CREATED',
  'FUND_POSTING_TYPE_UPDATED',
  'FUND_POSTING_TYPE_ENABLED',
  'FUND_POSTING_TYPE_DISABLED',
  'FUND_POSTING_RULE_PUBLISHED',
  'FUND_BUSINESS_SOURCE_CREATED',
  'FUND_BUSINESS_SOURCE_UPDATED',
  'FUND_BUSINESS_SOURCE_ENABLED',
  'FUND_BUSINESS_SOURCE_DISABLED',
  'FUND_MANUAL_ADJUSTMENT_POSTED',
  'FUND_BUSINESS_POSTED',
  'FUND_POSTING_REVERSED',
  'SALES_ORDER_CREATED',
  'SALES_ORDER_ORDER_STATUS_CHANGED',
  'SALES_ORDER_FULFILLMENT_STATUS_CHANGED',
  'SALES_ORDER_PAYMENT_TERMS_UPDATED',
  'SALES_ORDER_PAYMENT_RECORDED',
  'SALES_RECEIPT_SUBMITTED',
  'SALES_RECEIPT_APPROVED',
  'SALES_RECEIPT_REJECTED',
  'SALES_ORDER_PAYMENT_VOIDED',
  'SALES_ORDER_DOCUMENT_ATTACHED',
  'SALES_ORDER_DOCUMENT_DETACHED',
  'SALES_ORDER_PRODUCT_APPENDED',
  'SALES_ORDER_PRODUCTS_CHANGED',
  'PURCHASE_ORDER_CREATED',
  'PURCHASE_SHIPMENT_NUMBER_ASSIGNED',
  'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED',
  'PURCHASE_ORDER_REVIEW_MARKS_PREPARED',
  'PURCHASE_ORDER_IMAGE_GENERATED',
  'PURCHASE_ORDER_ORDER_STATUS_CHANGED',
  'PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED',
  'PURCHASE_ORDER_PAYMENT_RECORDED',
  'PURCHASE_ORDER_PAYMENT_VOIDED',
  'PURCHASE_ORDER_DOCUMENT_ATTACHED',
  'PURCHASE_ORDER_DOCUMENT_DETACHED'
);
ALTER TABLE "audit_events" ALTER COLUMN "event_type" TYPE "audit_event_type" USING ("event_type"::text::"audit_event_type");
DROP TYPE "audit_event_type_retired";

-- 4) 账单专属触发器函数。
DROP FUNCTION IF EXISTS enforce_ocean_freight_adjustment_target() CASCADE;

-- 5) 编号身份校验只服务柜次，保留原约束名与柜次触发器。
CREATE OR REPLACE FUNCTION enforce_ocean_freight_numbering_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_rule text; expected_consumer text; expected_number text;
BEGIN
  -- 触发对象只剩柜次：账单编号身份校验随海运账单退役一并取消。
  expected_rule := 'CONTAINER_BATCH_NO'; expected_consumer := 'CONTAINER_BATCH.CREATE';
  expected_number := NEW.container_batch_no;
  IF NOT EXISTS (SELECT 1 FROM numbering_issuances issuance JOIN numbering_rules rule ON rule.id = issuance.rule_id
      WHERE issuance.id = NEW.numbering_issuance_id AND issuance.generated_number = expected_number
      AND issuance.consumer_code = expected_consumer AND rule.rule_code = expected_rule AND rule.purpose = 'BUSINESS') THEN
    RAISE EXCEPTION 'Business document number must match its scoped issuance'
      USING ERRCODE = '23514', CONSTRAINT = 'ocean_freight_numbering_identity_check';
  END IF;
  RETURN NEW;
END;
$$;

-- 6) 来源文件守卫去掉账单引用；柜次来源的 READY 校验保持不变。
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
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 7) 旧来源复核函数按现存的柜次语义更名。
CREATE OR REPLACE FUNCTION enforce_container_old_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_file_id IS NOT NULL AND OLD.source_file_id IS DISTINCT FROM NEW.source_file_id THEN
    UPDATE media_assets SET updated_at = updated_at WHERE id = OLD.source_file_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS container_batches_old_source_trigger ON container_batches;
CREATE TRIGGER container_batches_old_source_trigger AFTER UPDATE ON container_batches
FOR EACH ROW EXECUTE FUNCTION enforce_container_old_source();
DROP FUNCTION IF EXISTS enforce_ocean_freight_old_source();

-- 8) 权限目录去掉账单权限点与其角色绑定（内置系统管理员默认授权一并撤销）。
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code LIKE 'ocean-freight-bills:%');
DELETE FROM permissions WHERE code LIKE 'ocean-freight-bills:%';
