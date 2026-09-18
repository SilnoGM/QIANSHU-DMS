BEGIN;

-- 来源仅供打木架付款事务使用；既有同码配置让唯一约束拒绝迁移，禁止静默覆盖。
INSERT INTO fund_business_sources (id, code, name, description, enabled, version)
VALUES (
  gen_random_uuid(),
  'PACKAGING_COST',
  '打木架付款',
  '打木架费用提报确认付款专用来源',
  true,
  1
);

-- 包装费用类型由现有业务配置维护。仅绑定已有类型，不补建类型、不启用类型或改写规则。
-- 新环境若尚未配置该类型，保留零绑定，由管理员配置后才能付款。
INSERT INTO fund_business_source_posting_types (business_source_id, posting_type_id)
SELECT source.id, posting_type.id
FROM fund_business_sources source
CROSS JOIN fund_posting_types posting_type
WHERE source.code = 'PACKAGING_COST'
  AND posting_type.code = 'WOODEN_PACKING_COST';

-- 迁移不创建资金批次、流水或历史付款；断言本次新增来源只获得目标类型授权。
DO $$
BEGIN
  IF (SELECT count(*) FROM fund_business_sources
      WHERE code = 'PACKAGING_COST' AND name = '打木架付款' AND enabled AND version = 1) <> 1
    OR (SELECT count(*) FROM fund_business_source_posting_types binding
        JOIN fund_business_sources source ON source.id = binding.business_source_id
        WHERE source.code = 'PACKAGING_COST')
      <> (SELECT count(*) FROM fund_posting_types WHERE code = 'WOODEN_PACKING_COST')
    OR EXISTS (
      SELECT 1 FROM fund_business_source_posting_types binding
      JOIN fund_business_sources source ON source.id = binding.business_source_id
      JOIN fund_posting_types posting_type ON posting_type.id = binding.posting_type_id
      WHERE source.code = 'PACKAGING_COST' AND posting_type.code <> 'WOODEN_PACKING_COST'
    )
  THEN
    RAISE EXCEPTION 'packaging cost fund source verification failed';
  END IF;
END;
$$;

COMMIT;
