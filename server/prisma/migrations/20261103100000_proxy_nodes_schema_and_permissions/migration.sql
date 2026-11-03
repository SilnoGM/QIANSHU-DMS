BEGIN;

-- IPFoxy 静态代理节点：供应商是数据源，本表是「节点归属哪个用户」的唯一真相源。
-- 同步只 upsert、不删除；供应商本次未返回的记录标记 vendor_missing，保留历史绑定。
-- 密码以 AES-256-GCM 密文落库，接口只在本人或 proxy-nodes:manage 权限下返回明文。
CREATE TYPE "proxy_protocol" AS ENUM ('SOCKS5', 'HTTP', 'SSH');
CREATE TYPE "proxy_ip_type" AS ENUM ('STATIC_DATACENTER', 'STATIC_ISP', 'STATIC_ISP_PRO');

ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PROXY_NODE_SYNCED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PROXY_NODE_ASSIGNED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PROXY_NODE_RELEASED';

CREATE TABLE "proxy_nodes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider_proxy_id" VARCHAR(64) NOT NULL,
  "host" VARCHAR(255) NOT NULL,
  "public_ip" VARCHAR(64),
  "port" INTEGER NOT NULL,
  "protocol" "proxy_protocol" NOT NULL,
  "country_code" VARCHAR(2),
  "area_id" VARCHAR(32),
  "vendor_country" VARCHAR(64),
  "ip_type" "proxy_ip_type" NOT NULL,
  "ip_version" VARCHAR(8) NOT NULL,
  "auto_extend" BOOLEAN NOT NULL DEFAULT false,
  "bought_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "last_renewed_at" TIMESTAMPTZ(6),
  "username" VARCHAR(128) NOT NULL,
  "password_ciphertext" TEXT NOT NULL,
  "assigned_user_id" UUID,
  "assigned_at" TIMESTAMPTZ(6),
  "assigned_by_user_id" UUID,
  "vendor_missing" BOOLEAN NOT NULL DEFAULT false,
  "last_synced_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "proxy_nodes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proxy_nodes_provider_proxy_id_key" UNIQUE ("provider_proxy_id"),
  CONSTRAINT "proxy_nodes_port_check" CHECK ("port" BETWEEN 1 AND 65535),
  CONSTRAINT "proxy_nodes_host_shape_check" CHECK ("host" = btrim("host") AND length("host") > 0),
  CONSTRAINT "proxy_nodes_username_shape_check" CHECK ("username" = btrim("username") AND length("username") > 0),
  CONSTRAINT "proxy_nodes_password_ciphertext_check" CHECK (length("password_ciphertext") > 0),
  CONSTRAINT "proxy_nodes_assignment_shape_check" CHECK (
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

ALTER TABLE "proxy_nodes"
  ADD CONSTRAINT "proxy_nodes_assigned_user_id_fkey"
  FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "proxy_nodes"
  ADD CONSTRAINT "proxy_nodes_assigned_by_user_id_fkey"
  FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "proxy_nodes_assigned_user_idx" ON "proxy_nodes"("assigned_user_id");
CREATE INDEX "proxy_nodes_expires_at_idx" ON "proxy_nodes"("expires_at");

-- 运营只读本人绑定节点；采运与管理侧维护同步和绑定关系。
INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES
  (
    '00000000-0000-4000-8000-000000000188',
    'proxy-nodes:read',
    '查看静态节点',
    '查看本人绑定的 IPFoxy 静态节点及凭证',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000189',
    'proxy-nodes:manage',
    '管理静态节点',
    '同步 IPFoxy 静态节点并维护用户绑定',
    false
  )
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" IN ('proxy-nodes:read', 'proxy-nodes:manage')
WHERE role."code" = 'system_admin'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" = 'proxy-nodes:read'
WHERE role."code" = 'operations_staff'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" IN ('proxy-nodes:read', 'proxy-nodes:manage')
WHERE role."code" = 'purchasing_staff'
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM "permissions"
    WHERE "code" IN ('proxy-nodes:read', 'proxy-nodes:manage')
      AND "system_only" = false
  ) <> 2 THEN
    RAISE EXCEPTION 'proxy node permissions are incomplete'
      USING ERRCODE = '23514', CONSTRAINT = 'proxy_node_permission_check';
  END IF;

  -- 全新库在迁移阶段只有 system_admin，采运内置角色由初始化流程创建；
  -- 角色已存在时必须已获得管理授权，角色尚未创建时由初始化按权限码补齐。
  IF EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'purchasing_staff') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "role_permissions" AS role_permission
      JOIN "roles" AS role ON role."id" = role_permission."role_id"
      JOIN "permissions" AS permission ON permission."id" = role_permission."permission_id"
      WHERE role."code" = 'purchasing_staff'
        AND permission."code" = 'proxy-nodes:manage'
    ) THEN
      RAISE EXCEPTION 'purchasing_staff must manage proxy nodes'
        USING ERRCODE = '23514', CONSTRAINT = 'proxy_node_role_grant_check';
    END IF;
  END IF;
END $$;

COMMIT;
