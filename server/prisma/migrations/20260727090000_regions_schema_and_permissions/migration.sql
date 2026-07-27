BEGIN;

-- ExtendAuditEventType
-- 新值只供 migration 提交后的运行时代码使用，避免在同一 PostgreSQL 事务内提前引用。
ALTER TYPE "audit_event_type" ADD VALUE 'REGION_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'REGION_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE 'REGION_ENABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'REGION_DISABLED';

-- CreateEnum
CREATE TYPE "region_level" AS ENUM (
  'COUNTRY_REGION',
  'PROVINCE_STATE',
  'CITY'
);

-- CreateTable
CREATE TABLE "regions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "normalized_name" VARCHAR(128) NOT NULL,
  "english_name" VARCHAR(128),
  "source_name" VARCHAR(128),
  "source_code" VARCHAR(64),
  "administrative_type" VARCHAR(64) NOT NULL,
  "level" "region_level" NOT NULL,
  "parent_id" UUID,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "regions_code_format_check"
    CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]{1,63}$'),
  CONSTRAINT "regions_name_nonblank_check"
    CHECK ("name" !~ '^[[:space:]]*$'),
  CONSTRAINT "regions_normalized_name_nonblank_check"
    CHECK ("normalized_name" !~ '^[[:space:]]*$'),
  CONSTRAINT "regions_english_name_nonblank_check"
    CHECK (
      "english_name" IS NULL
      OR "english_name" !~ '^[[:space:]]*$'
    ),
  CONSTRAINT "regions_source_name_nonblank_check"
    CHECK (
      "source_name" IS NULL
      OR "source_name" !~ '^[[:space:]]*$'
    ),
  CONSTRAINT "regions_source_code_ascii_check"
    CHECK (
      "source_code" IS NULL
      OR (
        char_length("source_code") > 0
        AND octet_length("source_code") = char_length("source_code")
        AND "source_code" !~ '[[:cntrl:]]'
        AND "source_code" !~ '^[[:space:]]*$'
      )
    ),
  CONSTRAINT "regions_administrative_type_format_check"
    CHECK (
      "administrative_type"
      ~ '^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$'
    ),
  CONSTRAINT "regions_sort_order_nonnegative_check"
    CHECK ("sort_order" >= 0),
  CONSTRAINT "regions_parent_shape_check"
    CHECK (
      (
        "level" = 'COUNTRY_REGION'
        AND "parent_id" IS NULL
      )
      OR
      (
        "level" IN ('PROVINCE_STATE', 'CITY')
        AND "parent_id" IS NOT NULL
      )
    ),
  CONSTRAINT "regions_no_self_parent_check"
    CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regions_code_key"
  ON "regions" ("code");

-- PostgreSQL 的普通 unique 允许多个 NULL；根节点必须使用独立 partial unique。
CREATE UNIQUE INDEX "regions_root_normalized_name_key"
  ON "regions" ("normalized_name")
  WHERE "parent_id" IS NULL;

CREATE UNIQUE INDEX "regions_parent_id_normalized_name_key"
  ON "regions" ("parent_id", "normalized_name");

CREATE INDEX "regions_parent_id_sort_order_name_id_idx"
  ON "regions" (
    "parent_id",
    "sort_order",
    "normalized_name",
    "id"
  );

CREATE INDEX "regions_level_enabled_name_id_idx"
  ON "regions" (
    "level",
    "enabled",
    "normalized_name",
    "id"
  );

-- AddForeignKey
ALTER TABLE "regions"
  ADD CONSTRAINT "regions_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "regions" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

/**
 * 数据库是地区 identity 与三级关系的最终边界。
 *
 * Service 会先做同一规则的业务预校验以提供可读错误；本 trigger 负责阻断并发写和
 * 直接 SQL 造成的错层、孤儿、自引用或 identity 漂移。父级读取使用 FOR SHARE，
 * 使父级在本行插入完成前不能被并发更新或删除。
 */
CREATE FUNCTION "enforce_region_hierarchy"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_level "region_level";
  expected_parent_level "region_level";
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."level" IS DISTINCT FROM OLD."level"
    OR NEW."parent_id" IS DISTINCT FROM OLD."parent_id"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'region identity is immutable',
      CONSTRAINT = 'regions_identity_immutable_check';
  END IF;

  IF NEW."parent_id" IS NOT NULL AND NEW."parent_id" = NEW."id" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'region cannot be its own parent',
      CONSTRAINT = 'regions_no_self_parent_check';
  END IF;

  IF NEW."level" = 'COUNTRY_REGION' THEN
    IF NEW."parent_id" IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'country or region cannot have a parent',
        CONSTRAINT = 'regions_hierarchy_check';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW."parent_id" IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'region parent is required',
      CONSTRAINT = 'regions_hierarchy_check';
  END IF;

  expected_parent_level :=
    CASE NEW."level"
      WHEN 'PROVINCE_STATE' THEN 'COUNTRY_REGION'::"region_level"
      WHEN 'CITY' THEN 'PROVINCE_STATE'::"region_level"
    END;

  SELECT "level"
  INTO parent_level
  FROM "regions"
  WHERE "id" = NEW."parent_id"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'region parent does not exist',
      CONSTRAINT = 'regions_parent_id_fkey';
  END IF;

  IF parent_level <> expected_parent_level THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'region hierarchy is invalid',
      CONSTRAINT = 'regions_hierarchy_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "regions_hierarchy_trigger"
BEFORE INSERT OR UPDATE OF "id", "code", "level", "parent_id"
ON "regions"
FOR EACH ROW
EXECUTE FUNCTION "enforce_region_hierarchy"();

-- Seed the assignable Region permission catalog with stable identifiers.
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000113',
    'regions:read',
    '查询地区',
    '查询地区管理列表与导航',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000114',
    'regions:create',
    '创建地区',
    '创建国家地区、省州或城市节点',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000115',
    'regions:update',
    '编辑地区',
    '编辑地区名称与排序',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000116',
    'regions:enable',
    '启用地区',
    '启用地区节点',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000117',
    'regions:disable',
    '禁用地区',
    '禁用地区节点',
    false
  );

-- 普通业务权限不会被历史 system_only grant 自动覆盖，因此必须显式授予内置管理员。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  '00000000-0000-4000-8000-000000000001',
  "id"
FROM "permissions"
WHERE "code" IN (
  'regions:read',
  'regions:create',
  'regions:update',
  'regions:enable',
  'regions:disable'
);

COMMIT;
