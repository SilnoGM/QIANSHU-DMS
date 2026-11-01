-- 公司承担的金流费是成本，不能用收入性质的“公司分摊”类型；单独一条 COST 规则。
INSERT INTO "fund_posting_types" (
  "id", "code", "name", "description", "business_category", "requires_user",
  "amount_sign_policy", "input_mode", "enabled", "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002221',
  'SLH_BILL_COMPANY_FEE_ALLOCATION',
  '顺联航账单公司金流费分摊',
  '顺联航账单金流费中财务指定由公司账户承担的成本',
  'COST',
  false,
  'POSITIVE_ONLY',
  'STANDARD',
  true,
  1
)
ON CONFLICT DO NOTHING;

INSERT INTO "fund_posting_rule_versions" (
  "id", "posting_type_id", "revision", "status"
)
VALUES (
  '00000000-0000-4000-8000-000000002321',
  '00000000-0000-4000-8000-000000002221',
  1,
  'DRAFT'
)
ON CONFLICT DO NOTHING;

-- 兼容重跑：已有类型/规则时先把规则恢复为草稿，才能写分录。
UPDATE "fund_posting_types"
SET "current_rule_version_id" = NULL
WHERE "id" = '00000000-0000-4000-8000-000000002221';

UPDATE "fund_posting_rule_versions"
SET "status" = 'DRAFT', "published_at" = NULL
WHERE "id" = '00000000-0000-4000-8000-000000002321';

INSERT INTO "fund_posting_rule_legs" (
  "id", "rule_version_id", "position", "account_target",
  "direction_policy", "amount_strategy", "adjustment_mode"
)
VALUES (
  '00000000-0000-4000-8000-000000002421',
  '00000000-0000-4000-8000-000000002321',
  1,
  'COMPANY',
  'DEBIT',
  'FULL_AMOUNT',
  NULL
)
ON CONFLICT DO NOTHING;

UPDATE "fund_posting_rule_versions"
SET "status" = 'ACTIVE', "published_at" = CURRENT_TIMESTAMP
WHERE "id" = '00000000-0000-4000-8000-000000002321';

UPDATE "fund_posting_types"
SET "current_rule_version_id" = '00000000-0000-4000-8000-000000002321'
WHERE "id" = '00000000-0000-4000-8000-000000002221';

INSERT INTO "fund_business_sources" (
  "id", "code", "name", "description", "enabled", "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002123',
  'SLH_BILL_FINANCE_SETTLEMENT_COMPANY_FEE',
  '顺联航账单公司金流费分摊',
  '顺联航账单结算中由公司账户承担的金流费',
  true,
  1
)
ON CONFLICT DO NOTHING;

INSERT INTO "fund_business_source_posting_types" ("business_source_id", "posting_type_id")
VALUES (
  '00000000-0000-4000-8000-000000002123',
  '00000000-0000-4000-8000-000000002221'
)
ON CONFLICT DO NOTHING;

ALTER TABLE "fund_posting_batches"
  DROP CONSTRAINT IF EXISTS "fund_posting_batches_company_fee_settlement_shape_check";

ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_company_fee_settlement_shape_check"
  CHECK (
    "business_source_code_snapshot" IS DISTINCT FROM 'SLH_BILL_FINANCE_SETTLEMENT_COMPANY_FEE'
    OR (
      "kind" = 'BUSINESS'
      AND "actor_user_id" IS NOT NULL
      AND "user_id" IS NULL
      AND "user_share_rate_snapshot" IS NULL
      AND "company_share_rate_snapshot" IS NULL
      AND "posting_type_code_snapshot" = 'SLH_BILL_COMPANY_FEE_ALLOCATION'
      AND "business_category_snapshot" = 'COST'
    )
  );
