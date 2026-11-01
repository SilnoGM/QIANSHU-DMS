BEGIN;

-- 调货申请：运营提交后锁定寄仓记录，采运审核通过后执行现有认领事务。
CREATE TYPE "shipment_storage_claim_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'SHIPMENT_STORAGE_CLAIM_REQUESTED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'SHIPMENT_STORAGE_CLAIM_REQUEST_WITHDRAWN';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'SHIPMENT_STORAGE_CLAIM_REQUEST_REJECTED';

CREATE TABLE "shipment_storage_claim_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "storage_record_id" UUID NOT NULL,
  "applicant_user_id" UUID NOT NULL,
  "sales_order_id" UUID NOT NULL,
  "sales_order_no_snapshot" VARCHAR(64) NOT NULL,
  "cost_total_cny" DECIMAL(30,2) NOT NULL,
  "allocations" JSONB NOT NULL,
  "status" "shipment_storage_claim_request_status" NOT NULL DEFAULT 'PENDING',
  "reject_reason" VARCHAR(500),
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "request_key" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipment_storage_claim_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipment_storage_claim_requests_cost_check" CHECK ("cost_total_cny" >= 0),
  CONSTRAINT "shipment_storage_claim_requests_reject_reason_check" CHECK (
    "status" <> 'REJECTED' OR ("reject_reason" IS NOT NULL AND "reject_reason" ~ '[^[:space:]]')
  )
);

ALTER TABLE "shipment_storage_claim_requests"
  ADD CONSTRAINT "shipment_storage_claim_requests_storage_record_id_fkey"
  FOREIGN KEY ("storage_record_id") REFERENCES "shipment_storage_records"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "shipment_storage_claim_requests_pending_record_key"
  ON "shipment_storage_claim_requests" ("storage_record_id")
  WHERE "status" = 'PENDING';
CREATE INDEX "shipment_storage_claim_requests_record_status_idx"
  ON "shipment_storage_claim_requests" ("storage_record_id", "status");
CREATE INDEX "shipment_storage_claim_requests_status_created_idx"
  ON "shipment_storage_claim_requests" ("status", "created_at" DESC, "id" DESC);
CREATE UNIQUE INDEX "shipment_storage_claim_requests_applicant_request_key"
  ON "shipment_storage_claim_requests" ("applicant_user_id", "request_key");

-- 运营申请/撤回权限；审核与直接认领继续使用 shipment-storage:claim。
INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES (
  '00000000-0000-4000-8000-000000000187',
  'shipment-storage:claim-request',
  '申请调货',
  '提交和撤回寄仓货件的调货申请',
  false
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission ON permission."code" = 'shipment-storage:claim-request'
WHERE role."code" IN ('system_admin', 'operations_staff')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "permissions"
    WHERE "code" = 'shipment-storage:claim-request'
      AND "system_only" = false
  ) THEN
    RAISE EXCEPTION 'shipment-storage:claim-request permission is missing'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_claim_request_permission_check';
  END IF;
END $$;

COMMIT;
