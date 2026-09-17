-- AlterEnum
ALTER TYPE "audit_event_type" ADD VALUE 'SUPPLIER_PAYMENT_PROFILE_SAVED';

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN "upload_purpose" VARCHAR(64), ADD COLUMN "purchase_payable_upload_id" UUID;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purchase_payable_upload_fkey FOREIGN KEY (purchase_payable_upload_id) REFERENCES purchase_order_payables(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX media_assets_purchase_payable_upload_idx ON media_assets(purchase_payable_upload_id);

-- AlterTable
ALTER TABLE "purchase_order_payments" ADD COLUMN     "recipient_qr_media_asset_id" UUID,
ADD COLUMN     "recipient_snapshot" JSONB;

-- CreateTable
CREATE TABLE "payment_recipient_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplier_value" VARCHAR(64),
    "purchase_order_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_recipient_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_recipient_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "payment_method" VARCHAR(64) NOT NULL,
    "recipient_name" VARCHAR(128) NOT NULL,
    "qr_media_asset_id" UUID,
    "bank_name" VARCHAR(128),
    "bank_account" VARCHAR(128),
    "bank_branch" VARCHAR(128),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_recipient_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_recipient_profiles_supplier_key" ON "payment_recipient_profiles"("supplier_value");

-- CreateIndex
CREATE UNIQUE INDEX "payment_recipient_profiles_order_key" ON "payment_recipient_profiles"("purchase_order_id");

-- CreateIndex
CREATE INDEX "payment_recipient_accounts_qr_asset_idx" ON "payment_recipient_accounts"("qr_media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_recipient_accounts_profile_method_key" ON "payment_recipient_accounts"("profile_id", "payment_method");

CREATE INDEX "purchase_order_payments_recipient_qr_idx" ON "purchase_order_payments"("recipient_qr_media_asset_id");

-- AddForeignKey
ALTER TABLE "purchase_order_payments" ADD CONSTRAINT "purchase_order_payments_recipient_qr_media_asset_id_fkey" FOREIGN KEY ("recipient_qr_media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_recipient_profiles" ADD CONSTRAINT "payment_recipient_profiles_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_recipient_profiles" ADD CONSTRAINT "payment_recipient_profiles_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_recipient_profiles" ADD CONSTRAINT "payment_recipient_profiles_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_recipient_accounts" ADD CONSTRAINT "payment_recipient_accounts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "payment_recipient_profiles"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_recipient_accounts" ADD CONSTRAINT "payment_recipient_accounts_qr_media_asset_id_fkey" FOREIGN KEY ("qr_media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE payment_recipient_profiles
  ADD CONSTRAINT payment_recipient_profiles_owner_check CHECK ((supplier_value IS NOT NULL) <> (purchase_order_id IS NOT NULL)),
  ADD CONSTRAINT payment_recipient_profiles_supplier_check CHECK (supplier_value IS NULL OR (supplier_value = btrim(supplier_value) AND length(supplier_value) > 0)),
  ADD CONSTRAINT payment_recipient_profiles_version_check CHECK (version >= 1);
ALTER TABLE payment_recipient_accounts
  ADD CONSTRAINT payment_recipient_accounts_shape_check CHECK (
    recipient_name = btrim(recipient_name) AND length(recipient_name) > 0 AND (
      (payment_method IN ('ALIPAY','WECHAT') AND qr_media_asset_id IS NOT NULL AND bank_name IS NULL AND bank_account IS NULL AND bank_branch IS NULL)
      OR (payment_method = 'BANK_TRANSFER' AND qr_media_asset_id IS NULL AND bank_name IS NOT NULL AND bank_account IS NOT NULL
        AND bank_name = btrim(bank_name) AND length(bank_name) > 0 AND bank_account = btrim(bank_account) AND length(bank_account) > 0
        AND (bank_branch IS NULL OR (bank_branch = btrim(bank_branch) AND length(bank_branch) > 0)))
    )
  );
ALTER TABLE media_assets ADD CONSTRAINT media_assets_upload_purpose_check
  CHECK (upload_purpose IS NULL OR upload_purpose IN ('PAYMENT_RECIPIENT_QR','PURCHASE_PAYMENT_VOUCHER'));
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purchase_payable_upload_check
  CHECK (purchase_payable_upload_id IS NULL OR upload_purpose IS NOT DISTINCT FROM 'PURCHASE_PAYMENT_VOUCHER');
ALTER TABLE purchase_order_payments ADD CONSTRAINT purchase_order_payments_recipient_shape_check CHECK (
  (recipient_snapshot IS NULL AND recipient_qr_media_asset_id IS NULL)
  OR (recipient_snapshot IS NOT NULL AND jsonb_typeof(recipient_snapshot) = 'object'
    AND recipient_snapshot->>'paymentMethod' = payment_method
    AND length(recipient_snapshot->>'recipientName') > 0
    AND ((payment_method IN ('ALIPAY','WECHAT') AND recipient_qr_media_asset_id IS NOT NULL AND recipient_snapshot->>'qrMediaAssetId' = recipient_qr_media_asset_id::text)
      OR (payment_method = 'BANK_TRANSFER' AND recipient_qr_media_asset_id IS NULL AND length(recipient_snapshot->>'bankName') > 0 AND length(recipient_snapshot->>'bankAccount') > 0)))
);

-- 收款资料归属与账户身份固定；停用或修改内容保留原行，历史付款使用独立快照。
CREATE FUNCTION enforce_payment_recipient_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Recipient identity cannot be deleted' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_identity_check'; END IF;
  IF TG_TABLE_NAME = 'payment_recipient_profiles' THEN
    IF TG_OP = 'UPDATE' AND (ROW(NEW.id,NEW.supplier_value,NEW.purchase_order_id,NEW.created_by_user_id,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.supplier_value,OLD.purchase_order_id,OLD.created_by_user_id,OLD.created_at) OR NEW.version <> OLD.version + 1) THEN
      RAISE EXCEPTION 'Recipient profile identity is immutable' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_identity_check';
    END IF;
    IF NEW.purchase_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = NEW.purchase_order_id AND product_mode = 'CUSTOM') THEN
      RAISE EXCEPTION 'Order recipient requires a custom purchase' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_order_check';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND ROW(NEW.id,NEW.profile_id,NEW.payment_method,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.profile_id,OLD.payment_method,OLD.created_at) THEN
    RAISE EXCEPTION 'Recipient account identity is immutable' USING ERRCODE = '23514', CONSTRAINT = 'payment_recipient_identity_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_recipient_profiles_identity_trigger BEFORE INSERT OR UPDATE OR DELETE ON payment_recipient_profiles FOR EACH ROW EXECUTE FUNCTION enforce_payment_recipient_identity();
CREATE TRIGGER payment_recipient_accounts_identity_trigger BEFORE UPDATE OR DELETE ON payment_recipient_accounts FOR EACH ROW EXECUTE FUNCTION enforce_payment_recipient_identity();

CREATE FUNCTION enforce_media_asset_upload_purpose() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.upload_purpose IS DISTINCT FROM OLD.upload_purpose AND (OLD.upload_purpose IS NOT NULL OR OLD.status <> 'UPLOADING') THEN
    RAISE EXCEPTION 'Media upload purpose is immutable after assignment' USING ERRCODE = '23514', CONSTRAINT = 'media_assets_upload_purpose_immutable_check';
  END IF;
  IF NEW.purchase_payable_upload_id IS DISTINCT FROM OLD.purchase_payable_upload_id
    AND (OLD.purchase_payable_upload_id IS NOT NULL OR OLD.status <> 'UPLOADING') THEN
    RAISE EXCEPTION 'Voucher upload installment is immutable after assignment' USING ERRCODE = '23514', CONSTRAINT = 'media_assets_purchase_payable_upload_immutable_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_assets_upload_purpose_trigger BEFORE UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION enforce_media_asset_upload_purpose();

-- 快照必须来自该采购单自己的资料或它的字典供应商；不接受客户端拼装其他供应商的账户。
CREATE FUNCTION enforce_purchase_payment_recipient_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recipient_snapshot IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM payment_recipient_accounts account JOIN payment_recipient_profiles profile ON profile.id = account.profile_id
    JOIN purchase_orders purchase ON purchase.id = NEW.purchase_order_id
    WHERE account.id::text = NEW.recipient_snapshot->>'id' AND account.enabled AND account.payment_method = NEW.payment_method
      AND ((purchase.product_mode = 'CUSTOM' AND profile.purchase_order_id = purchase.id)
        OR (purchase.product_mode <> 'CUSTOM' AND profile.supplier_value = purchase.supplier_value))
      AND account.recipient_name = NEW.recipient_snapshot->>'recipientName'
      AND account.qr_media_asset_id IS NOT DISTINCT FROM NEW.recipient_qr_media_asset_id
      AND account.bank_name IS NOT DISTINCT FROM NEW.recipient_snapshot->>'bankName'
      AND account.bank_account IS NOT DISTINCT FROM NEW.recipient_snapshot->>'bankAccount'
      AND account.bank_branch IS NOT DISTINCT FROM NEW.recipient_snapshot->>'bankBranch'
  ) THEN RAISE EXCEPTION 'Payment recipient snapshot does not match its source' USING ERRCODE = '23514', CONSTRAINT = 'purchase_payment_recipient_snapshot_check'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_order_payments_recipient_snapshot_trigger BEFORE INSERT ON purchase_order_payments FOR EACH ROW EXECUTE FUNCTION enforce_purchase_payment_recipient_snapshot();

-- 配置入口默认只向系统管理员授予；财务读取按采购付款权限走对应业务接口。
INSERT INTO permissions(id,code,name,description,system_only) VALUES
  (gen_random_uuid(),'supplier-payment-profiles:read','查看供应商收款配置','查看供应商收款方式与账户资料',false),
  (gen_random_uuid(),'supplier-payment-profiles:update','配置供应商收款资料','维护供应商支付宝、微信和银行收款资料',false);
INSERT INTO role_permissions(role_id,permission_id)
SELECT role.id,permission.id FROM roles role CROSS JOIN permissions permission
WHERE role.code = 'system_admin' AND permission.code IN ('supplier-payment-profiles:read','supplier-payment-profiles:update');

-- 只补缺失的稳定付款方式；已有标签、排序与启停选择均原样保留。
DO $$
DECLARE type_id UUID; created_type BOOLEAN := false;
BEGIN
  SELECT id INTO type_id FROM dictionary_types WHERE code = 'payment.method';
  IF NOT FOUND THEN
    INSERT INTO dictionary_types(id,code,name,enabled) VALUES (gen_random_uuid(),'payment.method','付款方式',false) RETURNING id INTO type_id;
    created_type := true;
  END IF;
  INSERT INTO dictionary_items(id,dictionary_type_id,value,label,enabled,sort_order)
  SELECT gen_random_uuid(),type_id,seed.value,seed.label,true,seed.sort_order
  FROM (VALUES ('ALIPAY','支付宝',10),('WECHAT','微信',20),('BANK_TRANSFER','银行转账',30)) AS seed(value,label,sort_order)
  ON CONFLICT (dictionary_type_id,value) DO NOTHING;
  IF created_type THEN UPDATE dictionary_types SET enabled = true WHERE id = type_id; END IF;
END $$;

-- 收款配置与历史付款快照共同持有二维码，替换配置不能清理已经使用的付款资料。
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
    AND NOT EXISTS (SELECT 1 FROM packaging_cost_requests reference WHERE reference.packaging_image_media_asset_id = reference_asset_id OR reference.quotation_image_media_asset_id = reference_asset_id)
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
  IF current_status <> 'READY' AND EXISTS (SELECT 1 FROM packaging_cost_requests WHERE packaging_image_media_asset_id = reference_asset_id OR quotation_image_media_asset_id = reference_asset_id) THEN
    RAISE EXCEPTION 'Packaging evidence must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_image_ready_check';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_recipient_accounts WHERE qr_media_asset_id = reference_asset_id)
    OR EXISTS (SELECT 1 FROM purchase_order_payments WHERE recipient_qr_media_asset_id = reference_asset_id) THEN
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
CREATE CONSTRAINT TRIGGER payment_recipient_accounts_ready_reference_trigger AFTER INSERT OR UPDATE ON payment_recipient_accounts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ready_media_asset_reference();
CREATE CONSTRAINT TRIGGER purchase_order_payments_recipient_ready_reference_trigger AFTER INSERT OR UPDATE ON purchase_order_payments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ready_media_asset_reference();

-- 修改配置移走旧二维码时也复核旧引用，避免绕过服务产生不可回收的 READY 孤儿。
CREATE FUNCTION enforce_payment_recipient_old_image() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.qr_media_asset_id IS NOT NULL AND OLD.qr_media_asset_id IS DISTINCT FROM NEW.qr_media_asset_id THEN
    UPDATE media_assets SET updated_at = updated_at WHERE id = OLD.qr_media_asset_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_recipient_accounts_old_image_trigger AFTER UPDATE ON payment_recipient_accounts
FOR EACH ROW EXECUTE FUNCTION enforce_payment_recipient_old_image();
