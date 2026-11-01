-- 结算分摊增加费用快照；同时引入港口费和公司入账目标所需的资金类型。
ALTER TYPE "slh_bill_charge_type" ADD VALUE IF NOT EXISTS 'PORT_FEE';

ALTER TABLE "slh_reconciliation_settlements"
  ADD COLUMN IF NOT EXISTS "allocation_snapshot" JSONB;

INSERT INTO "fund_posting_types" (
  "id", "code", "name", "description", "business_category", "requires_user",
  "amount_sign_policy", "input_mode", "enabled", "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002220',
  'SLH_BILL_COMPANY_ALLOCATION',
  '顺联航账单公司分摊',
  '顺联航账单分摊中财务指定由公司账户承担或收取的金额',
  'REVENUE',
  false,
  'NON_ZERO_SIGNED',
  'STANDARD',
  true,
  1
)
ON CONFLICT DO NOTHING;

INSERT INTO "fund_posting_rule_versions" (
  "id", "posting_type_id", "revision", "status"
)
VALUES (
  '00000000-0000-4000-8000-000000002320',
  '00000000-0000-4000-8000-000000002220',
  1,
  'DRAFT'
)
ON CONFLICT DO NOTHING;

-- 兼容重跑：已有类型/规则时先把规则恢复为草稿，才能写分录。
UPDATE "fund_posting_types"
SET "current_rule_version_id" = NULL
WHERE "id" = '00000000-0000-4000-8000-000000002220';

UPDATE "fund_posting_rule_versions"
SET "status" = 'DRAFT', "published_at" = NULL
WHERE "id" = '00000000-0000-4000-8000-000000002320';

INSERT INTO "fund_posting_rule_legs" (
  "id", "rule_version_id", "position", "account_target",
  "direction_policy", "amount_strategy", "adjustment_mode"
)
VALUES (
  '00000000-0000-4000-8000-000000002420',
  '00000000-0000-4000-8000-000000002320',
  1,
  'COMPANY',
  'FOLLOW_AMOUNT_SIGN',
  'FULL_AMOUNT',
  NULL
)
ON CONFLICT DO NOTHING;

UPDATE "fund_posting_rule_versions"
SET "status" = 'ACTIVE', "published_at" = CURRENT_TIMESTAMP
WHERE "id" = '00000000-0000-4000-8000-000000002320';

UPDATE "fund_posting_types"
SET "current_rule_version_id" = '00000000-0000-4000-8000-000000002320'
WHERE "id" = '00000000-0000-4000-8000-000000002220';

INSERT INTO "fund_business_sources" (
  "id", "code", "name", "description", "enabled", "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002122',
  'SLH_BILL_FINANCE_SETTLEMENT_COMPANY',
  '顺联航账单公司分摊',
  '顺联航账单结算中由财务指定到公司账户的分摊',
  true,
  1
)
ON CONFLICT DO NOTHING;

INSERT INTO "fund_business_source_posting_types" ("business_source_id", "posting_type_id")
VALUES (
  '00000000-0000-4000-8000-000000002122',
  '00000000-0000-4000-8000-000000002220'
)
ON CONFLICT DO NOTHING;

ALTER TABLE "fund_posting_batches"
  DROP CONSTRAINT IF EXISTS "fund_posting_batches_company_settlement_shape_check";

ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_company_settlement_shape_check"
  CHECK (
    "business_source_code_snapshot" IS DISTINCT FROM 'SLH_BILL_FINANCE_SETTLEMENT_COMPANY'
    OR (
      "kind" = 'BUSINESS'
      AND "actor_user_id" IS NOT NULL
      AND "user_id" IS NULL
      AND "user_share_rate_snapshot" IS NULL
      AND "company_share_rate_snapshot" IS NULL
      AND "posting_type_code_snapshot" = 'SLH_BILL_COMPANY_ALLOCATION'
      AND "business_category_snapshot" = 'REVENUE'
    )
  );
