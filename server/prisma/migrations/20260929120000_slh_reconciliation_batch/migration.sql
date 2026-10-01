-- 顺联航账单对账批次：新增批次表、批次成员行表与匹配来源枚举，并接入编号身份校验。
--
-- 边界：本迁移只新增两张表与一个枚举，不修改 slh_bills / slh_bill_lines 的结构，
-- 也不改动 enforce_slh_bill_identity 与 enforce_slh_bill_evidence_immutable 两个既有触发器。
-- 批次成员行冻结匹配依据（matched_loading_item_id）与本批次的核对时刻；明细行自身的
-- reconciled_at 仍是账单三态的唯一来源。结构与约束必须完整提交；失败时不留下半应用状态。
BEGIN;

-- CreateEnum
CREATE TYPE "slh_bill_line_match_source" AS ENUM ('NAME', 'MARK');

-- CreateTable
CREATE TABLE "slh_reconciliation_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_no" VARCHAR(64) NOT NULL,
    "numbering_issuance_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "completed_by_id" UUID,
    "creation_request_key_hash" BYTEA NOT NULL,
    "creation_payload_hash" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slh_reconciliation_batches_pkey" PRIMARY KEY ("id"),
    -- 结束是「本次对账收工」这一动作：时刻与操作人必须同时存在或同时为空。
    CONSTRAINT "slh_reconciliation_batches_completion_check" CHECK (("completed_at" IS NULL) = ("completed_by_id" IS NULL)),
    CONSTRAINT "slh_reconciliation_batches_version_check" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "slh_reconciliation_batch_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "matched_loading_item_id" UUID NOT NULL,
    "match_source" "slh_bill_line_match_source" NOT NULL,
    "reconciled_at" TIMESTAMPTZ(6),
    "reconciled_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slh_reconciliation_batch_lines_pkey" PRIMARY KEY ("id"),
    -- 成员行的核对留痕同样成对出现；本表是追加型，核对时刻只由「确认核对」写入一次。
    CONSTRAINT "slh_reconciliation_batch_lines_reconciled_check" CHECK (("reconciled_at" IS NULL) = ("reconciled_by_id" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "slh_reconciliation_batches_number_key" ON "slh_reconciliation_batches"("batch_no");

-- CreateIndex
CREATE UNIQUE INDEX "slh_reconciliation_batches_issuance_key" ON "slh_reconciliation_batches"("numbering_issuance_id");

-- CreateIndex
CREATE INDEX "slh_reconciliation_batches_bill_completed_idx" ON "slh_reconciliation_batches"("bill_id", "completed_at");

-- CreateIndex
CREATE INDEX "slh_reconciliation_batches_created_id_idx" ON "slh_reconciliation_batches"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "slh_reconciliation_batches_actor_request_key" ON "slh_reconciliation_batches"("created_by_id", "creation_request_key_hash");

-- CreateIndex
CREATE INDEX "slh_reconciliation_batch_lines_line_idx" ON "slh_reconciliation_batch_lines"("line_id");

-- CreateIndex
CREATE INDEX "slh_reconciliation_batch_lines_loading_item_idx" ON "slh_reconciliation_batch_lines"("matched_loading_item_id");

-- CreateIndex
CREATE INDEX "slh_reconciliation_batch_lines_batch_reconciled_idx" ON "slh_reconciliation_batch_lines"("batch_id", "reconciled_at");

-- CreateIndex
CREATE UNIQUE INDEX "slh_reconciliation_batch_lines_batch_line_key" ON "slh_reconciliation_batch_lines"("batch_id", "line_id");

-- AddForeignKey
ALTER TABLE "slh_reconciliation_batches" ADD CONSTRAINT "slh_reconciliation_batches_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "slh_bills"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_reconciliation_batches" ADD CONSTRAINT "slh_reconciliation_batches_numbering_issuance_id_fkey" FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_reconciliation_batches" ADD CONSTRAINT "slh_reconciliation_batches_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_reconciliation_batches" ADD CONSTRAINT "slh_reconciliation_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_reconciliation_batches" ADD CONSTRAINT "slh_reconciliation_batches_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_reconciliation_batch_lines" ADD CONSTRAINT "slh_reconciliation_batch_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "slh_reconciliation_batches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_reconciliation_batch_lines" ADD CONSTRAINT "slh_reconciliation_batch_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "slh_bill_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_reconciliation_batch_lines" ADD CONSTRAINT "slh_reconciliation_batch_lines_matched_loading_item_id_fkey" FOREIGN KEY ("matched_loading_item_id") REFERENCES "container_loading_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slh_reconciliation_batch_lines" ADD CONSTRAINT "slh_reconciliation_batch_lines_reconciled_by_id_fkey" FOREIGN KEY ("reconciled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 编号身份兜底：批次编号必须来自 SLH_RECON_BATCH_NO 的派发台账，应用不得自行拼装。
CREATE FUNCTION enforce_slh_reconciliation_batch_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM numbering_issuances issuance
    JOIN numbering_rules rule ON rule.id = issuance.rule_id
    WHERE issuance.id = NEW.numbering_issuance_id
      AND issuance.generated_number = NEW.batch_no
      AND issuance.consumer_code = 'SLH_RECON_BATCH.CREATE'
      AND rule.rule_code = 'SLH_RECON_BATCH_NO'
      AND rule.purpose = 'BUSINESS'
  ) THEN
    RAISE EXCEPTION 'SLH reconciliation batch number must match its scoped issuance' USING ERRCODE = '23514', CONSTRAINT = 'slh_reconciliation_batches_number_identity_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER slh_reconciliation_batches_identity_trigger BEFORE INSERT ON slh_reconciliation_batches
FOR EACH ROW EXECUTE FUNCTION enforce_slh_reconciliation_batch_identity();

COMMIT;
