BEGIN;

-- 开票申请的结算成本入账：接入既有的「开发票费用」业务类型（INVOICE_FEE，成本、必须大于 0、
-- 按用户当前分成比例从用户与公司账户同时扣除），因此只需要新建专用来源并把该类型授给来源。
-- 类型与规则在 foundation 迁移里已经固化，本迁移不创建类型、不创建批次与流水。
INSERT INTO "fund_business_sources" (
  "id",
  "code",
  "name",
  "description",
  "enabled",
  "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002103',
  'INVOICE_REQUEST',
  '开票申请',
  '开票申请结算入账的专用来源：开票服务费与邮寄费按申请人分成比例扣除',
  true,
  1
);

INSERT INTO "fund_business_source_posting_types" ("business_source_id", "posting_type_id")
SELECT source."id", posting_type."id"
FROM "fund_business_sources" AS source
CROSS JOIN "fund_posting_types" AS posting_type
WHERE source."code" = 'INVOICE_REQUEST'
  AND posting_type."code" = 'INVOICE_FEE';

-- consumer 的形状在此封闭：必须是成本、必须归属到申请人、必须有比例快照且金额为正；
-- 伪造其他类型/consumer、缺归属或直接写批次都会被数据库拒绝。
ALTER TABLE "fund_posting_batches" ADD CONSTRAINT "fund_posting_batches_invoice_request_shape_check" CHECK (
  "business_source_code_snapshot" IS DISTINCT FROM 'INVOICE_REQUEST'
  OR (
    "kind" = 'BUSINESS'
    AND "actor_user_id" IS NOT NULL
    AND "user_id" IS NOT NULL
    AND "user_share_rate_snapshot" IS NOT NULL
    AND "company_share_rate_snapshot" IS NOT NULL
    AND "user_share_rate_snapshot" BETWEEN 0 AND 100
    AND "company_share_rate_snapshot" BETWEEN 0 AND 100
    AND "user_share_rate_snapshot" + "company_share_rate_snapshot" = 100
    AND "consumer_code" = 'INVOICE_REQUEST.SETTLE'
    AND "posting_type_code_snapshot" = 'INVOICE_FEE'
    AND "business_category_snapshot" = 'COST'
    AND "business_amount" > 0
  )
);

-- 断言本次新增的来源与绑定精确成形，且 INVOICE_FEE 未被授给其他来源。
DO $$
BEGIN
  IF (
    SELECT count(*) FROM "fund_business_sources"
    WHERE "id" = '00000000-0000-4000-8000-000000002103'::uuid
      AND "code" = 'INVOICE_REQUEST'
      AND "name" = '开票申请'
      AND "enabled"
      AND "version" = 1
  ) <> 1
    OR (
      SELECT count(*) FROM "fund_business_source_posting_types" AS binding
      JOIN "fund_business_sources" AS source ON source."id" = binding."business_source_id"
      JOIN "fund_posting_types" AS posting_type ON posting_type."id" = binding."posting_type_id"
      WHERE source."code" = 'INVOICE_REQUEST'
        AND posting_type."code" = 'INVOICE_FEE'
    ) <> 1
    OR EXISTS (
      SELECT 1 FROM "fund_business_source_posting_types" AS binding
      JOIN "fund_business_sources" AS source ON source."id" = binding."business_source_id"
      JOIN "fund_posting_types" AS posting_type ON posting_type."id" = binding."posting_type_id"
      WHERE source."code" = 'INVOICE_REQUEST'
        AND posting_type."code" <> 'INVOICE_FEE'
    )
    OR (
      SELECT count(*) FROM "fund_posting_types"
      WHERE "code" = 'INVOICE_FEE'
        AND "business_category" = 'COST'
        AND "requires_user"
        AND "amount_sign_policy" = 'POSITIVE_ONLY'
        AND "input_mode" = 'STANDARD'
        AND "enabled"
    ) <> 1
    OR (
      SELECT count(*) FROM "fund_business_source_posting_types" AS binding
      JOIN "fund_posting_types" AS posting_type ON posting_type."id" = binding."posting_type_id"
      WHERE posting_type."code" = 'INVOICE_FEE'
        AND binding."business_source_id" <> '00000000-0000-4000-8000-000000002103'::uuid
    ) <> 0
  THEN
    RAISE EXCEPTION 'invoice request fund source verification failed';
  END IF;
END;
$$;

COMMIT;
