BEGIN;

-- 认领/调货时收回的成本就是「调货成本」：寄仓记录上冻结的采购成本与包装成本随货件
-- 调给新出单人，不是寄仓本身产生的新成本。转出方向保持不变——它的触发是取消/拒收回收
-- 货件进寄仓，与调货无关。
--
-- 只改展示名与描述，code、规则版本与分摊方式都不动；历史批次保留动账时的名称快照，
-- 因此旧流水仍显示「寄仓成本转入」，这是有意为之。
UPDATE "fund_posting_types"
SET
  "name" = '调货成本转入',
  "description" = '寄仓货件被认领（调货）时按新出单人比例向新出单人与公司收回成本',
  "version" = "version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'SHIPMENT_STORAGE_CLAIM';

-- MigrationSelfCheck
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "fund_posting_types"
    WHERE "code" = 'SHIPMENT_STORAGE_CLAIM'
      AND "name" = '调货成本转入'
  ) THEN
    RAISE EXCEPTION 'SHIPMENT_STORAGE_CLAIM must be renamed to 调货成本转入';
  END IF;

  -- 转出方向不在本次改名范围内，防止误伤。
  IF NOT EXISTS (
    SELECT 1
    FROM "fund_posting_types"
    WHERE "code" = 'SHIPMENT_STORAGE_RELEASE'
      AND "name" = '寄仓成本转出'
  ) THEN
    RAISE EXCEPTION 'SHIPMENT_STORAGE_RELEASE name must stay unchanged';
  END IF;

  -- 历史批次快照必须保持原样：如果这里已经变了，说明改了不该改的事实表。
  IF EXISTS (
    SELECT 1
    FROM "fund_posting_batches"
    WHERE "posting_type_code_snapshot" = 'SHIPMENT_STORAGE_CLAIM'
      AND "posting_type_name_snapshot" = '调货成本转入'
  ) THEN
    RAISE EXCEPTION 'historical posting type name snapshots must stay immutable';
  END IF;
END;
$$;

COMMIT;
