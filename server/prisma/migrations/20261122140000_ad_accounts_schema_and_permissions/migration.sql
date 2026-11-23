BEGIN;

-- 猎豹 CheetahGo 广告账户：供应商是数据源，本表是「账户归属哪个用户」的唯一真相源。
-- 同步只 upsert、不删除；供应商本次未返回的记录标记 vendor_missing，保留历史绑定。
-- 金额按上游十进制字符串原样落库，可用余额在查询层现算，不落冗余列。
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'AD_ACCOUNT_SYNCED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'AD_ACCOUNT_ASSIGNED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'AD_ACCOUNT_RELEASED';

CREATE TABLE "ad_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" VARCHAR(64) NOT NULL,
  "account_name" VARCHAR(255) NOT NULL,
  "company_cn" VARCHAR(255),
  "account_status" INTEGER NOT NULL,
  "account_status_text" VARCHAR(64),
  "freeze" INTEGER,
  "disable_reason" INTEGER NOT NULL DEFAULT 0,
  "spend_cap" DECIMAL(30, 2) NOT NULL,
  "amount_spent" DECIMAL(30, 2) NOT NULL,
  "daily_spend_limit" DECIMAL(30, 2),
  "disabled_transfer_amount" DECIMAL(30, 2) NOT NULL DEFAULT 0,
  "created_time" TIMESTAMPTZ(6) NOT NULL,
  "vendor_updated_at" TIMESTAMPTZ(6) NOT NULL,
  "low_balance_alerted_at" TIMESTAMPTZ(6),
  "assigned_user_id" UUID,
  "assigned_at" TIMESTAMPTZ(6),
  "assigned_by_user_id" UUID,
  "vendor_missing" BOOLEAN NOT NULL DEFAULT false,
  "last_synced_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ad_accounts_account_id_key" UNIQUE ("account_id"),
  CONSTRAINT "ad_accounts_account_id_shape_check" CHECK (
    "account_id" = btrim("account_id") AND length("account_id") > 0
  ),
  CONSTRAINT "ad_accounts_account_name_shape_check" CHECK (
    "account_name" = btrim("account_name") AND length("account_name") > 0
  ),
  -- 上游金额可能是 0，但不能为负；超支只体现在 amount_spent > spend_cap，不在列级拦截。
  CONSTRAINT "ad_accounts_amount_non_negative_check" CHECK (
    "spend_cap" >= 0
    AND "amount_spent" >= 0
    AND "disabled_transfer_amount" >= 0
    AND ("daily_spend_limit" IS NULL OR "daily_spend_limit" >= 0)
  ),
  CONSTRAINT "ad_accounts_assignment_shape_check" CHECK (
    (
      "assigned_user_id" IS NULL
      AND "assigned_at" IS NULL
      AND "assigned_by_user_id" IS NULL
    )
    OR (
      "assigned_user_id" IS NOT NULL
      AND "assigned_at" IS NOT NULL
      AND "assigned_by_user_id" IS NOT NULL
    )
  )
);

ALTER TABLE "ad_accounts"
  ADD CONSTRAINT "ad_accounts_assigned_user_id_fkey"
  FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ad_accounts"
  ADD CONSTRAINT "ad_accounts_assigned_by_user_id_fkey"
  FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "ad_accounts_assigned_user_idx" ON "ad_accounts"("assigned_user_id");
CREATE INDEX "ad_accounts_low_balance_alert_idx" ON "ad_accounts"("low_balance_alerted_at");

-- 逐日消耗：7 天日均与可持续天数的唯一数据源，必须落库以便回溯。
CREATE TABLE "ad_account_spend_daily" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ad_account_id" UUID NOT NULL,
  "spend_date" DATE NOT NULL,
  "spend" DECIMAL(18, 2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ad_account_spend_daily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ad_account_spend_daily_ad_account_id_spend_date_key" UNIQUE ("ad_account_id", "spend_date"),
  CONSTRAINT "ad_account_spend_daily_spend_non_negative_check" CHECK ("spend" >= 0)
);

ALTER TABLE "ad_account_spend_daily"
  ADD CONSTRAINT "ad_account_spend_daily_ad_account_id_fkey"
  FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE INDEX "ad_account_spend_daily_spend_date_idx" ON "ad_account_spend_daily"("spend_date");

INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES
  (
    '00000000-0000-4000-8000-000000002436',
    'ad-accounts:read',
    '查看广告账户',
    '查看本人绑定的猎豹广告账户（余额、消耗、续航与预警）',
    false
  ),
  (
    '00000000-0000-4000-8000-000000002437',
    'ad-accounts:manage',
    '管理广告账户',
    '查看全部广告账户、维护绑定关系并手动触发同步',
    false
  );

-- 系统管理员始终持有全部权限；稳定 ID 与 code 双重约束避免授权漂移。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."code" IN ('ad-accounts:read', 'ad-accounts:manage');

-- 内置业务角色可能尚未 seed（空库重放）；存在时补授权，seed 会为新建角色写入同一权限。
-- 运营只需看本人绑定账户；采运负责绑定与手动同步，因此同时持有 read。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" = 'ad-accounts:read'
WHERE role."code" IN ('operations_staff', 'purchasing_staff')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" = 'ad-accounts:manage'
WHERE role."code" = 'purchasing_staff'
ON CONFLICT DO NOTHING;

-- MigrationSelfCheck
DO $$
DECLARE
  actual_count integer;
  grant_count integer;
BEGIN
  IF to_regclass('public.ad_accounts') IS NULL THEN
    RAISE EXCEPTION 'ad account migration invariant mismatch: ad_accounts table missing';
  END IF;

  IF to_regclass('public.ad_account_spend_daily') IS NULL THEN
    RAISE EXCEPTION 'ad account migration invariant mismatch: spend daily table missing';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions" AS permission
  WHERE permission."id" IN (
      '00000000-0000-4000-8000-000000002436',
      '00000000-0000-4000-8000-000000002437'
    )
    AND permission."code" IN ('ad-accounts:read', 'ad-accounts:manage')
    AND permission."system_only" = false;

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'ad account migration invariant mismatch: permission catalog';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
  WHERE role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin'
    AND permission."code" IN ('ad-accounts:read', 'ad-accounts:manage');

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'ad account migration invariant mismatch: system admin grant';
  END IF;

  -- 运营：有 read，但不应该拿到 manage（绑定与手动同步是采运职责）。
  SELECT count(*)::integer
  INTO grant_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
  WHERE role."code" = 'operations_staff'
    AND permission."code" = 'ad-accounts:read';

  IF grant_count <> (
    SELECT count(*)::integer FROM "roles" WHERE "code" = 'operations_staff'
  ) THEN
    RAISE EXCEPTION 'ad account migration invariant mismatch: operations read grant';
  END IF;

  SELECT count(*)::integer
  INTO grant_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
  WHERE role."code" = 'operations_staff'
    AND permission."code" = 'ad-accounts:manage';

  IF grant_count <> 0 THEN
    RAISE EXCEPTION 'ad account migration invariant mismatch: operations manage grant must be absent';
  END IF;

  -- 采运：read + manage 都要有（管理页既要看全部，也要绑定）。
  SELECT count(*)::integer
  INTO grant_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
  WHERE role."code" = 'purchasing_staff'
    AND permission."code" IN ('ad-accounts:read', 'ad-accounts:manage');

  IF grant_count <> 2 * (
    SELECT count(*)::integer FROM "roles" WHERE "code" = 'purchasing_staff'
  ) THEN
    RAISE EXCEPTION 'ad account migration invariant mismatch: purchasing grants';
  END IF;

  -- 财务：本阶段不接入（财务无页面，授权空挂没有意义）。
  IF EXISTS (
    SELECT 1
    FROM "role_permissions" AS grant_entry
    JOIN "roles" AS role ON role."id" = grant_entry."role_id"
    JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
    WHERE role."code" = 'finance_staff'
      AND permission."code" IN ('ad-accounts:read', 'ad-accounts:manage')
  ) THEN
    RAISE EXCEPTION 'ad account migration invariant mismatch: finance grant must be absent';
  END IF;

  -- 绑定三列必须同空或同满。
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ad_accounts_assignment_shape_check'
      AND conrelid = 'public.ad_accounts'::regclass
  ) THEN
    RAISE EXCEPTION 'ad account migration invariant mismatch: assignment shape check missing';
  END IF;
END;
$$;

COMMIT;
