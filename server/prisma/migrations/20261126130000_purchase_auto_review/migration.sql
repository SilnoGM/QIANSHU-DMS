BEGIN;

-- 采购审核自动托管：全局开关 + 按单任务 + 系统执行账号。
-- 开关只影响此后新建的采购单；任务表记录领取、重试与失败原因，订单本身仍以
-- purchase_orders.order_status 为准。执行账号的密码为随机生成后丢弃的明文，
-- 只用于满足审计与历史的真实用户外键，不作为可登录凭证分发。

ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PURCHASE_AUTO_REVIEW_SETTING_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PURCHASE_ORDER_AUTO_REVIEW_FAILED';

CREATE TYPE "purchase_auto_review_job_state" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'CANCELLED', 'FAILED');

CREATE TABLE "purchase_auto_review_settings" (
  "id" VARCHAR(32) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by_user_id" UUID,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_scan_at" TIMESTAMPTZ(6),

  CONSTRAINT "purchase_auto_review_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchase_auto_review_settings"
  ADD CONSTRAINT "purchase_auto_review_settings_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

INSERT INTO "purchase_auto_review_settings" ("id", "enabled")
VALUES ('default', false);

CREATE TABLE "purchase_order_auto_review_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_order_id" UUID NOT NULL,
  "state" "purchase_auto_review_job_state" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_expires_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(64),
  "last_error_message" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),

  CONSTRAINT "purchase_order_auto_review_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_auto_review_jobs_purchase_order_key" UNIQUE ("purchase_order_id"),
  CONSTRAINT "purchase_order_auto_review_jobs_attempts_nonnegative_check" CHECK ("attempts" >= 0)
);

ALTER TABLE "purchase_order_auto_review_jobs"
  ADD CONSTRAINT "purchase_order_auto_review_jobs_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "purchase_order_auto_review_jobs_state_next_idx"
  ON "purchase_order_auto_review_jobs"("state", "next_attempt_at");

-- 开关会跳过人工复核，默认只授系统管理员；system_only=true 表示不参与角色委派。
INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES (
  '00000000-0000-4000-8000-000000002448',
  'purchase-orders:auto-review',
  '维护采购审核自动托管',
  '开启或关闭采购审核自动托管，并读取最近一次任务运行状态',
  true
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."code" = 'purchase-orders:auto-review';

-- 系统内置账号不分配任何角色：数据范围在「无 data-scope 权限」时按全量处理
-- （见 resolveDataScope 的既有契约），同时账号没有任何页面或接口权限。
-- roles 表有单系统角色唯一约束，不能再建第二个 is_system 角色。
INSERT INTO "users" (
  "id",
  "username",
  "username_normalized",
  "display_name",
  "password_hash",
  "status",
  "must_change_password",
  "password_changed_at",
  "auth_version",
  "created_at",
  "updated_at"
)
VALUES (
  '00000000-0000-4000-8000-000000002449',
  'purchase-review-automation',
  'purchase-review-automation',
  '采购审核托管',
  '$argon2id$v=19$m=19456,t=2,p=1$Cnlsy4NHdIptkNNjf4mB+Q$SP1/OdUY1MaaFrBsDeaUBs83In6i0Xsuyd9VWlkpWvg',
  'ACTIVE',
  false,
  CURRENT_TIMESTAMP,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- MigrationSelfCheck
DO $$
DECLARE
  actual_count integer;
  settings_enabled boolean;
BEGIN
  IF to_regclass('public.purchase_auto_review_settings') IS NULL THEN
    RAISE EXCEPTION 'purchase auto review migration invariant mismatch: settings table missing';
  END IF;

  IF to_regclass('public.purchase_order_auto_review_jobs') IS NULL THEN
    RAISE EXCEPTION 'purchase auto review migration invariant mismatch: jobs table missing';
  END IF;

  SELECT enabled INTO settings_enabled
  FROM "purchase_auto_review_settings"
  WHERE "id" = 'default';

  IF settings_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'purchase auto review migration invariant mismatch: default setting';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions"
  WHERE "id" = '00000000-0000-4000-8000-000000002448'
    AND "code" = 'purchase-orders:auto-review'
    AND "system_only" = true;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'purchase auto review migration invariant mismatch: permission catalog';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
  WHERE role."code" = 'system_admin'
    AND permission."code" = 'purchase-orders:auto-review';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'purchase auto review migration invariant mismatch: system admin grant';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "users" AS user_entry
  WHERE user_entry."username_normalized" = 'purchase-review-automation'
    AND user_entry."id" = '00000000-0000-4000-8000-000000002449';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'purchase auto review migration invariant mismatch: automation actor';
  END IF;

  -- 账号必须保持无角色：任何角色都可能带来页面权限或收窄数据范围。
  SELECT count(*)::integer
  INTO actual_count
  FROM "user_roles"
  WHERE "user_id" = '00000000-0000-4000-8000-000000002449';

  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'purchase auto review migration invariant mismatch: automation actor roles';
  END IF;
END $$;

COMMIT;
