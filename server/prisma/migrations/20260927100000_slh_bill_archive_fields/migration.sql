-- 账单归档信息：入库确认弹窗填写的名称、账单月份与备注。
--
-- 名称与月份必填。名称的唯一性只约束「未被取代的账单」，这样修正重传可以沿用原名；
-- Prisma schema 表达不了带 WHERE 的唯一索引，因此它以部分索引形式只存在于本迁移
-- （与 sales_receipt_requests_original_voucher_key 同样的做法）。
--
-- 结构与约束必须完整提交；失败时不留下半应用状态。
BEGIN;

-- 1) 先加可空列并回填，使迁移在已有账单的库上也能执行；空库时回填 0 行。
ALTER TABLE slh_bills
  ADD COLUMN "bill_name" VARCHAR(200),
  ADD COLUMN "bill_month" CHAR(7),
  ADD COLUMN "remark" VARCHAR(500);

UPDATE slh_bills SET
  bill_name = COALESCE(NULLIF(regexp_replace(source_file_name, '\.[^.]+$', ''), ''), slh_bill_no),
  bill_month = to_char(period_end, 'YYYY-MM')
WHERE bill_name IS NULL;

-- 2) 收敛为必填。
ALTER TABLE slh_bills
  ALTER COLUMN "bill_name" SET NOT NULL,
  ALTER COLUMN "bill_month" SET NOT NULL;

ALTER TABLE slh_bills
  ADD CONSTRAINT slh_bills_bill_name_check CHECK (bill_name = btrim(bill_name) AND btrim(bill_name) <> ''),
  ADD CONSTRAINT slh_bills_bill_month_check CHECK (bill_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT slh_bills_remark_check CHECK (remark IS NULL OR btrim(remark) <> '');

-- 3) 名称在未被取代的账单之间唯一。
CREATE UNIQUE INDEX "slh_bills_active_name_key" ON "slh_bills" ("bill_name") WHERE superseded_by_id IS NULL;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'slh_bills'
      AND column_name IN ('bill_name', 'bill_month', 'remark')
  ) <> 3 THEN
    RAISE EXCEPTION 'SLH bill archive columns incomplete' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'slh_bills' AND indexname = 'slh_bills_active_name_key'
  ) THEN
    RAISE EXCEPTION 'SLH bill active name index missing' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
