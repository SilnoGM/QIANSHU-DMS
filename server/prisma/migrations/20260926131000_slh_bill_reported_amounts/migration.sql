-- 账单自报值留痕：「合计应付人民币」行金额、台币单元格原值与公式原文。
-- 结构与约束必须完整提交；失败时不留下半应用状态。
BEGIN;

ALTER TABLE "slh_bills"
  ADD COLUMN "reported_payable_amount_cny" DECIMAL(30,2),
  ADD COLUMN "reported_net_amount_cell" VARCHAR(64),
  ADD COLUMN "reported_net_amount_formula" VARCHAR(128);

-- 单元格原值与公式原文要么都缺（对方没写），要么至少留下原值，避免只存一半造成误读。
ALTER TABLE slh_bills ADD CONSTRAINT slh_bills_reported_net_check CHECK (
  (reported_net_amount_cell IS NULL AND reported_net_amount_formula IS NULL)
  OR reported_net_amount_cell IS NOT NULL
);

DO $$
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'slh_bills'
      AND column_name IN ('reported_payable_amount_cny', 'reported_net_amount_cell', 'reported_net_amount_formula')
  ) <> 3 THEN
    RAISE EXCEPTION 'SLH bill reported amount columns incomplete' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
