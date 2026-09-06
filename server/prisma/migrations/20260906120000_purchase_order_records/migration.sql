BEGIN;

-- 整体替换枚举，使新值与约束在同一事务生效，不改写已有凭证和业务金额。
LOCK TABLE "purchase_order_documents" IN ACCESS EXCLUSIVE MODE;
CREATE TYPE "purchase_order_document_type_next" AS ENUM (
  'PAYMENT_VOUCHER', 'ORDER_ISSUANCE_VOUCHER', 'DELIVERY_RECEIPT'
);
ALTER TABLE "purchase_order_documents"
  DROP CONSTRAINT "purchase_order_documents_payment_shape_check",
  ALTER COLUMN "payment_id" DROP NOT NULL,
  ALTER COLUMN "document_type" TYPE "purchase_order_document_type_next"
    USING "document_type"::text::"purchase_order_document_type_next";
DROP TYPE "purchase_order_document_type";
ALTER TYPE "purchase_order_document_type_next" RENAME TO "purchase_order_document_type";
ALTER TABLE "purchase_order_documents"
  ADD CONSTRAINT "purchase_order_documents_payment_shape_check" CHECK (
    ("document_type" = 'PAYMENT_VOUCHER' AND "payment_id" IS NOT NULL)
    OR ("document_type" IN ('ORDER_ISSUANCE_VOUCHER', 'DELIVERY_RECEIPT') AND "payment_id" IS NULL)
  );

-- 既有付款凭证的有效 payment_id 唯一索引继续生效；NULL 不互斥，签收单可有多张。
CREATE UNIQUE INDEX "purchase_order_documents_active_issuance_key"
  ON "purchase_order_documents" ("purchase_order_id")
  WHERE "detached_at" IS NULL AND "document_type" = 'ORDER_ISSUANCE_VOUCHER';

CREATE TABLE "purchase_order_amount_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_order_id" UUID NOT NULL,
  "old_line_subtotal_amount" DECIMAL(30,4) NOT NULL,
  "old_purchase_total_amount" DECIMAL(30,4) NOT NULL,
  "old_deposit_due_amount" DECIMAL(30,4) NOT NULL,
  "old_balance_due_amount" DECIMAL(30,4) NOT NULL,
  "new_line_subtotal_amount" DECIMAL(30,4) NOT NULL,
  "new_purchase_total_amount" DECIMAL(30,4) NOT NULL,
  "new_deposit_due_amount" DECIMAL(30,4) NOT NULL,
  "new_balance_due_amount" DECIMAL(30,4) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "changed_by_user_id" UUID NOT NULL,
  "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_order_amount_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_amount_revisions_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id")
    REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "purchase_order_amount_revisions_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "purchase_order_amount_revisions_reason_check" CHECK ("reason" !~ '^[[:space:]]*$'),
  CONSTRAINT "purchase_order_amount_revisions_changed_check" CHECK (
    ROW("old_line_subtotal_amount", "old_purchase_total_amount", "old_deposit_due_amount", "old_balance_due_amount")
      IS DISTINCT FROM
    ROW("new_line_subtotal_amount", "new_purchase_total_amount", "new_deposit_due_amount", "new_balance_due_amount")
  ),
  CONSTRAINT "purchase_order_amount_revisions_amounts_check" CHECK (
    "old_deposit_due_amount" >= 0 AND "old_balance_due_amount" >= 0
    AND "new_deposit_due_amount" >= 0 AND "new_balance_due_amount" >= 0
    AND "old_purchase_total_amount" < 'Infinity'::numeric
    AND "new_purchase_total_amount" < 'Infinity'::numeric
    AND "old_purchase_total_amount" = "old_line_subtotal_amount"
    AND "new_purchase_total_amount" = "new_line_subtotal_amount"
    AND "old_purchase_total_amount" = "old_deposit_due_amount" + "old_balance_due_amount"
    AND "new_purchase_total_amount" = "new_deposit_due_amount" + "new_balance_due_amount"
  )
);
CREATE INDEX "purchase_order_amount_revisions_order_changed_idx"
  ON "purchase_order_amount_revisions" ("purchase_order_id", "changed_at" DESC, "id" DESC);

-- 与销售金额历史一致：一旦归档，不允许修改或删除旧快照。
CREATE FUNCTION "enforce_purchase_order_amount_revision_immutable"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514',
    CONSTRAINT = 'purchase_order_amount_revision_immutable_check',
    MESSAGE = 'purchase order amount revision rows are immutable';
END;
$$;
CREATE TRIGGER "purchase_order_amount_revisions_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "purchase_order_amount_revisions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_amount_revision_immutable"();

COMMIT;
