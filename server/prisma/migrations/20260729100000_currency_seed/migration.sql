BEGIN;

-- 固定基础货币目录；示例汇率只用于解释公式，本 migration 保持零汇率。
INSERT INTO "currencies" (
  "id",
  "code",
  "name",
  "english_name",
  "symbol",
  "minor_unit",
  "enabled",
  "sort_order",
  "version"
)
VALUES
  (
    '00000000-0000-4000-8000-000000001001',
    'CNY',
    '人民币',
    'Chinese Yuan',
    '¥',
    2,
    true,
    10,
    1
  ),
  (
    '00000000-0000-4000-8000-000000001002',
    'TWD',
    '新台币',
    'New Taiwan Dollar',
    'NT$',
    2,
    false,
    20,
    1
  ),
  (
    '00000000-0000-4000-8000-000000001003',
    'MYR',
    '马来西亚林吉特',
    'Malaysian Ringgit',
    'RM',
    2,
    false,
    30,
    1
  ),
  (
    '00000000-0000-4000-8000-000000001004',
    'USD',
    '美元',
    'US Dollar',
    '$',
    2,
    false,
    40,
    1
  );

DO $$
DECLARE
  currency_total_count INTEGER;
  currency_unique_code_count INTEGER;
  expected_code_count INTEGER;
  enabled_count INTEGER;
  enabled_cny_count INTEGER;
  minor_unit_count INTEGER;
  identity_count INTEGER;
  exchange_rate_count INTEGER;
BEGIN
  SELECT
    count(*)::integer,
    count(DISTINCT "code")::integer,
    count(*) FILTER (
      WHERE "code" IN ('CNY', 'TWD', 'MYR', 'USD')
    )::integer,
    count(*) FILTER (WHERE "enabled" = true)::integer,
    count(*) FILTER (
      WHERE "code" = 'CNY'
        AND "enabled" = true
    )::integer,
    count(*) FILTER (WHERE "minor_unit" = 2)::integer
  INTO
    currency_total_count,
    currency_unique_code_count,
    expected_code_count,
    enabled_count,
    enabled_cny_count,
    minor_unit_count
  FROM "currencies";

  IF currency_total_count <> 4 THEN
    RAISE EXCEPTION 'currency seed total count mismatch';
  END IF;

  IF currency_unique_code_count <> 4 OR expected_code_count <> 4 THEN
    RAISE EXCEPTION 'currency seed code count mismatch';
  END IF;

  IF enabled_count <> 1 OR enabled_cny_count <> 1 THEN
    RAISE EXCEPTION 'currency seed enabled state mismatch';
  END IF;

  IF minor_unit_count <> 4 THEN
    RAISE EXCEPTION 'currency seed minor unit mismatch';
  END IF;

  SELECT count(*)::integer
  INTO identity_count
  FROM "currencies"
  WHERE
    (
      "id" = '00000000-0000-4000-8000-000000001001'::uuid
      AND "code" = 'CNY'
      AND "sort_order" = 10
    )
    OR (
      "id" = '00000000-0000-4000-8000-000000001002'::uuid
      AND "code" = 'TWD'
      AND "sort_order" = 20
    )
    OR (
      "id" = '00000000-0000-4000-8000-000000001003'::uuid
      AND "code" = 'MYR'
      AND "sort_order" = 30
    )
    OR (
      "id" = '00000000-0000-4000-8000-000000001004'::uuid
      AND "code" = 'USD'
      AND "sort_order" = 40
    );

  IF identity_count <> 4 THEN
    RAISE EXCEPTION 'currency seed identity mismatch';
  END IF;

  SELECT count(*)::integer
  INTO exchange_rate_count
  FROM "exchange_rates";

  IF exchange_rate_count <> 0 THEN
    RAISE EXCEPTION 'currency seed exchange rate count mismatch';
  END IF;
END;
$$;

COMMIT;
