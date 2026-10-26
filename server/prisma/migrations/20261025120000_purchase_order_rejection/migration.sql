BEGIN;

-- 采购审核驳回：状态仍复用 CANCELLED，以驳回元数据与手工取消区分。
ALTER TABLE "purchase_orders"
  ADD COLUMN "rejected_at" TIMESTAMPTZ(6),
  ADD COLUMN "rejected_by_user_id" UUID,
  ADD COLUMN "rejection_reason" VARCHAR(500);

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_rejection_shape_check" CHECK (
    ("rejected_at" IS NULL AND "rejected_by_user_id" IS NULL AND "rejection_reason" IS NULL)
    OR (
      "rejected_at" IS NOT NULL
      AND "rejected_by_user_id" IS NOT NULL
      AND "rejection_reason" IS NOT NULL
      AND "rejection_reason" ~ '[^[:space:]]'
    )
  ),
  ADD CONSTRAINT "purchase_orders_rejected_status_check" CHECK (
    "rejected_at" IS NULL OR "order_status" = 'CANCELLED'
  );

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_rejected_by_user_id_fkey"
  FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "purchase_orders_rejected_order_date_idx"
  ON "purchase_orders" ("rejected_at", "order_date" DESC, "id" DESC)
  WHERE "rejected_at" IS NOT NULL;

ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_REJECTED';

COMMIT;
