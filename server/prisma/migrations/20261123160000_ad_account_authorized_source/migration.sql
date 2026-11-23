BEGIN;

-- 猎豹只有两个账户来源：本 appid 自开账户与第三方代理商授权账户。
-- 授权账户缺 update_date，且不提供日消耗，因此来源必须落库，供同步缺失标记、
-- 页面展示与「是否有日消耗」判断使用。
CREATE TYPE "ad_account_source" AS ENUM ('SELF', 'AUTHORIZED');

ALTER TABLE "ad_accounts"
  ADD COLUMN "account_source" "ad_account_source" NOT NULL DEFAULT 'SELF';

-- 授权账户没有 update_date，不能伪造上游刷新时间；展示层按 NULL 显示「—」。
ALTER TABLE "ad_accounts"
  ALTER COLUMN "vendor_updated_at" DROP NOT NULL;

-- MigrationSelfCheck
DO $$
DECLARE
  account_source_type text;
  account_source_nullable text;
  account_source_default text;
  vendor_nullable text;
  enum_count integer;
BEGIN
  SELECT udt_name, is_nullable, column_default
  INTO account_source_type, account_source_nullable, account_source_default
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'ad_accounts'
    AND column_name = 'account_source';

  IF account_source_type <> 'ad_account_source' OR account_source_nullable <> 'NO' OR account_source_default NOT LIKE '%SELF%' THEN
    RAISE EXCEPTION 'ad account authorized source migration invariant mismatch: account_source';
  END IF;

  SELECT is_nullable
  INTO vendor_nullable
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'ad_accounts'
    AND column_name = 'vendor_updated_at';

  IF vendor_nullable <> 'YES' THEN
    RAISE EXCEPTION 'ad account authorized source migration invariant mismatch: vendor_updated_at';
  END IF;

  SELECT count(*)::integer
  INTO enum_count
  FROM pg_enum AS enum_entry
  JOIN pg_type AS type_entry ON type_entry.oid = enum_entry.enumtypid
  JOIN pg_namespace AS schema_entry ON schema_entry.oid = type_entry.typnamespace
  WHERE schema_entry.nspname = current_schema()
    AND type_entry.typname = 'ad_account_source';

  IF enum_count <> 2 THEN
    RAISE EXCEPTION 'ad account authorized source migration invariant mismatch: enum';
  END IF;
END;
$$;

COMMIT;
