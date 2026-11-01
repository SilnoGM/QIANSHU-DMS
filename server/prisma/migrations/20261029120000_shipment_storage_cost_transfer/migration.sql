BEGIN;

-- 寄仓成本转移固定两个业务类型：释放时按原出单人比例把成本退回与原出单人和公司；
-- 认领时按新出单人比例向新出单人和公司收回成本。两跳都不建池账户，净额与设计表一致。
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
VALUES
  (
    '00000000-0000-4000-8000-000000002250',
    'SHIPMENT_STORAGE_RELEASE',
    '寄仓成本转出',
    '货件释放进寄仓时按原出单人比例退回原出单人与公司',
    'COST',
    true,
    'POSITIVE_ONLY',
    'STANDARD',
    true,
    1
  ),
  (
    '00000000-0000-4000-8000-000000002251',
    'SHIPMENT_STORAGE_CLAIM',
    '寄仓成本转入',
    '寄仓货件被认领时按新出单人比例向新出单人与公司收回成本',
    'COST',
    true,
    'POSITIVE_ONLY',
    'STANDARD',
    true,
    1
  );

-- 规则版本先建草稿，插入分录后再发布并设为当前版本。
INSERT INTO "fund_posting_rule_versions" ("id", "posting_type_id", "revision", "status")
VALUES
  ('00000000-0000-4000-8000-000000002260', '00000000-0000-4000-8000-000000002250', 1, 'DRAFT'),
  ('00000000-0000-4000-8000-000000002270', '00000000-0000-4000-8000-000000002251', 1, 'DRAFT');

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
  ('00000000-0000-4000-8000-000000002261', '00000000-0000-4000-8000-000000002260', 1, 'USER', 'CREDIT', 'USER_SHARE', NULL),
  ('00000000-0000-4000-8000-000000002262', '00000000-0000-4000-8000-000000002260', 2, 'COMPANY', 'CREDIT', 'COMPANY_REMAINDER', NULL),
  ('00000000-0000-4000-8000-000000002271', '00000000-0000-4000-8000-000000002270', 1, 'USER', 'DEBIT', 'USER_SHARE', NULL),
  ('00000000-0000-4000-8000-000000002272', '00000000-0000-4000-8000-000000002270', 2, 'COMPANY', 'DEBIT', 'COMPANY_REMAINDER', NULL);

UPDATE "fund_posting_rule_versions"
SET "status" = 'ACTIVE', "published_at" = CURRENT_TIMESTAMP
WHERE "id" IN (
  '00000000-0000-4000-8000-000000002260',
  '00000000-0000-4000-8000-000000002270'
);

UPDATE "fund_posting_types"
SET "current_rule_version_id" = '00000000-0000-4000-8000-000000002260'
WHERE "id" = '00000000-0000-4000-8000-000000002250';

UPDATE "fund_posting_types"
SET "current_rule_version_id" = '00000000-0000-4000-8000-000000002270'
WHERE "id" = '00000000-0000-4000-8000-000000002251';

INSERT INTO "fund_business_sources" (
  "id",
  "code",
  "name",
  "description",
  "enabled",
  "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002252',
  'SHIPMENT_STORAGE',
  '寄仓成本转移',
  '货件释放与认领时的成本责任重分类专用来源',
  true,
  1
);

INSERT INTO "fund_business_source_posting_types" ("business_source_id", "posting_type_id")
SELECT source."id", posting_type."id"
FROM "fund_business_sources" AS source
CROSS JOIN "fund_posting_types" AS posting_type
WHERE source."code" = 'SHIPMENT_STORAGE'
  AND posting_type."code" IN ('SHIPMENT_STORAGE_RELEASE', 'SHIPMENT_STORAGE_CLAIM');

-- 两个 consumer 的形状在此封闭：金额恒为正、必须归属到出单人、比例快照完整，
-- 且 consumer 与 posting type 必须一一对应，不能伪造其他类型。
ALTER TABLE "fund_posting_batches" ADD CONSTRAINT "fund_posting_batches_shipment_storage_shape_check" CHECK (
  "business_source_code_snapshot" IS DISTINCT FROM 'SHIPMENT_STORAGE'
  OR (
    "kind" = 'BUSINESS'
    AND "actor_user_id" IS NOT NULL
    AND "user_id" IS NOT NULL
    AND "user_share_rate_snapshot" IS NOT NULL
    AND "company_share_rate_snapshot" IS NOT NULL
    AND "user_share_rate_snapshot" BETWEEN 0 AND 100
    AND "company_share_rate_snapshot" BETWEEN 0 AND 100
    AND "user_share_rate_snapshot" + "company_share_rate_snapshot" = 100
    AND "business_amount" > 0
    AND (
      (
        "consumer_code" = 'SHIPMENT_STORAGE.RELEASE'
        AND "posting_type_code_snapshot" = 'SHIPMENT_STORAGE_RELEASE'
      )
      OR (
        "consumer_code" = 'SHIPMENT_STORAGE.CLAIM'
        AND "posting_type_code_snapshot" = 'SHIPMENT_STORAGE_CLAIM'
      )
    )
  )
);

-- 迁移不创建资金批次、流水或成本事件；断言类型、规则、来源与绑定精确成形。
DO $$
BEGIN
  IF (SELECT count(*) FROM "fund_posting_types"
      WHERE "code" IN ('SHIPMENT_STORAGE_RELEASE', 'SHIPMENT_STORAGE_CLAIM')
        AND "business_category" = 'COST' AND "requires_user" AND "enabled") <> 2
    OR (SELECT count(*) FROM "fund_posting_types" type
        JOIN "fund_posting_rule_versions" rule ON rule."id" = type."current_rule_version_id"
        WHERE type."code" IN ('SHIPMENT_STORAGE_RELEASE', 'SHIPMENT_STORAGE_CLAIM')
          AND rule."status" = 'ACTIVE') <> 2
    OR (SELECT count(*) FROM "fund_posting_rule_legs" leg
        JOIN "fund_posting_rule_versions" rule ON rule."id" = leg."rule_version_id"
        WHERE rule."id" IN (
          '00000000-0000-4000-8000-000000002260',
          '00000000-0000-4000-8000-000000002270'
        )) <> 4
    OR (SELECT count(*) FROM "fund_business_sources"
        WHERE "code" = 'SHIPMENT_STORAGE' AND "enabled") <> 1
    OR (SELECT count(*) FROM "fund_business_source_posting_types" binding
        JOIN "fund_business_sources" source ON source."id" = binding."business_source_id"
        WHERE source."code" = 'SHIPMENT_STORAGE') <> 2
  THEN
    RAISE EXCEPTION 'shipment storage cost transfer configuration is incomplete'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_storage_cost_transfer_check';
  END IF;
END $$;

COMMIT;
