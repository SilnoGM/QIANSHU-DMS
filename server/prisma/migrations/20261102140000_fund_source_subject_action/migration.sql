BEGIN;

-- 列表主行需要「主体 · 动作」两个可拆分的零件：headline 是一整句话，
-- 前端拿它做主行时只能硬拆字符串。这里补两列结构化字段，headline 保持不变，
-- 继续作为详情卡与运营端的整句兜底。
--
-- 两列都可空：历史行由回填命令按已有 headline 拆解补齐，不重写 headline，
-- 因此「历史保留旧名」的口径不会被破坏。
ALTER TABLE "fund_posting_batch_sources"
  ADD COLUMN "subject_name" VARCHAR(128),
  ADD COLUMN "action_label" VARCHAR(120);

ALTER TABLE "fund_posting_batch_sources"
  ADD CONSTRAINT "fund_posting_batch_sources_subject_name_nonblank_check"
  CHECK ("subject_name" IS NULL OR "subject_name" !~ '^[[:space:]]*$');

ALTER TABLE "fund_posting_batch_sources"
  ADD CONSTRAINT "fund_posting_batch_sources_action_label_nonblank_check"
  CHECK ("action_label" IS NULL OR "action_label" !~ '^[[:space:]]*$');

-- MigrationSelfCheck
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'fund_posting_batch_sources'
      AND "column_name" IN ('subject_name', 'action_label')
    GROUP BY "table_name"
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'fund_posting_batch_sources must have subject_name and action_label';
  END IF;

  -- 现有行必须保持 headline/来源分类不变，本迁移只加列。
  IF EXISTS (
    SELECT 1
    FROM "fund_posting_batch_sources"
    WHERE "subject_name" IS NOT NULL OR "action_label" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'subject_name and action_label must start empty';
  END IF;
END;
$$;

COMMIT;
