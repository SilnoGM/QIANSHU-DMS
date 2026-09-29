-- 账单对比所需的自报值留痕：小计行三值，以及确认入库时看到的差异/告警快照。
-- 结构与约束必须完整提交；失败时不留下半应用状态。
BEGIN;

ALTER TABLE "slh_bills"
  ADD COLUMN "reported_subtotal_payable_amount_cny" DECIMAL(30,2),
  ADD COLUMN "reported_subtotal_cod_amount_twd" DECIMAL(30,2),
  ADD COLUMN "reported_subtotal_ntd_surcharge_amount_twd" DECIMAL(30,2),
  ADD COLUMN "import_findings" JSONB NOT NULL;

-- 小计三值是「账单自己写的行」与「明细累加」对比的另一端，要么三列都留下，要么都缺。
ALTER TABLE slh_bills ADD CONSTRAINT slh_bills_reported_subtotal_check CHECK (
  (reported_subtotal_payable_amount_cny IS NULL
    AND reported_subtotal_cod_amount_twd IS NULL
    AND reported_subtotal_ntd_surcharge_amount_twd IS NULL)
  OR (reported_subtotal_payable_amount_cny IS NOT NULL
    AND reported_subtotal_cod_amount_twd IS NOT NULL
    AND reported_subtotal_ntd_surcharge_amount_twd IS NOT NULL)
);

-- 快照必须是数组：详情页按类型分组渲染，形状错了要在写入时就拦住。
ALTER TABLE slh_bills ADD CONSTRAINT slh_bills_import_findings_check CHECK (
  jsonb_typeof(import_findings) = 'array'
);

DO $$
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'slh_bills'
      AND column_name IN ('reported_subtotal_payable_amount_cny', 'reported_subtotal_cod_amount_twd', 'reported_subtotal_ntd_surcharge_amount_twd', 'import_findings')
  ) <> 4 THEN
    RAISE EXCEPTION 'SLH bill comparison columns incomplete' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
