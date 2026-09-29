-- 顺联航账单管理：新增账单头、明细与费用明细三张表，接入编号身份校验与媒体就绪校验。
-- 结构与约束必须完整提交；失败时不留下半应用状态。
BEGIN;

-- CreateEnum
CREATE TYPE "slh_bill_charge_type" AS ENUM ('FREIGHT', 'COD_HANDLING', 'HEAVY_CARGO', 'DELIVERY', 'REDELIVERY', 'TRANSFER_DELIVERY', 'REMOTE_AREA', 'UNLOADING', 'STORAGE', 'WAITING', 'OVERSIZE', 'INSPECTION', 'FORKLIFT', 'MINIMUM_CHARGE', 'OTHER');

-- CreateEnum
CREATE TYPE "slh_bill_pricing_basis" AS ENUM ('WEIGHT', 'VOLUME');

-- CreateEnum
CREATE TYPE "slh_bill_rate_source" AS ENUM ('EMBEDDED', 'SYSTEM', 'MANUAL');

-- CreateTable
CREATE TABLE "slh_bills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slh_bill_no" VARCHAR(64) NOT NULL,
    "numbering_issuance_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "source_file_id" UUID NOT NULL,
    "source_file_name" VARCHAR(255) NOT NULL,
    "source_file_sha256" CHAR(64) NOT NULL,
    "freight_total_amount_cny" DECIMAL(30,2) NOT NULL,
    "cod_handling_total_amount_cny" DECIMAL(30,2) NOT NULL,
    "surcharge_total_amount_cny" DECIMAL(30,2) NOT NULL,
    "payable_total_amount_cny" DECIMAL(30,2) NOT NULL,
    "cod_total_amount_twd" DECIMAL(30,2) NOT NULL,
    "ntd_surcharge_total_amount_twd" DECIMAL(30,2) NOT NULL,
    "reported_net_amount_twd" DECIMAL(30,2) NOT NULL,
    "rate_source" "slh_bill_rate_source",
    "foreign_units_per_cny_snapshot" DECIMAL(30,12),
    "embedded_foreign_units_per_cny" DECIMAL(30,12),
    "exchange_rate_id" UUID,
    "exchange_rate_version_snapshot" INTEGER,
    "rate_captured_at" TIMESTAMPTZ(6),
    "line_count" INTEGER NOT NULL,
    "container_batch_count" INTEGER NOT NULL,
    "container_batch_names" VARCHAR(2000) NOT NULL,
    "superseded_by_id" UUID,
    "superseded_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_request_key_hash" BYTEA NOT NULL,
    "import_payload_hash" BYTEA NOT NULL,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slh_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slh_bill_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "loading_date" DATE NOT NULL,
    "container_batch_name_text" VARCHAR(128) NOT NULL,
    "container_batch_id" UUID,
    "warehouse_receipt_reference" VARCHAR(1000),
    "shipping_mark_text" VARCHAR(500),
    "goods_name" VARCHAR(255) NOT NULL,
    "package_count" INTEGER NOT NULL,
    "package_unit" VARCHAR(32),
    "gross_weight_kg" DECIMAL(18,3),
    "weight_unit" VARCHAR(32),
    "length_cm" DECIMAL(18,2),
    "width_cm" DECIMAL(18,2),
    "height_cm" DECIMAL(18,2),
    "volume_cai" DECIMAL(24,2),
    "reported_volume_cai" DECIMAL(24,2),
    "category_code" VARCHAR(32),
    "unit_price_amount" DECIMAL(30,2),
    "pricing_basis" "slh_bill_pricing_basis",
    "freight_amount_cny" DECIMAL(30,2) NOT NULL,
    "cod_handling_amount_cny" DECIMAL(30,2) NOT NULL,
    "surcharge_amount_cny" DECIMAL(30,2) NOT NULL,
    "payable_amount_cny" DECIMAL(30,2) NOT NULL,
    "cod_amount_twd" DECIMAL(30,2) NOT NULL,
    "ntd_surcharge_amount_twd" DECIMAL(30,2) NOT NULL,
    "recipient_info_raw" VARCHAR(2000),
    "remark" VARCHAR(2000),
    "source_sheet_name" VARCHAR(255) NOT NULL,
    "source_row_number" INTEGER NOT NULL,
    "source_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slh_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slh_bill_line_charges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "charge_type" "slh_bill_charge_type" NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "amount" DECIMAL(30,2) NOT NULL,
    "pricing_basis" "slh_bill_pricing_basis",
    "source_remark_text" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slh_bill_line_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slh_bills_number_key" ON "slh_bills"("slh_bill_no");

-- CreateIndex
CREATE UNIQUE INDEX "slh_bills_issuance_key" ON "slh_bills"("numbering_issuance_id");

-- CreateIndex
CREATE INDEX "slh_bills_period_id_idx" ON "slh_bills"("period_start" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "slh_bills_source_sha256_idx" ON "slh_bills"("source_file_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "slh_bills_actor_request_key" ON "slh_bills"("created_by_id", "import_request_key_hash");

-- CreateIndex
CREATE INDEX "slh_bill_lines_container_batch_idx" ON "slh_bill_lines"("container_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "slh_bill_lines_bill_line_key" ON "slh_bill_lines"("bill_id", "line_number");

-- CreateIndex
CREATE INDEX "slh_bill_line_charges_line_idx" ON "slh_bill_line_charges"("line_id");

-- AddForeignKey
ALTER TABLE "slh_bills" ADD CONSTRAINT "slh_bills_numbering_issuance_id_fkey" FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_bills" ADD CONSTRAINT "slh_bills_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_bills" ADD CONSTRAINT "slh_bills_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_bills" ADD CONSTRAINT "slh_bills_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "slh_bills"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_bills" ADD CONSTRAINT "slh_bills_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_bills" ADD CONSTRAINT "slh_bills_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_bill_lines" ADD CONSTRAINT "slh_bill_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "slh_bills"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_bill_lines" ADD CONSTRAINT "slh_bill_lines_container_batch_id_fkey" FOREIGN KEY ("container_batch_id") REFERENCES "container_batches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_bill_line_charges" ADD CONSTRAINT "slh_bill_line_charges_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "slh_bill_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ========== 顺联航账单管理的业务约束 ==========

-- 1) 账单头：金额勾稽、期间顺序、摘要格式、汇率来源互斥、取代状态机。
ALTER TABLE slh_bills
  ADD CONSTRAINT slh_bills_amount_check CHECK (
    freight_total_amount_cny >= 0 AND cod_handling_total_amount_cny >= 0
    AND surcharge_total_amount_cny >= 0 AND payable_total_amount_cny >= 0
    AND cod_total_amount_twd >= 0 AND ntd_surcharge_total_amount_twd >= 0
    AND payable_total_amount_cny = freight_total_amount_cny + cod_handling_total_amount_cny + surcharge_total_amount_cny
    -- 「合计应付台币NTD」按不折算口径记录，即代收货款减去 NTD 杂费合计。
    AND reported_net_amount_twd = cod_total_amount_twd - ntd_surcharge_total_amount_twd
  ),
  ADD CONSTRAINT slh_bills_period_check CHECK (period_start <= period_end),
  ADD CONSTRAINT slh_bills_counts_check CHECK (line_count > 0 AND container_batch_count > 0),
  ADD CONSTRAINT slh_bills_digest_check CHECK (
    source_file_sha256 ~ '^[a-f0-9]{64}$'
    AND octet_length(import_request_key_hash) = 32
    AND octet_length(import_payload_hash) = 32
  ),
  -- 汇率的三种来源形状互斥：内嵌取账单公式除数，系统读汇率主数据，手填由用户覆盖。
  ADD CONSTRAINT slh_bills_rate_check CHECK (
    (rate_source IS NULL AND foreign_units_per_cny_snapshot IS NULL AND embedded_foreign_units_per_cny IS NULL
      AND exchange_rate_id IS NULL AND exchange_rate_version_snapshot IS NULL AND rate_captured_at IS NULL)
    OR (rate_source = 'EMBEDDED' AND foreign_units_per_cny_snapshot > 0
      AND embedded_foreign_units_per_cny = foreign_units_per_cny_snapshot
      AND exchange_rate_id IS NULL AND exchange_rate_version_snapshot IS NULL AND rate_captured_at IS NOT NULL)
    OR (rate_source = 'SYSTEM' AND foreign_units_per_cny_snapshot > 0 AND embedded_foreign_units_per_cny IS NULL
      AND exchange_rate_id IS NOT NULL AND exchange_rate_version_snapshot IS NOT NULL AND rate_captured_at IS NOT NULL)
    OR (rate_source = 'MANUAL' AND foreign_units_per_cny_snapshot > 0 AND embedded_foreign_units_per_cny IS NULL
      AND exchange_rate_id IS NULL AND exchange_rate_version_snapshot IS NULL AND rate_captured_at IS NOT NULL)
  ),
  -- 取代只能发生一次，且不能指向自己。
  ADD CONSTRAINT slh_bills_supersession_check CHECK (
    (superseded_by_id IS NULL AND superseded_at IS NULL AND version = 1)
    OR (superseded_by_id IS NOT NULL AND superseded_at IS NOT NULL AND version = 2 AND superseded_by_id <> id)
  );

-- 2) 明细行：行金额勾稽与计价方式推导口径。
ALTER TABLE slh_bill_lines
  ADD CONSTRAINT slh_bill_lines_amount_check CHECK (
    line_number > 0 AND package_count > 0
    AND freight_amount_cny >= 0 AND cod_handling_amount_cny >= 0 AND surcharge_amount_cny >= 0
    AND payable_amount_cny >= 0 AND cod_amount_twd >= 0 AND ntd_surcharge_amount_twd >= 0
    AND payable_amount_cny = freight_amount_cny + cod_handling_amount_cny + surcharge_amount_cny
  ),
  ADD CONSTRAINT slh_bill_lines_pricing_check CHECK (
    (unit_price_amount IS NULL AND pricing_basis IS NULL)
    OR (unit_price_amount <= 10 AND pricing_basis = 'WEIGHT')
    OR (unit_price_amount > 10 AND pricing_basis = 'VOLUME')
  ),
  ADD CONSTRAINT slh_bill_lines_volume_check CHECK (
    volume_cai IS NULL OR (volume_cai >= 0 AND volume_cai = trunc(volume_cai, 2))
  );

-- 3) 费用明细：币种限定在账单实际使用的两种，金额必须为正。
ALTER TABLE slh_bill_line_charges
  ADD CONSTRAINT slh_bill_line_charges_amount_check CHECK (amount > 0 AND currency_code IN ('CNY', 'TWD'));

-- 4) 账单是外部凭证：明细与费用明细不可改不可删；账单头只能被取代，不能被改写。
-- 编号必须来自 CTN_BILL_NO 的派发台账，应用不得自行拼装。
CREATE FUNCTION enforce_slh_bill_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SLH bill evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'slh_bills_immutable_check';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM numbering_issuances issuance
      JOIN numbering_rules rule ON rule.id = issuance.rule_id
      WHERE issuance.id = NEW.numbering_issuance_id
        AND issuance.generated_number = NEW.slh_bill_no
        AND issuance.consumer_code = 'SLH_BILL.CREATE'
        AND rule.rule_code = 'CTN_BILL_NO'
        AND rule.purpose = 'BUSINESS'
    ) THEN
      RAISE EXCEPTION 'SLH bill number must match its scoped issuance' USING ERRCODE = '23514', CONSTRAINT = 'slh_bills_number_identity_check';
    END IF;
    IF NEW.version <> 1 OR NEW.superseded_by_id IS NOT NULL OR NEW.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'SLH bill must begin unsuperseded' USING ERRCODE = '23514', CONSTRAINT = 'slh_bills_supersession_check';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.superseded_by_id IS NOT NULL OR NEW.version <> OLD.version + 1
    OR (to_jsonb(NEW) - ARRAY['superseded_by_id','superseded_at','version','updated_by_id','updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['superseded_by_id','superseded_at','version','updated_by_id','updated_at']) THEN
    RAISE EXCEPTION 'SLH bill evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'slh_bills_immutable_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER slh_bills_identity_trigger BEFORE INSERT OR UPDATE OR DELETE ON slh_bills
FOR EACH ROW EXECUTE FUNCTION enforce_slh_bill_identity();

CREATE FUNCTION enforce_slh_bill_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SLH bill evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'slh_bill_evidence_immutable_check';
END $$;
CREATE TRIGGER slh_bill_lines_immutable_trigger BEFORE UPDATE OR DELETE ON slh_bill_lines
FOR EACH ROW EXECUTE FUNCTION enforce_slh_bill_evidence_immutable();
CREATE TRIGGER slh_bill_line_charges_immutable_trigger BEFORE UPDATE OR DELETE ON slh_bill_line_charges
FOR EACH ROW EXECUTE FUNCTION enforce_slh_bill_evidence_immutable();

-- 5) 原件必须保持就绪：用途白名单加入账单来源，并接入统一就绪校验。
ALTER TABLE media_assets DROP CONSTRAINT media_assets_upload_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_upload_purpose_check
  CHECK (upload_purpose IS NULL OR upload_purpose IN ('PAYMENT_RECIPIENT_QR','PURCHASE_PAYMENT_VOUCHER','PACKAGING_PAYMENT_VOUCHER','OCEAN_FREIGHT_SOURCE_XLSX','SLH_BILL_SOURCE_XLSX'));

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
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER slh_bills_source_ready_trigger AFTER INSERT OR UPDATE OR DELETE ON slh_bills
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_ready_media_asset_reference"();

-- 6) 权限：账单导入默认仅授予系统管理员，由角色管理明确向财务分配。
INSERT INTO permissions(id, code, name, description, system_only) VALUES
(gen_random_uuid(), 'slh-bills:create', '导入顺联航账单', '上传顺联航对账单并确认结构化入库', false);
INSERT INTO role_permissions(role_id, permission_id)
SELECT role.id, permission.id FROM roles role CROSS JOIN permissions permission
WHERE role.code = 'system_admin' AND permission.code = 'slh-bills:create';

-- 7) 结构自校验：表、权限或账单用途白名单缺失即整单回滚。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES ('slh_bills'), ('slh_bill_lines'), ('slh_bill_line_charges')) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = expected.name)
  ) THEN
    RAISE EXCEPTION 'SLH bill tables missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'slh-bills:create') THEN
    RAISE EXCEPTION 'SLH bill permission missing' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM permissions WHERE code IN ('slh-bills:read', 'slh-bills:reconcile')) <> 2 THEN
    RAISE EXCEPTION 'SLH bill read permissions missing' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
