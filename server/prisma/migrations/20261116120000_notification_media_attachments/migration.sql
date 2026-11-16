BEGIN;

-- 通知中心图片附件：模板附件策略、通知级附件清单、投递级附件发送事实。
--
-- 迁移是 additive 的：只新增枚举值、两列与两张空表，并把通知附件接入通用 READY 媒体引用闭包；
-- 不修改任何既有通知、模板或投递行。`notification_media` 的引用触发器刻意只覆盖
-- INSERT/UPDATE——通知保留期清理通过级联删除附件行，若把 DELETE 也纳入校验，
-- 删除最后一条引用会被「READY 资产必须有活跃引用」拦下。

-- AlterEnum
ALTER TYPE "assistant_delivery_status" ADD VALUE IF NOT EXISTS 'PARTIAL';

-- AlterTable
ALTER TABLE "notification_templates" ADD COLUMN "media_policy" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "assistant_deliveries" ADD COLUMN "content_sent_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "notification_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "blocked_reason" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_delivery_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "status" "assistant_delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider_msg_id" VARCHAR(64),
    "provider_new_msg_id" VARCHAR(64),
    "failure_code" VARCHAR(64),
    "failure_message" VARCHAR(255),
    "fetched_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_delivery_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_media_notification_sort_key" ON "notification_media"("notification_id", "sort_order");

-- CreateIndex
CREATE INDEX "notification_media_asset_idx" ON "notification_media"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_delivery_media_delivery_sort_key" ON "assistant_delivery_media"("delivery_id", "sort_order");

-- CreateIndex
CREATE INDEX "assistant_delivery_media_status_next_idx" ON "assistant_delivery_media"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "assistant_delivery_media_asset_idx" ON "assistant_delivery_media"("media_asset_id");

-- AddForeignKey
ALTER TABLE "notification_media" ADD CONSTRAINT "notification_media_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notification_media" ADD CONSTRAINT "notification_media_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_delivery_media" ADD CONSTRAINT "assistant_delivery_media_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "assistant_deliveries"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_delivery_media" ADD CONSTRAINT "assistant_delivery_media_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 通用就绪引用校验追加通知附件分支：通知附件只作为「资产仍被引用」的证据，
-- 不反向要求资产必须保持 READY——业务证据表才是 READY 的真相源。
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
  ELSIF TG_TABLE_NAME = 'advertising_recharge_requests' THEN
    IF TG_OP = 'DELETE' THEN
      reference_asset_id := COALESCE(OLD."payment_qr_media_asset_id", OLD."payment_proof_media_asset_id");
    ELSE
      reference_asset_id := COALESCE(NEW."payment_qr_media_asset_id", NEW."payment_proof_media_asset_id");
    END IF;
  ELSIF TG_TABLE_NAME = 'notification_media' THEN
    IF TG_OP = 'DELETE' THEN reference_asset_id := OLD."media_asset_id"; ELSE reference_asset_id := NEW."media_asset_id"; END IF;
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
    AND NOT EXISTS (SELECT 1 FROM advertising_recharge_requests reference WHERE reference.payment_qr_media_asset_id = reference_asset_id OR reference.payment_proof_media_asset_id = reference_asset_id)
    AND NOT EXISTS (SELECT 1 FROM notification_media reference WHERE reference.media_asset_id = reference_asset_id)
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
  IF EXISTS (SELECT 1 FROM advertising_recharge_requests WHERE payment_qr_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'ADVERTISING_RECHARGE_QR'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Advertising recharge QR must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'advertising_recharge_requests_qr_ready_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM advertising_recharge_requests WHERE payment_proof_media_asset_id = reference_asset_id) THEN
    PERFORM 1 FROM media_assets WHERE id = reference_asset_id AND status = 'READY' AND deleted_at IS NULL
      AND media_type = 'IMAGE' AND upload_purpose = 'ADVERTISING_RECHARGE_PAYMENT_PROOF'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND object_key IS NOT NULL AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND size_bytes > 0 AND size_bytes <= 10485760;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Advertising recharge payment proof must remain ready' USING ERRCODE = '23514', CONSTRAINT = 'advertising_recharge_requests_proof_ready_check';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 通知附件只校验 INSERT/UPDATE：通知清理的级联删除不得因「删掉最后一条引用」而失败。
CREATE CONSTRAINT TRIGGER "notification_media_ready_reference_trigger"
AFTER INSERT OR UPDATE ON "notification_media"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_ready_media_asset_reference"();

-- 自校验：枚举值、两列、两张表与引用触发器缺失即整单回滚。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = '"assistant_delivery_status"'::regtype AND enumlabel = 'PARTIAL'
  ) THEN
    RAISE EXCEPTION 'assistant delivery PARTIAL status missing' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_templates' AND column_name = 'media_policy'
  ) THEN
    RAISE EXCEPTION 'notification template media policy column missing' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assistant_deliveries' AND column_name = 'content_sent_at'
  ) THEN
    RAISE EXCEPTION 'assistant delivery content sent column missing' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'notification_media_ready_reference_trigger' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'notification media ready reference trigger missing' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'enforce_ready_media_asset_reference'
      AND pg_get_functiondef(oid) LIKE '%FROM notification_media reference%'
  ) THEN
    RAISE EXCEPTION 'media reference function missing notification branch' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
