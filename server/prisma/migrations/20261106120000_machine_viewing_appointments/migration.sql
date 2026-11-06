BEGIN;

-- 看机预约：运营登记客户到访意向，采运按预约时间跟进。
-- 需求只选择月/日，年份在创建时由服务端按上海自然日推断并固定写入
-- appointment_date，此后跨年也不会改变已登记的预约日期。
-- hour 为空表示只确定了时段（上午/下午），没有约定到具体几点。
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'MACHINE_VIEWING_APPOINTMENT_CREATED';

CREATE TYPE "machine_viewing_site" AS ENUM (
  'NEW_TAIPEI_LINKOU',
  'TAICHUNG_LONGJING'
);

CREATE TYPE "machine_viewing_machine_type" AS ENUM (
  'MINI_TILLER',
  'SHREDDER',
  'INCINERATOR'
);

CREATE TYPE "machine_viewing_period" AS ENUM (
  'AM',
  'PM'
);

CREATE TABLE "machine_viewing_appointments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site" "machine_viewing_site" NOT NULL,
  "machine_type" "machine_viewing_machine_type" NOT NULL,
  "appointment_date" DATE NOT NULL,
  "period" "machine_viewing_period" NOT NULL,
  "hour" INTEGER,
  "customer_name" VARCHAR(128) NOT NULL,
  "customer_phone" VARCHAR(64),
  "contact_person" VARCHAR(64) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "request_key_hash" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "machine_viewing_appointments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "machine_viewing_appointments_creator_request_key"
    UNIQUE ("created_by_user_id", "request_key_hash"),
  CONSTRAINT "machine_viewing_appointments_hour_range_check"
    CHECK ("hour" IS NULL OR ("hour" BETWEEN 1 AND 12)),
  CONSTRAINT "machine_viewing_appointments_customer_name_shape_check"
    CHECK ("customer_name" = btrim("customer_name") AND length("customer_name") > 0),
  CONSTRAINT "machine_viewing_appointments_contact_person_shape_check"
    CHECK ("contact_person" = btrim("contact_person") AND length("contact_person") > 0),
  CONSTRAINT "machine_viewing_appointments_customer_phone_shape_check"
    CHECK ("customer_phone" IS NULL OR ("customer_phone" = btrim("customer_phone") AND length("customer_phone") > 0)),
  CONSTRAINT "machine_viewing_appointments_request_key_check"
    CHECK (octet_length("request_key_hash") = 32),
  CONSTRAINT "machine_viewing_appointments_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "machine_viewing_appointments_time_idx"
  ON "machine_viewing_appointments"("appointment_date", "period", "hour", "id");
CREATE INDEX "machine_viewing_appointments_creator_created_idx"
  ON "machine_viewing_appointments"("created_by_user_id", "created_at" DESC, "id" DESC);

-- 运营登记并查看本人预约；采运只读全部，因此不授予 create。
INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES
  (
    '00000000-0000-4000-8000-000000002430',
    'machine-viewings:read',
    '查看看机预约',
    '查看看机预约列表；运营只看本人，采运按数据范围查看全部',
    false
  ),
  (
    '00000000-0000-4000-8000-000000002431',
    'machine-viewings:create',
    '登记看机预约',
    '登记客户看机预约',
    false
  )
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" IN ('machine-viewings:read', 'machine-viewings:create')
WHERE role."code" = 'system_admin'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" IN ('machine-viewings:read', 'machine-viewings:create')
WHERE role."code" = 'operations_staff'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" = 'machine-viewings:read'
WHERE role."code" = 'purchasing_staff'
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM "permissions"
    WHERE "code" IN ('machine-viewings:read', 'machine-viewings:create')
      AND "system_only" = false
  ) <> 2 THEN
    RAISE EXCEPTION 'machine viewing permissions are incomplete'
      USING ERRCODE = '23514', CONSTRAINT = 'machine_viewing_permission_check';
  END IF;

  -- 全新库在迁移阶段只有 system_admin，内置业务角色由初始化流程创建；
  -- 角色已存在时必须已经获得上面的授权，避免升级环境静默缺权限。
  IF EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'operations_staff') THEN
    IF (
      SELECT count(*)
      FROM "role_permissions" AS role_permission
      JOIN "roles" AS role ON role."id" = role_permission."role_id"
      JOIN "permissions" AS permission ON permission."id" = role_permission."permission_id"
      WHERE role."code" = 'operations_staff'
        AND permission."code" IN ('machine-viewings:read', 'machine-viewings:create')
    ) <> 2 THEN
      RAISE EXCEPTION 'operations_staff must hold machine viewing read and create'
        USING ERRCODE = '23514', CONSTRAINT = 'machine_viewing_role_grant_check';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'purchasing_staff') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "role_permissions" AS role_permission
      JOIN "roles" AS role ON role."id" = role_permission."role_id"
      JOIN "permissions" AS permission ON permission."id" = role_permission."permission_id"
      WHERE role."code" = 'purchasing_staff'
        AND permission."code" = 'machine-viewings:read'
    ) THEN
      RAISE EXCEPTION 'purchasing_staff must hold machine viewing read'
        USING ERRCODE = '23514', CONSTRAINT = 'machine_viewing_role_grant_check';
    END IF;
  END IF;
END $$;

COMMIT;
