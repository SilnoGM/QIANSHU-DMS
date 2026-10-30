-- 认领映射从「目标销售行 + 数量」升级为「库存分配行 + 目标销售行 + 数量」。
-- 历史认领没有来源分配行，列保持 NULL 以兼容既有覆盖计算；新认领必须写入来源。
CREATE TYPE "shipment_claim_product_match_mode" AS ENUM ('AUTO', 'MANUAL_OVERRIDE');

ALTER TABLE "shipment_claim_lines"
  ADD COLUMN "purchase_order_line_id" UUID,
  ADD COLUMN "product_match_mode" "shipment_claim_product_match_mode",
  ADD COLUMN "product_match_note" VARCHAR(500);

ALTER TABLE "shipment_claim_lines"
  ADD CONSTRAINT "shipment_claim_lines_purchase_order_line_id_fkey"
    FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 同一库存分配行可拆到多条目标销售行；同一目标行也可接收多条来源分配行。
DROP INDEX "shipment_claim_lines_record_line_key";
CREATE UNIQUE INDEX "shipment_claim_lines_record_source_target_key"
  ON "shipment_claim_lines" ("storage_record_id", "purchase_order_line_id", "sales_order_line_id");

ALTER TABLE "shipment_claim_lines"
  ADD CONSTRAINT "shipment_claim_lines_product_match_note_check"
  CHECK (
    "product_match_mode" IS DISTINCT FROM 'MANUAL_OVERRIDE'::"shipment_claim_product_match_mode"
    OR ("product_match_note" IS NOT NULL AND btrim("product_match_note") <> '')
  );
