BEGIN;

-- 行间调价可能保持采购总额、定金和尾款完全不变（例如两行单价互换修正）。
-- 原 changed_check 只允许订单级四金额变化，会拒绝这类真实修订；新增行级快照后，
-- 即使四个订单金额相同也能留下可审计的变更证据。旧行默认空数组，不修改历史金额。
ALTER TABLE "purchase_order_amount_revisions"
  ADD COLUMN "line_changes" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "purchase_order_amount_revisions"
  DROP CONSTRAINT "purchase_order_amount_revisions_changed_check";

ALTER TABLE "purchase_order_amount_revisions"
  ADD CONSTRAINT "purchase_order_amount_revisions_changed_check" CHECK (
    ROW(
      "old_line_subtotal_amount",
      "old_purchase_total_amount",
      "old_deposit_due_amount",
      "old_balance_due_amount"
    ) IS DISTINCT FROM ROW(
      "new_line_subtotal_amount",
      "new_purchase_total_amount",
      "new_deposit_due_amount",
      "new_balance_due_amount"
    )
    OR (
      CASE
        WHEN jsonb_typeof("line_changes") = 'array'
          THEN jsonb_array_length("line_changes") > 0
        ELSE false
      END
    )
  );

ALTER TABLE "purchase_order_amount_revisions"
  ADD CONSTRAINT "purchase_order_amount_revisions_line_changes_check"
  CHECK (jsonb_typeof("line_changes") = 'array');

-- MigrationSelfCheck
DO $$
DECLARE
  actual_type text;
  actual_nullable text;
  changed_definition text;
BEGIN
  SELECT data_type, is_nullable
  INTO actual_type, actual_nullable
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'purchase_order_amount_revisions'
    AND column_name = 'line_changes';

  IF actual_type IS DISTINCT FROM 'jsonb' OR actual_nullable IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'purchase amount revision line changes migration invariant mismatch: column';
  END IF;

  SELECT pg_get_constraintdef(constraint_entry.oid)
  INTO changed_definition
  FROM pg_constraint AS constraint_entry
  WHERE constraint_entry.conname = 'purchase_order_amount_revisions_changed_check'
    AND constraint_entry.conrelid = 'purchase_order_amount_revisions'::regclass;

  IF changed_definition IS NULL OR position('line_changes' IN changed_definition) = 0 THEN
    RAISE EXCEPTION 'purchase amount revision line changes migration invariant mismatch: changed check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_entry
    WHERE constraint_entry.conname = 'purchase_order_amount_revisions_line_changes_check'
      AND constraint_entry.conrelid = 'purchase_order_amount_revisions'::regclass
  ) THEN
    RAISE EXCEPTION 'purchase amount revision line changes migration invariant mismatch: line changes check';
  END IF;
END;
$$;

COMMIT;
