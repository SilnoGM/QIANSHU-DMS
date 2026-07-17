-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "session_revoked_reason" AS ENUM (
  'LOGOUT',
  'LOGOUT_ALL',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'USER_DISABLED',
  'ADMIN_RECOVERY'
);

-- CreateEnum
CREATE TYPE "auth_rate_limit_scope" AS ENUM (
  'LOGIN_USERNAME',
  'LOGIN_IP',
  'PASSWORD_CHANGE_USER',
  'PASSWORD_CHANGE_IP'
);

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('ANONYMOUS', 'USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "audit_event_type" AS ENUM (
  'AUTH_LOGIN_SUCCEEDED',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT',
  'AUTH_LOGOUT_ALL',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_ENABLED',
  'USER_DISABLED',
  'USER_PASSWORD_CHANGED',
  'USER_PASSWORD_RESET',
  'USER_ROLES_CHANGED',
  'ROLE_CREATED',
  'ROLE_UPDATED',
  'ROLE_PERMISSIONS_CHANGED',
  'SYSTEM_BOOTSTRAP',
  'SYSTEM_ADMIN_RECOVERED',
  'AUTH_RETENTION_PURGED'
);

-- CreateTable
CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "username" VARCHAR(128) NOT NULL,
  "username_normalized" VARCHAR(128) NOT NULL,
  "display_name" VARCHAR(128) NOT NULL,
  "password_hash" TEXT NOT NULL,
  "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
  "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  "password_changed_at" TIMESTAMPTZ(6) NOT NULL,
  "auth_version" INTEGER NOT NULL DEFAULT 0,
  "last_login_at" TIMESTAMPTZ(6),
  "created_by_user_id" UUID,
  "disabled_at" TIMESTAMPTZ(6),
  "disabled_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "users_auth_version_nonnegative_check"
    CHECK ("auth_version" >= 0),
  CONSTRAINT "users_disabled_state_check"
    CHECK (
      (
        "status" = 'ACTIVE'
        AND "disabled_at" IS NULL
        AND "disabled_by_user_id" IS NULL
      )
      OR
      (
        "status" = 'DISABLED'
        AND "disabled_at" IS NOT NULL
        AND "disabled_by_user_id" IS NOT NULL
      )
    ),
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(128) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "description" TEXT,
  "is_system" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(128) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "description" TEXT,
  "system_only" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,

  CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
  "role_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,

  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" BYTEA NOT NULL,
  "auth_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_activity_at" TIMESTAMPTZ(6) NOT NULL,
  "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "revoked_reason" "session_revoked_reason",

  CONSTRAINT "auth_sessions_auth_version_nonnegative_check"
    CHECK ("auth_version" >= 0),
  CONSTRAINT "auth_sessions_token_hash_32_bytes_check"
    CHECK (octet_length("token_hash") = 32),
  CONSTRAINT "auth_sessions_expiry_order_check"
    CHECK ("idle_expires_at" <= "absolute_expires_at"),
  CONSTRAINT "auth_sessions_revocation_pair_check"
    CHECK (
      ("revoked_at" IS NULL AND "revoked_reason" IS NULL)
      OR
      ("revoked_at" IS NOT NULL AND "revoked_reason" IS NOT NULL)
    ),
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limits" (
  "scope" "auth_rate_limit_scope" NOT NULL,
  "subject_key_hash" BYTEA NOT NULL,
  "bucket_started_at" TIMESTAMPTZ(6) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "blocked_until" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "auth_rate_limits_subject_key_hash_32_bytes_check"
    CHECK (octet_length("subject_key_hash") = 32),
  CONSTRAINT "auth_rate_limits_attempt_count_nonnegative_check"
    CHECK ("attempt_count" >= 0)
);

-- CreateTable
CREATE TABLE "audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_type" "audit_event_type" NOT NULL,
  "outcome" "audit_outcome" NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor_type" "audit_actor_type" NOT NULL,
  "actor_user_id" UUID,
  "target_type" VARCHAR(128),
  "target_id" VARCHAR(128),
  "request_id" VARCHAR(64) NOT NULL,
  "correlation_id" VARCHAR(128),
  "reason_code" VARCHAR(128),
  "source_ip_hash" BYTEA,
  "metadata" JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "audit_events_source_ip_hash_32_bytes_check"
    CHECK (
      "source_ip_hash" IS NULL
      OR octet_length("source_ip_hash") = 32
    ),
  CONSTRAINT "audit_events_actor_identity_check"
    CHECK (
      ("actor_type" = 'USER' AND "actor_user_id" IS NOT NULL)
      OR
      ("actor_type" IN ('ANONYMOUS', 'SYSTEM') AND "actor_user_id" IS NULL)
    ),
  CONSTRAINT "audit_events_metadata_object_check"
    CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_normalized_key"
  ON "users" ("username_normalized");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users" ("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles" ("code");

-- 首期只允许一个内置系统角色，普通角色必须保持 is_system=false。
CREATE UNIQUE INDEX "roles_single_system_role_key"
  ON "roles" ("is_system")
  WHERE "is_system" = true;

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions" ("code");

-- CreateIndex
CREATE INDEX "user_roles_role_id_user_id_idx"
  ON "user_roles" ("role_id", "user_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_role_id_idx"
  ON "role_permissions" ("permission_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key"
  ON "auth_sessions" ("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_revoked_at_absolute_expires_at_idx"
  ON "auth_sessions" ("user_id", "revoked_at", "absolute_expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_idle_expires_at_idx"
  ON "auth_sessions" ("idle_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limits_scope_subject_key_hash_key"
  ON "auth_rate_limits" ("scope", "subject_key_hash");

-- CreateIndex
CREATE INDEX "auth_rate_limits_updated_at_idx"
  ON "auth_rate_limits" ("updated_at");

-- CreateIndex
CREATE INDEX "auth_rate_limits_blocked_until_idx"
  ON "auth_rate_limits" ("blocked_until");

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_id_idx"
  ON "audit_events" ("occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_occurred_at_idx"
  ON "audit_events" ("actor_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_event_type_occurred_at_idx"
  ON "audit_events" ("event_type", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "users"
  ADD CONSTRAINT "users_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users"
  ADD CONSTRAINT "users_disabled_by_user_id_fkey"
  FOREIGN KEY ("disabled_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_permission_id_fkey"
  FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the only system role.
INSERT INTO "roles" (
  "id",
  "code",
  "name",
  "description",
  "is_system"
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'system_admin',
  '系统管理员',
  '内置系统管理员角色，持有首期全部管理权限',
  true
);

-- Seed the confirmed management permission catalog. No demo pages.* permission is inserted.
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  ('00000000-0000-4000-8000-000000000101', 'users:read', '查询用户', '查询用户列表和详情', true),
  ('00000000-0000-4000-8000-000000000102', 'users:create', '创建用户', '创建用户并设置初始密码', true),
  ('00000000-0000-4000-8000-000000000103', 'users:update', '编辑用户', '编辑用户基础信息', true),
  ('00000000-0000-4000-8000-000000000104', 'users:enable', '启用用户', '启用已禁用用户', true),
  ('00000000-0000-4000-8000-000000000105', 'users:disable', '禁用用户', '禁用用户并撤销其 Session', true),
  ('00000000-0000-4000-8000-000000000106', 'users:assign-roles', '分配用户角色', '替换用户的角色集合', true),
  ('00000000-0000-4000-8000-000000000107', 'users:reset-password', '重置用户密码', '直接设置或重置用户登录密码', true),
  ('00000000-0000-4000-8000-000000000108', 'roles:read', '查询角色权限', '查询角色和权限目录', true),
  ('00000000-0000-4000-8000-000000000109', 'roles:create', '创建角色', '创建普通角色', true),
  ('00000000-0000-4000-8000-000000000110', 'roles:update', '编辑角色', '编辑普通角色', true),
  ('00000000-0000-4000-8000-000000000111', 'roles:assign-permissions', '分配角色权限', '替换普通角色的权限集合', true),
  ('00000000-0000-4000-8000-000000000112', 'audit:read', '查询安全审计', '查询安全审计事件', true);

-- Grant every confirmed management permission to system_admin.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  '00000000-0000-4000-8000-000000000001',
  "id"
FROM "permissions"
WHERE "system_only" = true;
