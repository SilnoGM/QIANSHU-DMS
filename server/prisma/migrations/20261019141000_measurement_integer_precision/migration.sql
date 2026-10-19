BEGIN;

-- 重量与尺寸改为整数存储：
-- - 重量按 ROUND HALF_UP 收敛到 kg 整数；
-- - 尺寸按 CEIL 向上取整到 cm 整数。
--
-- 历史 volume_cai / chargeable_volume_cai 不在本迁移内重算。它们是已经参与
-- 账单与计费的历史事实，重算会改变历史依据；新写入行由应用层按整数尺寸重新计算。
-- 原始来源仍保留在 source_data JSON 中，必要时可据此出差异报告。
ALTER TABLE container_loading_items
  ALTER COLUMN gross_weight_kg TYPE NUMERIC(18,0) USING ROUND(gross_weight_kg, 0),
  ALTER COLUMN length_cm TYPE NUMERIC(18,0) USING CEIL(length_cm),
  ALTER COLUMN width_cm TYPE NUMERIC(18,0) USING CEIL(width_cm),
  ALTER COLUMN height_cm TYPE NUMERIC(18,0) USING CEIL(height_cm);

ALTER TABLE slh_bill_lines
  ALTER COLUMN gross_weight_kg TYPE NUMERIC(18,0) USING ROUND(gross_weight_kg, 0),
  ALTER COLUMN length_cm TYPE NUMERIC(18,0) USING CEIL(length_cm),
  ALTER COLUMN width_cm TYPE NUMERIC(18,0) USING CEIL(width_cm),
  ALTER COLUMN height_cm TYPE NUMERIC(18,0) USING CEIL(height_cm);

COMMIT;
