-- 账单明细的金额列改为可空：空单元格表示「本行不涉及此项」，与装柜明细（container_loading_items）
-- 同一口径。来源表格里「空」与「显式 0」是两种写法——空表示本行不涉及该项，0 表示该项为零；
-- 解析器过去把空单元格写成 0.00，两种写法被合并，无法再区分。这里只放宽 NOT NULL，
-- 不修改任何既有数据（既有 0.00 保持不变），不改动任何触发器，也不影响账单头的合计列。
--
-- 费用勾稽 payable = freight + cod_handling + surcharge 在四列都有值时强制；
-- 任一列为空（不涉及）时不校验。SQL 三值逻辑本来就会放行这种情形，这里显式写出来，
-- 避免后来人把它误认成漏校验。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

LOCK TABLE "slh_bill_lines" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "slh_bill_lines"
  ALTER COLUMN "freight_amount_cny" DROP NOT NULL,
  ALTER COLUMN "cod_handling_amount_cny" DROP NOT NULL,
  ALTER COLUMN "surcharge_amount_cny" DROP NOT NULL,
  ALTER COLUMN "payable_amount_cny" DROP NOT NULL,
  ALTER COLUMN "cod_amount_twd" DROP NOT NULL,
  ALTER COLUMN "ntd_surcharge_amount_twd" DROP NOT NULL;

ALTER TABLE "slh_bill_lines" DROP CONSTRAINT "slh_bill_lines_amount_check";

ALTER TABLE "slh_bill_lines"
  ADD CONSTRAINT "slh_bill_lines_amount_check" CHECK (
    line_number > 0 AND package_count > 0
    AND (freight_amount_cny IS NULL OR freight_amount_cny >= 0)
    AND (cod_handling_amount_cny IS NULL OR cod_handling_amount_cny >= 0)
    AND (surcharge_amount_cny IS NULL OR surcharge_amount_cny >= 0)
    AND (payable_amount_cny IS NULL OR payable_amount_cny >= 0)
    AND (cod_amount_twd IS NULL OR cod_amount_twd >= 0)
    AND (ntd_surcharge_amount_twd IS NULL OR ntd_surcharge_amount_twd >= 0)
    -- 四列都有值时才校验勾稽；任一列为空即「本行不涉及该项」，跳过。
    AND (
      freight_amount_cny IS NULL OR cod_handling_amount_cny IS NULL OR surcharge_amount_cny IS NULL OR payable_amount_cny IS NULL
      OR payable_amount_cny = freight_amount_cny + cod_handling_amount_cny + surcharge_amount_cny
    )
  );

-- 复查：六列必须都可空，且勾稽约束仍在（按 regclass 解析关系，不写死 public）。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute AS "attribute"
    WHERE "attribute"."attrelid" = 'slh_bill_lines'::regclass
      AND "attribute"."attname" IN (
        'freight_amount_cny', 'cod_handling_amount_cny', 'surcharge_amount_cny',
        'payable_amount_cny', 'cod_amount_twd', 'ntd_surcharge_amount_twd'
      )
      AND "attribute"."attnotnull"
  ) THEN
    RAISE EXCEPTION 'SLH bill line amount columns must accept NULL after this migration'
      USING ERRCODE = '23514', CONSTRAINT = 'slh_bill_lines_amount_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS "constraint"
    WHERE "constraint"."conrelid" = 'slh_bill_lines'::regclass
      AND "constraint"."conname" = 'slh_bill_lines_amount_check'
  ) THEN
    RAISE EXCEPTION 'SLH bill line amount check is missing after this migration'
      USING ERRCODE = '23514', CONSTRAINT = 'slh_bill_lines_amount_check';
  END IF;
END;
$$;

COMMIT;
