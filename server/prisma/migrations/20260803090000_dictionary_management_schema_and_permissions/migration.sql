BEGIN;

-- ExtendAuditEventType
-- PostgreSQL 不允许在同一事务提交前使用刚追加到既有 enum 的值；本 migration
-- 只通过 pg_enum.enumlabel 文本自检，新值留给提交后的运行时代码使用。
ALTER TYPE "audit_event_type" ADD VALUE 'DICTIONARY_TYPE_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'DICTIONARY_TYPE_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE 'DICTIONARY_TYPE_ENABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'DICTIONARY_TYPE_DISABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'DICTIONARY_ITEM_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'DICTIONARY_ITEM_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE 'DICTIONARY_ITEM_ENABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'DICTIONARY_ITEM_DISABLED';

-- CreateEnum
CREATE TYPE "dictionary_tone" AS ENUM (
  'DEFAULT',
  'PRIMARY',
  'SUCCESS',
  'WARNING',
  'DANGER',
  'INFO'
);

-- CreateTable
CREATE TABLE "dictionary_types" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "description" VARCHAR(500),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dictionary_types_code_format_check"
    CHECK ("code" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT "dictionary_types_name_nonblank_check"
    CHECK ("name" !~ '^[[:space:]]*$'),
  CONSTRAINT "dictionary_types_description_nonblank_check"
    CHECK (
      "description" IS NULL
      OR "description" !~ '^[[:space:]]*$'
    ),
  CONSTRAINT "dictionary_types_sort_order_nonnegative_check"
    CHECK ("sort_order" BETWEEN 0 AND 2147483647),
  CONSTRAINT "dictionary_types_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "dictionary_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dictionary_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dictionary_type_id" UUID NOT NULL,
  "value" VARCHAR(64) NOT NULL,
  "label" VARCHAR(128) NOT NULL,
  "description" VARCHAR(500),
  "tone" "dictionary_tone" NOT NULL DEFAULT 'DEFAULT',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dictionary_items_value_format_check"
    CHECK ("value" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
  CONSTRAINT "dictionary_items_label_nonblank_check"
    CHECK ("label" !~ '^[[:space:]]*$'),
  CONSTRAINT "dictionary_items_description_nonblank_check"
    CHECK (
      "description" IS NULL
      OR "description" !~ '^[[:space:]]*$'
    ),
  CONSTRAINT "dictionary_items_sort_order_nonnegative_check"
    CHECK ("sort_order" BETWEEN 0 AND 2147483647),
  CONSTRAINT "dictionary_items_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "dictionary_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_types_code_key"
  ON "dictionary_types"("code");
CREATE INDEX "dictionary_types_sort_order_code_id_idx"
  ON "dictionary_types"("sort_order", "code", "id");
CREATE INDEX "dictionary_types_enabled_sort_order_code_id_idx"
  ON "dictionary_types"("enabled", "sort_order", "code", "id");
CREATE UNIQUE INDEX "dictionary_items_dictionary_type_id_value_key"
  ON "dictionary_items"("dictionary_type_id", "value");
CREATE INDEX "dictionary_items_type_id_sort_order_value_id_idx"
  ON "dictionary_items"("dictionary_type_id", "sort_order", "value", "id");
CREATE INDEX "dictionary_items_type_id_enabled_sort_order_value_id_idx"
  ON "dictionary_items"(
    "dictionary_type_id",
    "enabled",
    "sort_order",
    "value",
    "id"
  );

-- AddForeignKey
ALTER TABLE "dictionary_items"
  ADD CONSTRAINT "dictionary_items_dictionary_type_id_fkey"
  FOREIGN KEY ("dictionary_type_id")
  REFERENCES "dictionary_types"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CreateFunction
CREATE FUNCTION "enforce_dictionary_type_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'dictionary_types_delete_check',
      MESSAGE = 'dictionary types cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."code" IS DISTINCT FROM OLD."code"
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'dictionary_types_identity_immutable_check',
      MESSAGE = 'dictionary type identity is immutable';
  END IF;

  IF NEW."enabled" = true
    AND (
      TG_OP = 'INSERT'
      OR OLD."enabled" IS DISTINCT FROM NEW."enabled"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "dictionary_items"
      WHERE "dictionary_type_id" = NEW."id"
        AND "enabled" = true
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'dictionary_types_enabled_item_required_check',
      MESSAGE = 'enabled dictionary type requires an enabled item';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION "enforce_dictionary_item_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_enabled BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'dictionary_items_delete_check',
      MESSAGE = 'dictionary items cannot be deleted';
  END IF;

  -- 先冻结稳定身份，再查询父 Type，保证非法移动始终返回约定诊断名。
  IF TG_OP = 'UPDATE'
    AND (
      NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."dictionary_type_id" IS DISTINCT FROM OLD."dictionary_type_id"
      OR NEW."value" IS DISTINCT FROM OLD."value"
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'dictionary_items_identity_immutable_check',
      MESSAGE = 'dictionary item identity is immutable';
  END IF;

  -- 所有 Item 身份或状态写都遵守 Type -> Item 锁序，与 Type 启用检查互斥。
  SELECT "enabled"
  INTO parent_enabled
  FROM "dictionary_types"
  WHERE "id" = NEW."dictionary_type_id"
  FOR UPDATE;

  IF TG_OP = 'UPDATE'
    AND OLD."enabled" = true
    AND NEW."enabled" = false
    AND parent_enabled = true
    AND NOT EXISTS (
      SELECT 1
      FROM "dictionary_items"
      WHERE "dictionary_type_id" = NEW."dictionary_type_id"
        AND "id" <> OLD."id"
        AND "enabled" = true
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'dictionary_items_last_enabled_check',
      MESSAGE = 'enabled dictionary type requires an enabled item';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "dictionary_types_invariants_trigger"
BEFORE INSERT OR UPDATE OF "id", "code", "enabled" OR DELETE
ON "dictionary_types"
FOR EACH ROW
EXECUTE FUNCTION "enforce_dictionary_type_invariants"();

CREATE TRIGGER "dictionary_items_invariants_trigger"
BEFORE INSERT OR UPDATE OF "id", "dictionary_type_id", "value", "enabled" OR DELETE
ON "dictionary_items"
FOR EACH ROW
EXECUTE FUNCTION "enforce_dictionary_item_invariants"();

-- SeedPermissions
-- 权限属于访问治理目录，不是业务字典种子；稳定 ID 与 code 必须成对审计。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000133',
    'dictionaries:read',
    '查询系统字典',
    '查看系统字典类型与条目',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000134',
    'dictionaries:create',
    '创建系统字典',
    '创建系统字典类型与条目',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000135',
    'dictionaries:update',
    '编辑系统字典',
    '编辑系统字典类型与条目',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000136',
    'dictionaries:enable',
    '启用系统字典',
    '启用系统字典类型与条目',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000137',
    'dictionaries:disable',
    '停用系统字典',
    '停用系统字典类型与条目',
    false
  );

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" IN (
    '00000000-0000-4000-8000-000000000133',
    '00000000-0000-4000-8000-000000000134',
    '00000000-0000-4000-8000-000000000135',
    '00000000-0000-4000-8000-000000000136',
    '00000000-0000-4000-8000-000000000137'
  )
  AND permission."code" IN (
    'dictionaries:read',
    'dictionaries:create',
    'dictionaries:update',
    'dictionaries:enable',
    'dictionaries:disable'
  );

-- MigrationSelfCheck
DO $$
DECLARE
  actual_count INTEGER;
  actual_values TEXT[];
BEGIN
  SELECT count(*)::integer
  INTO actual_count
  FROM pg_class AS table_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = table_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND table_entry.relkind = 'r'
    AND table_entry.relname IN ('dictionary_types', 'dictionary_items');

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: table count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_constraint AS constraint_entry
  WHERE constraint_entry.conrelid IN (
    'dictionary_types'::regclass,
    'dictionary_items'::regclass
  );

  IF actual_count <> 13 THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: constraint count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_constraint AS constraint_entry
  WHERE constraint_entry.conrelid IN (
    'dictionary_types'::regclass,
    'dictionary_items'::regclass
  )
    AND constraint_entry.conname = ANY(ARRAY[
      'dictionary_types_pkey',
      'dictionary_types_code_format_check',
      'dictionary_types_name_nonblank_check',
      'dictionary_types_description_nonblank_check',
      'dictionary_types_sort_order_nonnegative_check',
      'dictionary_types_version_positive_check',
      'dictionary_items_pkey',
      'dictionary_items_value_format_check',
      'dictionary_items_label_nonblank_check',
      'dictionary_items_description_nonblank_check',
      'dictionary_items_sort_order_nonnegative_check',
      'dictionary_items_version_positive_check',
      'dictionary_items_dictionary_type_id_fkey'
    ]);

  IF actual_count <> 13 THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: constraint count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_class AS index_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = index_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND index_entry.relkind = 'i'
    AND index_entry.relname = ANY(ARRAY[
      'dictionary_types_code_key',
      'dictionary_types_sort_order_code_id_idx',
      'dictionary_types_enabled_sort_order_code_id_idx',
      'dictionary_items_dictionary_type_id_value_key',
      'dictionary_items_type_id_sort_order_value_id_idx',
      'dictionary_items_type_id_enabled_sort_order_value_id_idx'
    ]);

  IF actual_count <> 6 THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: index count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_proc AS procedure_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = procedure_entry.pronamespace
  WHERE namespace_entry.nspname = current_schema()
    AND procedure_entry.proname LIKE 'enforce_dictionary_%'
    AND procedure_entry.proname IN (
      'enforce_dictionary_type_invariants',
      'enforce_dictionary_item_invariants'
    );

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: function count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_trigger AS trigger_entry
  JOIN pg_class AS table_entry
    ON table_entry.oid = trigger_entry.tgrelid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = table_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND NOT trigger_entry.tgisinternal
    AND trigger_entry.tgname IN (
      'dictionary_types_invariants_trigger',
      'dictionary_items_invariants_trigger'
    );

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: trigger count';
  END IF;

  SELECT array_agg(enum_entry.enumlabel::text ORDER BY enum_entry.enumsortorder)
  INTO actual_values
  FROM pg_enum AS enum_entry
  JOIN pg_type AS type_entry
    ON type_entry.oid = enum_entry.enumtypid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = type_entry.typnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND type_entry.typname = 'dictionary_tone';

  IF actual_values IS DISTINCT FROM ARRAY[
    'DEFAULT',
    'PRIMARY',
    'SUCCESS',
    'WARNING',
    'DANGER',
    'INFO'
  ] THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: tone enum count';
  END IF;

  WITH expected_permission("id", "code") AS (
    VALUES
      ('00000000-0000-4000-8000-000000000133'::uuid, 'dictionaries:read'),
      ('00000000-0000-4000-8000-000000000134'::uuid, 'dictionaries:create'),
      ('00000000-0000-4000-8000-000000000135'::uuid, 'dictionaries:update'),
      ('00000000-0000-4000-8000-000000000136'::uuid, 'dictionaries:enable'),
      ('00000000-0000-4000-8000-000000000137'::uuid, 'dictionaries:disable')
  )
  SELECT count(*)::integer
  INTO actual_count
  FROM expected_permission AS expected
  JOIN "permissions" AS permission
    ON permission."id" = expected."id"
    AND permission."code" = expected."code"
    AND permission."system_only" = false;

  IF actual_count <> 5
    OR (SELECT count(*) FROM "permissions" WHERE "code" LIKE 'dictionaries:%') <> 5
  THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: permission catalog';
  END IF;

  WITH expected_permission("id", "code") AS (
    VALUES
      ('00000000-0000-4000-8000-000000000133'::uuid, 'dictionaries:read'),
      ('00000000-0000-4000-8000-000000000134'::uuid, 'dictionaries:create'),
      ('00000000-0000-4000-8000-000000000135'::uuid, 'dictionaries:update'),
      ('00000000-0000-4000-8000-000000000136'::uuid, 'dictionaries:enable'),
      ('00000000-0000-4000-8000-000000000137'::uuid, 'dictionaries:disable')
  )
  SELECT count(*)::integer
  INTO actual_count
  FROM expected_permission AS expected
  JOIN "permissions" AS permission
    ON permission."id" = expected."id"
    AND permission."code" = expected."code"
  JOIN "role_permissions" AS grant_entry
    ON grant_entry."permission_id" = permission."id"
  JOIN "roles" AS role
    ON role."id" = grant_entry."role_id"
  WHERE role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin';

  IF actual_count <> 5 THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: system admin grants';
  END IF;

  SELECT array_agg(enum_entry.enumlabel::text ORDER BY enum_entry.enumlabel)
  INTO actual_values
  FROM pg_enum AS enum_entry
  JOIN pg_type AS type_entry
    ON type_entry.oid = enum_entry.enumtypid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = type_entry.typnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND type_entry.typname = 'audit_event_type'
    AND enum_entry.enumlabel LIKE 'DICTIONARY_%';

  IF actual_values IS DISTINCT FROM ARRAY[
    'DICTIONARY_ITEM_CREATED',
    'DICTIONARY_ITEM_DISABLED',
    'DICTIONARY_ITEM_ENABLED',
    'DICTIONARY_ITEM_UPDATED',
    'DICTIONARY_TYPE_CREATED',
    'DICTIONARY_TYPE_DISABLED',
    'DICTIONARY_TYPE_ENABLED',
    'DICTIONARY_TYPE_UPDATED'
  ] THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: audit event count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "dictionary_types";

  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: default type seed';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "dictionary_items";

  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'dictionary migration invariant mismatch: default item seed';
  END IF;
END;
$$;

COMMIT;
