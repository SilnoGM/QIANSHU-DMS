-- 结构与约束必须完整提交；失败时不留下半应用状态。
BEGIN;

-- CreateEnum
CREATE TYPE "ocean_freight_line_type" AS ENUM ('NORMAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ocean_freight_reconciliation_status" AS ENUM ('UNMATCHED', 'PENDING', 'DISPUTED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ocean_freight_charge_type" AS ENUM ('FREIGHT', 'COD_HANDLING', 'HEAVY_CARGO', 'DELIVERY', 'REMOTE_AREA', 'UNLOADING', 'STORAGE', 'REDELIVERY', 'TRANSFER_DELIVERY', 'WAITING', 'OTHER');

-- CreateEnum
CREATE TYPE "ocean_freight_charge_nature" AS ENUM ('NORMAL', 'SUPPLEMENT', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "ocean_freight_pricing_basis" AS ENUM ('WEIGHT', 'VOLUME', 'FIXED');

-- CreateEnum
CREATE TYPE "ocean_freight_currency_code" AS ENUM ('CNY', 'TWD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_event_type" ADD VALUE 'OCEAN_FREIGHT_BILL_LINE_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'OCEAN_FREIGHT_BILL_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'CONTAINER_LOADING_ITEM_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'CONTAINER_BATCH_CREATED';

-- CreateTable
CREATE TABLE "container_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "container_batch_no" VARCHAR(64) NOT NULL,
    "numbering_issuance_id" UUID NOT NULL,
    "container_batch_name" VARCHAR(128) NOT NULL,
    "loading_date" DATE NOT NULL,
    "sequence_in_day" INTEGER NOT NULL,
    "warehouse_value" VARCHAR(64) NOT NULL,
    "source_file_id" UUID,
    "remark" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "creation_request_key" VARCHAR(128) NOT NULL,
    "creation_payload_hash" CHAR(64) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "container_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "container_loading_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "container_batch_id" UUID NOT NULL,
    "shipment_id" UUID,
    "line_number" INTEGER NOT NULL,
    "creation_request_key" VARCHAR(128) NOT NULL,
    "creation_payload_hash" CHAR(64) NOT NULL,
    "warehouse_receipt_reference" VARCHAR(1000),
    "ocean_shipping_mark_text" VARCHAR(500),
    "goods_name" VARCHAR(1000) NOT NULL,
    "package_count" INTEGER NOT NULL,
    "package_unit" VARCHAR(32),
    "gross_weight_kg" DECIMAL(18,3),
    "length_cm" DECIMAL(18,3),
    "width_cm" DECIMAL(18,3),
    "height_cm" DECIMAL(18,3),
    "volume_cai" DECIMAL(24,8),
    "chargeable_volume_cai" INTEGER,
    "reported_volume_cai" DECIMAL(24,8),
    "recipient_name" VARCHAR(128),
    "recipient_phone" VARCHAR(128),
    "recipient_address" VARCHAR(2000),
    "cod_amount_twd" DECIMAL(30,2),
    "remark" VARCHAR(2000),
    "source_sheet_name" VARCHAR(255),
    "source_row_number" INTEGER,
    "source_data" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "container_loading_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocean_freight_bills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_no" VARCHAR(64) NOT NULL,
    "numbering_issuance_id" UUID NOT NULL,
    "bill_name" VARCHAR(255) NOT NULL,
    "bill_date" DATE,
    "twd_per_cny" DECIMAL(30,12) NOT NULL,
    "cod_total_amount_twd" DECIMAL(30,2),
    "charge_total_amount_twd" DECIMAL(30,2),
    "payable_amount_cny" DECIMAL(30,2),
    "return_amount_cny" DECIMAL(30,2),
    "net_return_amount_cny" DECIMAL(30,2),
    "reported_payable_amount_cny" DECIMAL(30,2),
    "reported_return_amount_cny" DECIMAL(30,2),
    "reported_net_return_amount_cny" DECIMAL(30,2),
    "rounding_difference_cny" DECIMAL(30,2),
    "source_file_id" UUID,
    "remark" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "creation_request_key" VARCHAR(128) NOT NULL,
    "creation_payload_hash" CHAR(64) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocean_freight_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocean_freight_bill_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "container_batch_name" VARCHAR(128),
    "loading_date" DATE,
    "loading_item_id" UUID,
    "line_type" "ocean_freight_line_type" NOT NULL,
    "adjusts_bill_line_id" UUID,
    "creation_request_key" VARCHAR(128) NOT NULL,
    "creation_payload_hash" CHAR(64) NOT NULL,
    "warehouse_receipt_reference" VARCHAR(1000),
    "ocean_shipping_mark_text" VARCHAR(500),
    "goods_name" VARCHAR(1000) NOT NULL,
    "package_count" INTEGER,
    "package_unit" VARCHAR(32),
    "gross_weight_kg" DECIMAL(18,3),
    "length_cm" DECIMAL(18,3),
    "width_cm" DECIMAL(18,3),
    "height_cm" DECIMAL(18,3),
    "volume_cai" DECIMAL(24,8),
    "chargeable_volume_cai" INTEGER,
    "reported_volume_cai" DECIMAL(24,8),
    "recipient_name" VARCHAR(128),
    "recipient_phone" VARCHAR(128),
    "recipient_address" VARCHAR(2000),
    "cod_amount_twd" DECIMAL(30,2),
    "remark" VARCHAR(2000),
    "recipient_info_raw" VARCHAR(4000),
    "cargo_category_code" VARCHAR(32),
    "charge_total_amount_twd" DECIMAL(30,2),
    "payable_amount_cny" DECIMAL(30,2),
    "return_amount_cny" DECIMAL(30,2),
    "net_return_amount_cny" DECIMAL(30,2),
    "reconciliation_status" "ocean_freight_reconciliation_status" NOT NULL DEFAULT 'UNMATCHED',
    "reconciliation_remark" VARCHAR(2000),
    "reconciled_by_id" UUID,
    "reconciled_at" TIMESTAMPTZ(6),
    "source_sheet_name" VARCHAR(255),
    "source_row_number" INTEGER,
    "source_data" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocean_freight_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocean_freight_bill_charges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_line_id" UUID NOT NULL,
    "charge_type" "ocean_freight_charge_type" NOT NULL,
    "currency_code" "ocean_freight_currency_code" NOT NULL,
    "amount" DECIMAL(30,2) NOT NULL,
    "charge_nature" "ocean_freight_charge_nature" NOT NULL,
    "pricing_basis" "ocean_freight_pricing_basis" NOT NULL,
    "chargeable_quantity" DECIMAL(24,8),
    "unit_price_amount" DECIMAL(30,6),
    "reported_amount" DECIMAL(30,2),
    "remark" VARCHAR(2000),
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocean_freight_bill_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "container_batches_number_key" ON "container_batches"("container_batch_no");

-- CreateIndex
CREATE UNIQUE INDEX "container_batches_issuance_key" ON "container_batches"("numbering_issuance_id");

-- CreateIndex
CREATE INDEX "container_batches_date_id_idx" ON "container_batches"("loading_date" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "container_batches_source_file_idx" ON "container_batches"("source_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "container_batches_warehouse_date_sequence_key" ON "container_batches"("warehouse_value", "loading_date", "sequence_in_day");

-- CreateIndex
CREATE UNIQUE INDEX "container_batches_actor_request_key" ON "container_batches"("created_by_id", "creation_request_key");

-- CreateIndex
CREATE INDEX "container_loading_items_shipment_idx" ON "container_loading_items"("shipment_id");

-- CreateIndex
CREATE INDEX "container_loading_items_ocean_mark_idx" ON "container_loading_items"("ocean_shipping_mark_text");

-- CreateIndex
CREATE UNIQUE INDEX "container_loading_items_batch_line_key" ON "container_loading_items"("container_batch_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "container_loading_items_batch_request_key" ON "container_loading_items"("container_batch_id", "creation_request_key");

-- CreateIndex
CREATE UNIQUE INDEX "ocean_freight_bills_number_key" ON "ocean_freight_bills"("bill_no");

-- CreateIndex
CREATE UNIQUE INDEX "ocean_freight_bills_issuance_key" ON "ocean_freight_bills"("numbering_issuance_id");

-- CreateIndex
CREATE INDEX "ocean_freight_bills_created_id_idx" ON "ocean_freight_bills"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ocean_freight_bills_source_file_idx" ON "ocean_freight_bills"("source_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "ocean_freight_bills_actor_request_key" ON "ocean_freight_bills"("created_by_id", "creation_request_key");

-- CreateIndex
CREATE INDEX "ocean_freight_bill_lines_loading_item_idx" ON "ocean_freight_bill_lines"("loading_item_id");

-- CreateIndex
CREATE INDEX "ocean_freight_bill_lines_adjusts_idx" ON "ocean_freight_bill_lines"("adjusts_bill_line_id");

-- CreateIndex
CREATE INDEX "ocean_freight_bill_lines_status_idx" ON "ocean_freight_bill_lines"("bill_id", "reconciliation_status", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "ocean_freight_bill_lines_bill_line_key" ON "ocean_freight_bill_lines"("bill_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "ocean_freight_bill_lines_bill_request_key" ON "ocean_freight_bill_lines"("bill_id", "creation_request_key");

-- CreateIndex
CREATE INDEX "ocean_freight_bill_charges_line_idx" ON "ocean_freight_bill_charges"("bill_line_id");

-- AddForeignKey
ALTER TABLE "container_batches" ADD CONSTRAINT "container_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "container_batches" ADD CONSTRAINT "container_batches_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "container_batches" ADD CONSTRAINT "container_batches_numbering_issuance_id_fkey" FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "container_batches" ADD CONSTRAINT "container_batches_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "container_loading_items" ADD CONSTRAINT "container_loading_items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "container_loading_items" ADD CONSTRAINT "container_loading_items_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "container_loading_items" ADD CONSTRAINT "container_loading_items_container_batch_id_fkey" FOREIGN KEY ("container_batch_id") REFERENCES "container_batches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "container_loading_items" ADD CONSTRAINT "container_loading_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "purchase_order_parts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ocean_freight_bills" ADD CONSTRAINT "ocean_freight_bills_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ocean_freight_bills" ADD CONSTRAINT "ocean_freight_bills_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ocean_freight_bills" ADD CONSTRAINT "ocean_freight_bills_numbering_issuance_id_fkey" FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ocean_freight_bills" ADD CONSTRAINT "ocean_freight_bills_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ocean_freight_bill_lines" ADD CONSTRAINT "ocean_freight_bill_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "ocean_freight_bills"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ocean_freight_bill_lines" ADD CONSTRAINT "ocean_freight_bill_lines_loading_item_id_fkey" FOREIGN KEY ("loading_item_id") REFERENCES "container_loading_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ocean_freight_bill_lines" ADD CONSTRAINT "ocean_freight_bill_lines_adjusts_bill_line_id_fkey" FOREIGN KEY ("adjusts_bill_line_id") REFERENCES "ocean_freight_bill_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ocean_freight_bill_lines" ADD CONSTRAINT "ocean_freight_bill_lines_reconciled_by_id_fkey" FOREIGN KEY ("reconciled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ocean_freight_bill_charges" ADD CONSTRAINT "ocean_freight_bill_charges_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ocean_freight_bill_charges" ADD CONSTRAINT "ocean_freight_bill_charges_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ocean_freight_bill_charges" ADD CONSTRAINT "ocean_freight_bill_charges_bill_line_id_fkey" FOREIGN KEY ("bill_line_id") REFERENCES "ocean_freight_bill_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 草稿可保留缺值，已知数量和尺寸必须有效；金额结果允许负净返款。
ALTER TABLE container_batches
  ADD CONSTRAINT container_batches_values_check CHECK (
    version >= 1 AND sequence_in_day >= 1 AND btrim(container_batch_no) <> ''
    AND btrim(container_batch_name) <> '' AND btrim(warehouse_value) <> ''
    AND btrim(creation_request_key) <> '' AND creation_payload_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE container_loading_items
  ADD CONSTRAINT container_loading_items_values_check CHECK (
    version >= 1 AND line_number >= 1 AND package_count >= 1 AND btrim(goods_name) <> ''
    AND (gross_weight_kg IS NULL OR gross_weight_kg > 0)
    AND (length_cm IS NULL OR length_cm > 0) AND (width_cm IS NULL OR width_cm > 0)
    AND (height_cm IS NULL OR height_cm > 0) AND (volume_cai IS NULL OR volume_cai > 0)
    AND (chargeable_volume_cai IS NULL OR chargeable_volume_cai > 0)
    AND (reported_volume_cai IS NULL OR reported_volume_cai >= 0)
    AND (cod_amount_twd IS NULL OR cod_amount_twd >= 0)
    AND (source_row_number IS NULL OR source_row_number > 0)
    AND btrim(creation_request_key) <> '' AND creation_payload_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE ocean_freight_bills
  ADD CONSTRAINT ocean_freight_bills_values_check CHECK (
    version >= 1 AND twd_per_cny > 0 AND btrim(bill_no) <> '' AND btrim(bill_name) <> ''
    AND (cod_total_amount_twd IS NULL OR cod_total_amount_twd >= 0)
    AND btrim(creation_request_key) <> '' AND creation_payload_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE ocean_freight_bill_lines
  ADD CONSTRAINT ocean_freight_bill_lines_values_check CHECK (
    version >= 1 AND line_number >= 1 AND btrim(goods_name) <> ''
    AND (package_count IS NULL OR package_count >= 1)
    AND (gross_weight_kg IS NULL OR gross_weight_kg > 0)
    AND (length_cm IS NULL OR length_cm > 0) AND (width_cm IS NULL OR width_cm > 0)
    AND (height_cm IS NULL OR height_cm > 0) AND (volume_cai IS NULL OR volume_cai > 0)
    AND (chargeable_volume_cai IS NULL OR chargeable_volume_cai > 0)
    AND (reported_volume_cai IS NULL OR reported_volume_cai >= 0)
    AND (cod_amount_twd IS NULL OR cod_amount_twd >= 0)
    AND (source_row_number IS NULL OR source_row_number > 0)
    AND btrim(creation_request_key) <> '' AND creation_payload_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT ocean_freight_bill_lines_adjustment_check CHECK (
    adjusts_bill_line_id IS NULL OR (line_type = 'ADJUSTMENT' AND adjusts_bill_line_id <> id)),
  ADD CONSTRAINT ocean_freight_bill_lines_confirmation_check CHECK (
    (reconciliation_status = 'CONFIRMED' AND loading_item_id IS NOT NULL AND reconciled_by_id IS NOT NULL AND reconciled_at IS NOT NULL)
    OR (reconciliation_status <> 'CONFIRMED' AND reconciled_by_id IS NULL AND reconciled_at IS NULL));
ALTER TABLE ocean_freight_bill_charges
  ADD CONSTRAINT ocean_freight_bill_charges_values_check CHECK (
    amount >= 0 AND (chargeable_quantity IS NULL OR chargeable_quantity > 0)
    AND (unit_price_amount IS NULL OR unit_price_amount >= 0)),
  ADD CONSTRAINT ocean_freight_bill_charges_pricing_check CHECK (
    (pricing_basis = 'FIXED' AND chargeable_quantity IS NULL AND unit_price_amount IS NULL)
    OR (pricing_basis <> 'FIXED' AND chargeable_quantity IS NOT NULL AND unit_price_amount IS NOT NULL)),
  ADD CONSTRAINT ocean_freight_bill_charges_description_check CHECK (
    (charge_type <> 'OTHER' AND charge_nature = 'NORMAL') OR NULLIF(btrim(remark), '') IS NOT NULL);

-- PostgreSQL 部分唯一索引允许多次真实调整，但禁止跨账单重复正常计费。
CREATE UNIQUE INDEX ocean_freight_bill_lines_normal_loading_item_key
  ON ocean_freight_bill_lines (loading_item_id)
  WHERE line_type = 'NORMAL' AND loading_item_id IS NOT NULL;

-- 锁既有货件行来串行化分配，避免两个新柜次查询都发现“尚未分配”。
CREATE FUNCTION enforce_container_loading_shipment_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shipment_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.shipment_id IS NOT DISTINCT FROM OLD.shipment_id
      AND NEW.container_batch_id = OLD.container_batch_id THEN RETURN NEW; END IF;
  -- REPEATABLE READ 的旧快照在等待锁后仍看不到其他柜次已提交的分配；此命令不得使用该隔离级别。
  IF current_setting('transaction_isolation') = 'repeatable read' THEN
    RAISE EXCEPTION 'Shipment allocation requires read committed or serializable isolation'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_isolation_check';
  END IF;
  PERFORM id FROM purchase_order_parts WHERE id = NEW.shipment_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM container_loading_items WHERE shipment_id = NEW.shipment_id
      AND container_batch_id <> NEW.container_batch_id AND id <> NEW.id) THEN
    RAISE EXCEPTION 'Shipment cannot be split across container batches'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_shipment_same_batch_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER container_loading_items_shipment_batch_trigger
  BEFORE INSERT OR UPDATE OF shipment_id, container_batch_id ON container_loading_items
  FOR EACH ROW EXECUTE FUNCTION enforce_container_loading_shipment_batch();

-- 调整目标必须指向同一装柜货物，不能构造循环调整链；引用外键继续保护删除。
CREATE FUNCTION enforce_ocean_freight_adjustment_target() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_loading_id uuid;
BEGIN
  IF NEW.adjusts_bill_line_id IS NOT NULL THEN
    SELECT loading_item_id INTO target_loading_id FROM ocean_freight_bill_lines
      WHERE id = NEW.adjusts_bill_line_id FOR UPDATE;
    IF FOUND AND NEW.loading_item_id IS DISTINCT FROM target_loading_id THEN
      RAISE EXCEPTION 'Adjustment must reference the same loading item'
        USING ERRCODE = '23514', CONSTRAINT = 'ocean_freight_bill_lines_adjustment_target_check';
    END IF;
    IF EXISTS (WITH RECURSIVE ancestors AS (
      SELECT id, adjusts_bill_line_id FROM ocean_freight_bill_lines WHERE id = NEW.adjusts_bill_line_id
      UNION SELECT line.id, line.adjusts_bill_line_id FROM ocean_freight_bill_lines line
        JOIN ancestors ON line.id = ancestors.adjusts_bill_line_id
    ) SELECT 1 FROM ancestors WHERE id = NEW.id) THEN
      RAISE EXCEPTION 'Adjustment chain cannot contain cycles'
        USING ERRCODE = '23514', CONSTRAINT = 'ocean_freight_bill_lines_adjustment_cycle_check';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM ocean_freight_bill_lines WHERE adjusts_bill_line_id = NEW.id
      AND loading_item_id IS DISTINCT FROM NEW.loading_item_id) THEN
    RAISE EXCEPTION 'Referenced loading item cannot change while adjustments exist'
      USING ERRCODE = '23514', CONSTRAINT = 'ocean_freight_bill_lines_adjustment_target_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ocean_freight_bill_lines_adjustment_target_trigger
  BEFORE INSERT OR UPDATE OF adjusts_bill_line_id, loading_item_id ON ocean_freight_bill_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_ocean_freight_adjustment_target();

-- 新单据只能消费对应业务规则的内部派发结果，编号与关联记录不可分离。
CREATE FUNCTION enforce_ocean_freight_numbering_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_rule text; expected_consumer text; expected_number text;
BEGIN
  IF TG_TABLE_NAME = 'container_batches' THEN
    expected_rule := 'CONTAINER_BATCH_NO'; expected_consumer := 'CONTAINER_BATCH.CREATE';
    expected_number := NEW.container_batch_no;
  ELSE
    expected_rule := 'CTN_BILL_NO'; expected_consumer := 'OCEAN_FREIGHT_BILL.CREATE';
    expected_number := NEW.bill_no;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM numbering_issuances issuance JOIN numbering_rules rule ON rule.id = issuance.rule_id
      WHERE issuance.id = NEW.numbering_issuance_id AND issuance.generated_number = expected_number
      AND issuance.consumer_code = expected_consumer AND rule.rule_code = expected_rule AND rule.purpose = 'BUSINESS') THEN
    RAISE EXCEPTION 'Business document number must match its scoped issuance'
      USING ERRCODE = '23514', CONSTRAINT = 'ocean_freight_numbering_identity_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER container_batches_numbering_identity_trigger
  BEFORE INSERT OR UPDATE OF container_batch_no, numbering_issuance_id ON container_batches
  FOR EACH ROW EXECUTE FUNCTION enforce_ocean_freight_numbering_identity();
CREATE TRIGGER ocean_freight_bills_numbering_identity_trigger
  BEFORE INSERT OR UPDATE OF bill_no, numbering_issuance_id ON ocean_freight_bills
  FOR EACH ROW EXECUTE FUNCTION enforce_ocean_freight_numbering_identity();

-- PostgreSQL NUMERIC 会接受 NaN，显式拒绝非数值，避免绕过金额和尺寸正负范围。
ALTER TABLE "container_loading_items" ADD CONSTRAINT "container_loading_items_finite_check" CHECK (
  ("gross_weight_kg" IS NULL OR "gross_weight_kg" <> 'NaN'::numeric)
  AND ("length_cm" IS NULL OR "length_cm" <> 'NaN'::numeric)
  AND ("width_cm" IS NULL OR "width_cm" <> 'NaN'::numeric)
  AND ("height_cm" IS NULL OR "height_cm" <> 'NaN'::numeric)
  AND ("volume_cai" IS NULL OR "volume_cai" <> 'NaN'::numeric)
  AND ("reported_volume_cai" IS NULL OR "reported_volume_cai" <> 'NaN'::numeric)
  AND ("cod_amount_twd" IS NULL OR "cod_amount_twd" <> 'NaN'::numeric));
ALTER TABLE "ocean_freight_bills" ADD CONSTRAINT "ocean_freight_bills_finite_check" CHECK (
  ("twd_per_cny" IS NULL OR "twd_per_cny" <> 'NaN'::numeric)
  AND ("cod_total_amount_twd" IS NULL OR "cod_total_amount_twd" <> 'NaN'::numeric)
  AND ("charge_total_amount_twd" IS NULL OR "charge_total_amount_twd" <> 'NaN'::numeric)
  AND ("payable_amount_cny" IS NULL OR "payable_amount_cny" <> 'NaN'::numeric)
  AND ("return_amount_cny" IS NULL OR "return_amount_cny" <> 'NaN'::numeric)
  AND ("net_return_amount_cny" IS NULL OR "net_return_amount_cny" <> 'NaN'::numeric)
  AND ("reported_payable_amount_cny" IS NULL OR "reported_payable_amount_cny" <> 'NaN'::numeric)
  AND ("reported_return_amount_cny" IS NULL OR "reported_return_amount_cny" <> 'NaN'::numeric)
  AND ("reported_net_return_amount_cny" IS NULL OR "reported_net_return_amount_cny" <> 'NaN'::numeric)
  AND ("rounding_difference_cny" IS NULL OR "rounding_difference_cny" <> 'NaN'::numeric));
ALTER TABLE "ocean_freight_bill_lines" ADD CONSTRAINT "ocean_freight_bill_lines_finite_check" CHECK (
  ("gross_weight_kg" IS NULL OR "gross_weight_kg" <> 'NaN'::numeric)
  AND ("length_cm" IS NULL OR "length_cm" <> 'NaN'::numeric)
  AND ("width_cm" IS NULL OR "width_cm" <> 'NaN'::numeric)
  AND ("height_cm" IS NULL OR "height_cm" <> 'NaN'::numeric)
  AND ("volume_cai" IS NULL OR "volume_cai" <> 'NaN'::numeric)
  AND ("reported_volume_cai" IS NULL OR "reported_volume_cai" <> 'NaN'::numeric)
  AND ("cod_amount_twd" IS NULL OR "cod_amount_twd" <> 'NaN'::numeric)
  AND ("charge_total_amount_twd" IS NULL OR "charge_total_amount_twd" <> 'NaN'::numeric)
  AND ("payable_amount_cny" IS NULL OR "payable_amount_cny" <> 'NaN'::numeric)
  AND ("return_amount_cny" IS NULL OR "return_amount_cny" <> 'NaN'::numeric)
  AND ("net_return_amount_cny" IS NULL OR "net_return_amount_cny" <> 'NaN'::numeric));
ALTER TABLE "ocean_freight_bill_charges" ADD CONSTRAINT "ocean_freight_bill_charges_finite_check" CHECK (
  ("amount" IS NULL OR "amount" <> 'NaN'::numeric)
  AND ("chargeable_quantity" IS NULL OR "chargeable_quantity" <> 'NaN'::numeric)
  AND ("unit_price_amount" IS NULL OR "unit_price_amount" <> 'NaN'::numeric)
  AND ("reported_amount" IS NULL OR "reported_amount" <> 'NaN'::numeric));

COMMIT;
