BEGIN;

-- 采购来源只授予既有 PURCHASE_PAYMENT 类型，不改类型开关、用户比例或已发布规则。
-- 同码来源已存在时主动失败，避免覆盖管理员已有配置。
INSERT INTO fund_business_sources (id, code, name, description, enabled, version)
VALUES (gen_random_uuid(), 'PURCHASE_PAYMENT', '采购付款', '采购应付款确认及作废专用来源', true, 1);

INSERT INTO fund_business_source_posting_types (business_source_id, posting_type_id)
SELECT source.id, posting_type.id
FROM fund_business_sources source
CROSS JOIN fund_posting_types posting_type
WHERE source.code = 'PURCHASE_PAYMENT' AND posting_type.code = 'PURCHASE_PAYMENT';

-- 备货沿用真实分摊规则版本，以有效用户比例 0%、公司比例 100% 产生唯一公司分录。
-- 比例必须保留用于原批次冲正；仅该来源的受控备货及作废批次允许无用户的比例快照。
ALTER TABLE fund_posting_batches DROP CONSTRAINT fund_posting_batches_share_snapshot_check;
ALTER TABLE fund_posting_batches ADD CONSTRAINT fund_posting_batches_share_snapshot_check CHECK (
  (user_id IS NULL AND user_share_rate_snapshot IS NULL AND company_share_rate_snapshot IS NULL)
  OR (user_id IS NOT NULL AND user_share_rate_snapshot BETWEEN 0 AND 100
    AND company_share_rate_snapshot BETWEEN 0 AND 100
    AND user_share_rate_snapshot + company_share_rate_snapshot = 100)
  OR (business_source_code_snapshot IS NOT DISTINCT FROM 'PURCHASE_PAYMENT' AND posting_type_code_snapshot = 'PURCHASE_PAYMENT'
    AND user_id IS NULL AND user_share_rate_snapshot IS NOT NULL AND company_share_rate_snapshot IS NOT NULL
    AND user_share_rate_snapshot = 0 AND company_share_rate_snapshot = 100
    AND ((kind = 'BUSINESS' AND consumer_code = 'PURCHASE_PAYMENT.STOCK_PAY')
      OR (kind = 'REVERSAL' AND consumer_code = 'PURCHASE_PAYMENT.VOID')))
);

-- 业务记录与资金批次的双向一致性由采购应付迁移补充；资金层先关闭其他 consumer、
-- 负向采购、缺少归属和伪造公司快照入口，禁止泛化到其他 source 或 posting type。
ALTER TABLE fund_posting_batches ADD CONSTRAINT fund_posting_batches_purchase_payment_shape_check CHECK (
  business_source_code_snapshot IS DISTINCT FROM 'PURCHASE_PAYMENT'
  OR (posting_type_code_snapshot = 'PURCHASE_PAYMENT' AND business_category_snapshot = 'COST'
    AND actor_user_id IS NOT NULL
    AND user_share_rate_snapshot IS NOT NULL AND company_share_rate_snapshot IS NOT NULL
    AND ((user_id IS NOT NULL AND user_share_rate_snapshot BETWEEN 0 AND 100
          AND company_share_rate_snapshot BETWEEN 0 AND 100
          AND user_share_rate_snapshot + company_share_rate_snapshot = 100)
      OR (user_id IS NULL AND user_share_rate_snapshot = 0 AND company_share_rate_snapshot = 100))
    AND ((kind = 'BUSINESS' AND business_amount > 0
          AND ((consumer_code = 'PURCHASE_PAYMENT.PAY' AND user_id IS NOT NULL)
            OR (consumer_code = 'PURCHASE_PAYMENT.STOCK_PAY' AND user_id IS NULL)))
      OR (kind = 'REVERSAL' AND business_amount < 0 AND consumer_code = 'PURCHASE_PAYMENT.VOID')))
);

DO $$
BEGIN
  IF (SELECT count(*) FROM fund_business_sources WHERE code = 'PURCHASE_PAYMENT' AND enabled AND version = 1) <> 1
    OR (SELECT count(*) FROM fund_business_source_posting_types binding
        JOIN fund_business_sources source ON source.id = binding.business_source_id
        WHERE source.code = 'PURCHASE_PAYMENT') <> 1
    OR NOT EXISTS (
      SELECT 1 FROM fund_business_source_posting_types binding
      JOIN fund_business_sources source ON source.id = binding.business_source_id
      JOIN fund_posting_types posting_type ON posting_type.id = binding.posting_type_id
      WHERE source.code = 'PURCHASE_PAYMENT' AND posting_type.code = 'PURCHASE_PAYMENT'
    )
  THEN
    RAISE EXCEPTION 'purchase payment fund source verification failed';
  END IF;
END;
$$;

COMMIT;
