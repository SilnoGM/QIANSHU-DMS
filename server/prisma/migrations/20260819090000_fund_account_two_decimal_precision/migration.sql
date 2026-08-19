BEGIN;

-- NarrowFundPrecisionFailClosed
-- 资金流水是不可变审计事实。收窄列精度前必须证明所有历史值都能无损表示为
-- 两位小数；发现第三位及以后非零值时整笔 migration 失败，禁止静默舍入。
DO $$
DECLARE
  violating_count BIGINT;
BEGIN
  SELECT count(*) INTO violating_count
  FROM "fund_accounts"
  WHERE "balance" <> round("balance", 2);
  IF violating_count > 0 THEN
    RAISE EXCEPTION
      'fund precision migration rejected: fund_accounts.balance has % non-lossless rows',
      violating_count
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violating_count
  FROM "fund_accounts"
  WHERE "user_share_rate" IS NOT NULL
    AND "user_share_rate" <> round("user_share_rate", 2);
  IF violating_count > 0 THEN
    RAISE EXCEPTION
      'fund precision migration rejected: fund_accounts.user_share_rate has % non-lossless rows',
      violating_count
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violating_count
  FROM "fund_posting_batches"
  WHERE "business_amount" <> round("business_amount", 2);
  IF violating_count > 0 THEN
    RAISE EXCEPTION
      'fund precision migration rejected: fund_posting_batches.business_amount has % non-lossless rows',
      violating_count
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violating_count
  FROM "fund_posting_batches"
  WHERE "user_share_rate_snapshot" IS NOT NULL
    AND "user_share_rate_snapshot" <> round("user_share_rate_snapshot", 2);
  IF violating_count > 0 THEN
    RAISE EXCEPTION
      'fund precision migration rejected: fund_posting_batches.user_share_rate_snapshot has % non-lossless rows',
      violating_count
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violating_count
  FROM "fund_posting_batches"
  WHERE "company_share_rate_snapshot" IS NOT NULL
    AND "company_share_rate_snapshot" <> round("company_share_rate_snapshot", 2);
  IF violating_count > 0 THEN
    RAISE EXCEPTION
      'fund precision migration rejected: fund_posting_batches.company_share_rate_snapshot has % non-lossless rows',
      violating_count
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violating_count
  FROM "fund_ledger_entries"
  WHERE "amount" <> round("amount", 2);
  IF violating_count > 0 THEN
    RAISE EXCEPTION
      'fund precision migration rejected: fund_ledger_entries.amount has % non-lossless rows',
      violating_count
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violating_count
  FROM "fund_ledger_entries"
  WHERE "balance_before" <> round("balance_before", 2);
  IF violating_count > 0 THEN
    RAISE EXCEPTION
      'fund precision migration rejected: fund_ledger_entries.balance_before has % non-lossless rows',
      violating_count
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violating_count
  FROM "fund_ledger_entries"
  WHERE "balance_after" <> round("balance_after", 2);
  IF violating_count > 0 THEN
    RAISE EXCEPTION
      'fund precision migration rejected: fund_ledger_entries.balance_after has % non-lossless rows',
      violating_count
      USING ERRCODE = '23514';
  END IF;
END
$$;

-- Recreate constraints that depend on the narrowed numeric columns explicitly. This keeps
-- their stable names and avoids relying on PostgreSQL implicit constraint rewrites.
ALTER TABLE "fund_accounts"
  DROP CONSTRAINT "fund_accounts_balance_scale_check",
  DROP CONSTRAINT "fund_accounts_user_share_rate_range_check";

ALTER TABLE "fund_posting_batches"
  DROP CONSTRAINT "fund_posting_batches_business_amount_nonzero_check",
  DROP CONSTRAINT "fund_posting_batches_share_snapshot_check";

ALTER TABLE "fund_ledger_entries"
  DROP CONSTRAINT "fund_ledger_entries_amount_positive_check",
  DROP CONSTRAINT "fund_ledger_entries_balance_equation_check";

ALTER TABLE "fund_accounts"
  ALTER COLUMN "balance" TYPE NUMERIC(30, 2) USING "balance",
  ALTER COLUMN "user_share_rate" TYPE NUMERIC(7, 2) USING "user_share_rate";

ALTER TABLE "fund_posting_batches"
  ALTER COLUMN "business_amount" TYPE NUMERIC(30, 2) USING "business_amount",
  ALTER COLUMN "user_share_rate_snapshot" TYPE NUMERIC(7, 2) USING "user_share_rate_snapshot",
  ALTER COLUMN "company_share_rate_snapshot" TYPE NUMERIC(7, 2) USING "company_share_rate_snapshot";

ALTER TABLE "fund_ledger_entries"
  ALTER COLUMN "amount" TYPE NUMERIC(30, 2) USING "amount",
  ALTER COLUMN "balance_before" TYPE NUMERIC(30, 2) USING "balance_before",
  ALTER COLUMN "balance_after" TYPE NUMERIC(30, 2) USING "balance_after";

ALTER TABLE "fund_accounts"
  ADD CONSTRAINT "fund_accounts_balance_scale_check"
    CHECK (scale("balance") <= 2),
  ADD CONSTRAINT "fund_accounts_user_share_rate_range_check"
    CHECK (
      "user_share_rate" IS NULL
      OR (
        "user_share_rate" BETWEEN 0 AND 100
        AND scale("user_share_rate") <= 2
      )
    );

ALTER TABLE "fund_posting_batches"
  ADD CONSTRAINT "fund_posting_batches_business_amount_nonzero_check"
    CHECK ("business_amount" <> 0),
  ADD CONSTRAINT "fund_posting_batches_share_snapshot_check"
    CHECK (
      (
        "user_id" IS NULL
        AND "user_share_rate_snapshot" IS NULL
        AND "company_share_rate_snapshot" IS NULL
      )
      OR (
        "user_id" IS NOT NULL
        AND "user_share_rate_snapshot" BETWEEN 0 AND 100
        AND "company_share_rate_snapshot" BETWEEN 0 AND 100
        AND "user_share_rate_snapshot" + "company_share_rate_snapshot" = 100
      )
    );

ALTER TABLE "fund_ledger_entries"
  ADD CONSTRAINT "fund_ledger_entries_amount_positive_check"
    CHECK ("amount" > 0),
  ADD CONSTRAINT "fund_ledger_entries_balance_equation_check"
    CHECK (
      (
        "direction" = 'CREDIT'
        AND "balance_after" = "balance_before" + "amount"
      )
      OR (
        "direction" = 'DEBIT'
        AND "balance_after" = "balance_before" - "amount"
      )
    );

COMMIT;
