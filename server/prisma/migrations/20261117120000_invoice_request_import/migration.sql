BEGIN;

-- 代导入：历史开票申请由特权账号代原开票人建立。
--
-- 1) 归属仍在开票人（created_by_id），代操作人单独落列，避免「运营仅可见本人」的
--    行级口径被导入动作击穿；同一行两者不得相同，否则等于伪装成本人提交。
-- 2) 状态历史逐步记录代操作人，时间线才能表达「某人 代 某人」。
-- 3) 新增第 9 条权限 invoice-requests:import，system_only = true，只授 system_admin：
--    跨人建单是运维级能力，不允许通过角色管理委派给日常账号。

ALTER TABLE "invoice_requests"
  ADD COLUMN "submitted_on_behalf_by_user_id" UUID;

ALTER TABLE "invoice_requests"
  ADD CONSTRAINT "invoice_requests_submitted_on_behalf_by_user_id_fkey"
    FOREIGN KEY ("submitted_on_behalf_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "invoice_requests"
  ADD CONSTRAINT "invoice_requests_on_behalf_distinct_check"
    CHECK ("submitted_on_behalf_by_user_id" IS NULL OR "submitted_on_behalf_by_user_id" <> "created_by_id");

-- 代导入批次与审计按代操作人检索；本人提交的行为 NULL，仍在索引内但选择性可接受。
CREATE INDEX "invoice_requests_on_behalf_idx"
  ON "invoice_requests" ("submitted_on_behalf_by_user_id");

ALTER TABLE "invoice_request_status_history"
  ADD COLUMN "acting_for_user_id" UUID;

ALTER TABLE "invoice_request_status_history"
  ADD CONSTRAINT "invoice_request_status_history_acting_for_user_id_fkey"
    FOREIGN KEY ("acting_for_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "invoice_request_status_history"
  ADD CONSTRAINT "invoice_request_status_history_acting_for_check"
    CHECK ("acting_for_user_id" IS NULL OR "acting_for_user_id" <> "actor_user_id");

-- SeedInvoiceRequestImportPermission
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES (
  '00000000-0000-4000-8000-000000000190',
  'invoice-requests:import',
  '代导入开票申请',
  '由特权账号代历史开票人批量建立开票申请，归属写到开票人本人；系统级权限，不可委派',
  true
);

-- GrantSystemAdministratorImportPermission
-- 稳定 ID 与 code 双重约束，角色或权限目录漂移时不会静默授权错误对象。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" = '00000000-0000-4000-8000-000000000190'
  AND permission."code" = 'invoice-requests:import';

-- MigrationSelfCheck
-- 同一事务内证明：列与约束已生效、权限为系统级、且只授给 system_admin 一个角色。
DO $$
DECLARE
  actual_count INTEGER;
  system_only_flag BOOLEAN;
  request_column_count INTEGER;
  history_column_count INTEGER;
BEGIN
  SELECT count(*)::integer
  INTO request_column_count
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'invoice_requests'
    AND column_name = 'submitted_on_behalf_by_user_id';

  SELECT count(*)::integer
  INTO history_column_count
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'invoice_request_status_history'
    AND column_name = 'acting_for_user_id';

  IF request_column_count <> 1 OR history_column_count <> 1 THEN
    RAISE EXCEPTION 'invoice request import migration invariant mismatch: on-behalf columns';
  END IF;

  SELECT permission."system_only"
  INTO system_only_flag
  FROM "permissions" AS permission
  WHERE permission."id" = '00000000-0000-4000-8000-000000000190'
    AND permission."code" = 'invoice-requests:import';

  IF system_only_flag IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invoice request import migration invariant mismatch: import permission must be system only';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role
    ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission
    ON permission."id" = grant_entry."permission_id"
  WHERE permission."code" = 'invoice-requests:import'
    AND role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'invoice request import migration invariant mismatch: system admin grant';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "permissions" AS permission
    ON permission."id" = grant_entry."permission_id"
  WHERE permission."code" = 'invoice-requests:import';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'invoice request import migration invariant mismatch: import permission must be granted only to system admin';
  END IF;
END;
$$;

COMMIT;
