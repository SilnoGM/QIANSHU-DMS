BEGIN;

-- 顺联航账单对账批次完成时逐笔入账，两个动作语义不同，因此需要一个新的业务类型：
-- 结算沿用 ORDER_SETTLEMENT（收入、可正可负、跟随金额符号），金流费用是成本、必须大于 0，
-- 按用户当前分成比例从用户与公司账户同时扣除。类型与规则在此固定，不做运行时补建。
INSERT INTO "fund_posting_types" (
  "id",
  "code",
  "name",
  "description",
  "business_category",
  "requires_user",
  "amount_sign_policy",
  "input_mode",
  "enabled",
  "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002210',
  'FULL_FLOW_PAYMENT_FEE',
  '全流程金流费用',
  '顺联航账单对账完成时按用户当前分成比例从用户与公司账户扣除',
  'COST',
  true,
  'POSITIVE_ONLY',
  'STANDARD',
  true,
  1
);

-- 规则版本按业务路径同样的顺序落库：先建 DRAFT（分录只允许挂在草稿版本下），
-- 插入两条分录后再发布为 ACTIVE，最后才把它设为当前版本。
INSERT INTO "fund_posting_rule_versions" (
  "id",
  "posting_type_id",
  "revision",
  "status"
)
VALUES (
  '00000000-0000-4000-8000-000000002310',
  '00000000-0000-4000-8000-000000002210',
  1,
  'DRAFT'
);

INSERT INTO "fund_posting_rule_legs" (
  "id",
  "rule_version_id",
  "position",
  "account_target",
  "direction_policy",
  "amount_strategy",
  "adjustment_mode"
)
VALUES
  ('00000000-0000-4000-8000-000000002418', '00000000-0000-4000-8000-000000002310', 1, 'USER', 'DEBIT', 'USER_SHARE', NULL),
  ('00000000-0000-4000-8000-000000002419', '00000000-0000-4000-8000-000000002310', 2, 'COMPANY', 'DEBIT', 'COMPANY_REMAINDER', NULL);

UPDATE "fund_posting_rule_versions"
SET "status" = 'ACTIVE', "published_at" = CURRENT_TIMESTAMP
WHERE "id" = '00000000-0000-4000-8000-000000002310';

UPDATE "fund_posting_types"
SET "current_rule_version_id" = '00000000-0000-4000-8000-000000002310'
WHERE "id" = '00000000-0000-4000-8000-000000002210';

-- 来源只授予「订单结算 + 全流程金流费用」两个类型；同码来源或同码类型已存在时由唯一约束拒绝。
INSERT INTO "fund_business_sources" (
  "id",
  "code",
  "name",
  "description",
  "enabled",
  "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002102',
  'SLH_BILL_FINANCE_SETTLEMENT',
  '顺联航账单财务结算',
  '顺联航账单对账批次完成时按最新有效核对结果逐笔入账的专用来源',
  true,
  1
);

INSERT INTO "fund_business_source_posting_types" ("business_source_id", "posting_type_id")
SELECT source."id", posting_type."id"
FROM "fund_business_sources" AS source
CROSS JOIN "fund_posting_types" AS posting_type
WHERE source."code" = 'SLH_BILL_FINANCE_SETTLEMENT'
  AND posting_type."code" IN ('ORDER_SETTLEMENT', 'FULL_FLOW_PAYMENT_FEE');

-- 两个 consumer 的形状在此封闭：结算可正可负但必须归属到出单人，金流费用恒为正；
-- 缺归属、缺比例快照、伪造其他类型/consumer 或直接写批次都会被数据库拒绝。
ALTER TABLE "fund_posting_batches" ADD CONSTRAINT "fund_posting_batches_slh_bill_settlement_shape_check" CHECK (
  "business_source_code_snapshot" IS DISTINCT FROM 'SLH_BILL_FINANCE_SETTLEMENT'
  OR (
    "kind" = 'BUSINESS'
    AND "actor_user_id" IS NOT NULL
    AND "user_id" IS NOT NULL
    AND "user_share_rate_snapshot" IS NOT NULL
    AND "company_share_rate_snapshot" IS NOT NULL
    AND "user_share_rate_snapshot" BETWEEN 0 AND 100
    AND "company_share_rate_snapshot" BETWEEN 0 AND 100
    AND "user_share_rate_snapshot" + "company_share_rate_snapshot" = 100
    AND (
      (
        "consumer_code" = 'SLH_BILL_FINANCE_SETTLEMENT.RECONCILE'
        AND "posting_type_code_snapshot" = 'ORDER_SETTLEMENT'
        AND "business_category_snapshot" = 'REVENUE'
      )
      OR (
        "consumer_code" = 'SLH_BILL_FINANCE_SETTLEMENT.FEE'
        AND "posting_type_code_snapshot" = 'FULL_FLOW_PAYMENT_FEE'
        AND "business_category_snapshot" = 'COST'
        AND "business_amount" > 0
      )
    )
  )
);

-- 迁移不创建资金批次、流水或历史入账；断言本次新增的类型、规则、来源与绑定精确成形。
DO $$
BEGIN
  IF (
    SELECT count(*) FROM "fund_posting_types"
    WHERE "code" = 'FULL_FLOW_PAYMENT_FEE'
      AND "name" = '全流程金流费用'
      AND "business_category" = 'COST'
      AND "requires_user"
      AND "amount_sign_policy" = 'POSITIVE_ONLY'
      AND "input_mode" = 'STANDARD'
      AND "enabled"
      AND "current_rule_version_id" = '00000000-0000-4000-8000-000000002310'::uuid
  ) <> 1
    OR (
      SELECT count(*) FROM "fund_posting_rule_versions" AS rule
      JOIN "fund_posting_types" AS posting_type ON posting_type."id" = rule."posting_type_id"
      WHERE posting_type."code" = 'FULL_FLOW_PAYMENT_FEE'
        AND rule."revision" = 1
        AND rule."status" = 'ACTIVE'
        AND rule."published_at" IS NOT NULL
    ) <> 1
    OR (
      SELECT count(*) FROM "fund_posting_rule_legs" AS leg
      JOIN "fund_posting_rule_versions" AS rule ON rule."id" = leg."rule_version_id"
      JOIN "fund_posting_types" AS posting_type ON posting_type."id" = rule."posting_type_id"
      WHERE posting_type."code" = 'FULL_FLOW_PAYMENT_FEE'
        AND leg."adjustment_mode" IS NULL
        AND (
          (leg."position" = 1 AND leg."account_target" = 'USER'
            AND leg."direction_policy" = 'DEBIT' AND leg."amount_strategy" = 'USER_SHARE')
          OR (leg."position" = 2 AND leg."account_target" = 'COMPANY'
            AND leg."direction_policy" = 'DEBIT' AND leg."amount_strategy" = 'COMPANY_REMAINDER')
        )
    ) <> 2
    OR (
      SELECT count(*) FROM "fund_business_sources"
      WHERE "code" = 'SLH_BILL_FINANCE_SETTLEMENT'
        AND "name" = '顺联航账单财务结算'
        AND "enabled"
        AND "version" = 1
    ) <> 1
    OR (
      SELECT count(*) FROM "fund_business_source_posting_types" AS binding
      JOIN "fund_business_sources" AS source ON source."id" = binding."business_source_id"
      JOIN "fund_posting_types" AS posting_type ON posting_type."id" = binding."posting_type_id"
      WHERE source."code" = 'SLH_BILL_FINANCE_SETTLEMENT'
        AND posting_type."code" IN ('ORDER_SETTLEMENT', 'FULL_FLOW_PAYMENT_FEE')
    ) <> 2
    OR EXISTS (
      SELECT 1 FROM "fund_business_source_posting_types" AS binding
      JOIN "fund_business_sources" AS source ON source."id" = binding."business_source_id"
      JOIN "fund_posting_types" AS posting_type ON posting_type."id" = binding."posting_type_id"
      WHERE source."code" = 'SLH_BILL_FINANCE_SETTLEMENT'
        AND posting_type."code" NOT IN ('ORDER_SETTLEMENT', 'FULL_FLOW_PAYMENT_FEE')
    )
  THEN
    RAISE EXCEPTION 'slh bill finance settlement fund source verification failed';
  END IF;
END;
$$;

COMMIT;
