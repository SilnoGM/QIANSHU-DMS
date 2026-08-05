BEGIN;

-- ExtendAuditEventType
-- 新 enum 值在本事务提交前不可直接转换为 audit_event_type，因此只通过
-- pg_enum 的文本值完成迁移自检。
ALTER TYPE "audit_event_type" ADD VALUE 'SUPPLIER_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'SUPPLIER_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE 'SUPPLIER_ENABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'SUPPLIER_DISABLED';

-- CreateEnum
CREATE TYPE "supplier_entity_type" AS ENUM (
  'ORGANIZATION',
  'INDIVIDUAL'
);

-- CreateTable
CREATE TABLE "suppliers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "numbering_issuance_id" UUID NOT NULL,
  "legal_name" VARCHAR(200) NOT NULL,
  "normalized_legal_name" VARCHAR(200) NOT NULL,
  "short_name" VARCHAR(100),
  "normalized_short_name" VARCHAR(100),
  "entity_type" "supplier_entity_type" NOT NULL,
  "registration_country_region_id" UUID,
  "registration_number" VARCHAR(64),
  "normalized_registration_number" VARCHAR(64),
  "contact_name" VARCHAR(128),
  "normalized_contact_name" VARCHAR(128),
  "contact_phone" VARCHAR(32),
  "normalized_contact_phone" VARCHAR(32),
  "contact_wechat_id" VARCHAR(64),
  "normalized_contact_wechat_id" VARCHAR(64),
  "address_country_region_id" UUID,
  "address_province_state_id" UUID,
  "address_city_id" UUID,
  "address_line" VARCHAR(500),
  "postal_code" VARCHAR(32),
  "remark" VARCHAR(1000),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "suppliers_code_nonblank_check"
    CHECK ("code" !~ '^[[:space:]]*$'),
  CONSTRAINT "suppliers_legal_name_nonblank_check"
    CHECK ("legal_name" !~ '^[[:space:]]*$'),
  CONSTRAINT "suppliers_normalized_legal_name_nonblank_check"
    CHECK ("normalized_legal_name" !~ '^[[:space:]]*$'),
  CONSTRAINT "suppliers_short_name_shape_check"
    CHECK (
      ("short_name" IS NULL AND "normalized_short_name" IS NULL)
      OR (
        "short_name" IS NOT NULL
        AND "normalized_short_name" IS NOT NULL
        AND "short_name" !~ '^[[:space:]]*$'
        AND "normalized_short_name" !~ '^[[:space:]]*$'
      )
    ),
  CONSTRAINT "suppliers_registration_shape_check"
    CHECK (
      (
        "registration_country_region_id" IS NULL
        AND "registration_number" IS NULL
        AND "normalized_registration_number" IS NULL
      )
      OR (
        "registration_country_region_id" IS NOT NULL
        AND "registration_number" IS NOT NULL
        AND "normalized_registration_number" IS NOT NULL
        AND "registration_number" !~ '^[[:space:]]*$'
        AND "normalized_registration_number" !~ '^[[:space:]]*$'
      )
    ),
  CONSTRAINT "suppliers_contact_name_shape_check"
    CHECK (
      ("contact_name" IS NULL AND "normalized_contact_name" IS NULL)
      OR (
        "contact_name" IS NOT NULL
        AND "normalized_contact_name" IS NOT NULL
        AND "contact_name" !~ '^[[:space:]]*$'
        AND "normalized_contact_name" !~ '^[[:space:]]*$'
      )
    ),
  CONSTRAINT "suppliers_contact_phone_shape_check"
    CHECK (
      ("contact_phone" IS NULL AND "normalized_contact_phone" IS NULL)
      OR (
        "contact_phone" IS NOT NULL
        AND "normalized_contact_phone" IS NOT NULL
        AND "contact_phone" !~ '^[[:space:]]*$'
        AND "normalized_contact_phone" !~ '^[[:space:]]*$'
      )
    ),
  CONSTRAINT "suppliers_contact_wechat_shape_check"
    CHECK (
      ("contact_wechat_id" IS NULL AND "normalized_contact_wechat_id" IS NULL)
      OR (
        "contact_wechat_id" IS NOT NULL
        AND "normalized_contact_wechat_id" IS NOT NULL
        AND "contact_wechat_id" !~ '^[[:space:]]*$'
        AND "normalized_contact_wechat_id" !~ '^[[:space:]]*$'
      )
    ),
  CONSTRAINT "suppliers_address_region_prefix_check"
    CHECK (
      (
        "address_country_region_id" IS NULL
        AND "address_province_state_id" IS NULL
        AND "address_city_id" IS NULL
      )
      OR (
        "address_country_region_id" IS NOT NULL
        AND "address_province_state_id" IS NULL
        AND "address_city_id" IS NULL
      )
      OR (
        "address_country_region_id" IS NOT NULL
        AND "address_province_state_id" IS NOT NULL
        AND "address_city_id" IS NULL
      )
      OR (
        "address_country_region_id" IS NOT NULL
        AND "address_province_state_id" IS NOT NULL
        AND "address_city_id" IS NOT NULL
      )
    ),
  CONSTRAINT "suppliers_address_line_nonblank_check"
    CHECK ("address_line" IS NULL OR "address_line" !~ '^[[:space:]]*$'),
  CONSTRAINT "suppliers_postal_code_nonblank_check"
    CHECK ("postal_code" IS NULL OR "postal_code" !~ '^[[:space:]]*$'),
  CONSTRAINT "suppliers_remark_nonblank_check"
    CHECK ("remark" IS NULL OR "remark" !~ '^[[:space:]]*$'),
  CONSTRAINT "suppliers_enable_requirements_check"
    CHECK (
      "enabled" = false
      OR (
        "contact_name" IS NOT NULL
        AND "normalized_contact_name" IS NOT NULL
        AND (
          "contact_phone" IS NOT NULL
          OR "contact_wechat_id" IS NOT NULL
        )
      )
    ),
  CONSTRAINT "suppliers_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_create_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "idempotency_scope_hash" BYTEA NOT NULL,
  "request_fingerprint_hash" BYTEA NOT NULL,
  "supplier_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "supplier_create_requests_idempotency_scope_hash_32_bytes_check"
    CHECK (octet_length("idempotency_scope_hash") = 32),
  CONSTRAINT "supplier_create_requests_request_fingerprint_hash_32_bytes_check"
    CHECK (octet_length("request_fingerprint_hash") = 32),
  CONSTRAINT "supplier_create_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key"
  ON "suppliers"("code");
CREATE UNIQUE INDEX "suppliers_numbering_issuance_id_key"
  ON "suppliers"("numbering_issuance_id");
CREATE UNIQUE INDEX "suppliers_registration_country_number_key"
  ON "suppliers"(
    "registration_country_region_id",
    "normalized_registration_number"
  );
CREATE INDEX "suppliers_enabled_updated_at_id_idx"
  ON "suppliers"("enabled", "updated_at" DESC, "id" DESC);
CREATE INDEX "suppliers_entity_type_updated_at_id_idx"
  ON "suppliers"("entity_type", "updated_at" DESC, "id" DESC);
CREATE INDEX "suppliers_normalized_legal_name_pattern_idx"
  ON "suppliers"("normalized_legal_name" varchar_pattern_ops);
CREATE INDEX "suppliers_normalized_short_name_pattern_idx"
  ON "suppliers"("normalized_short_name" varchar_pattern_ops);
CREATE UNIQUE INDEX "supplier_create_requests_idempotency_scope_hash_key"
  ON "supplier_create_requests"("idempotency_scope_hash");
CREATE UNIQUE INDEX "supplier_create_requests_supplier_id_key"
  ON "supplier_create_requests"("supplier_id");

-- AddForeignKey
ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_numbering_issuance_id_fkey"
  FOREIGN KEY ("numbering_issuance_id")
  REFERENCES "numbering_issuances"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_registration_country_region_id_fkey"
  FOREIGN KEY ("registration_country_region_id")
  REFERENCES "regions"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_address_country_region_id_fkey"
  FOREIGN KEY ("address_country_region_id")
  REFERENCES "regions"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_address_province_state_id_fkey"
  FOREIGN KEY ("address_province_state_id")
  REFERENCES "regions"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_address_city_id_fkey"
  FOREIGN KEY ("address_city_id")
  REFERENCES "regions"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "supplier_create_requests"
  ADD CONSTRAINT "supplier_create_requests_supplier_id_fkey"
  FOREIGN KEY ("supplier_id")
  REFERENCES "suppliers"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CreateFunction
CREATE FUNCTION "enforce_supplier_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  provenance_valid BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'suppliers_delete_check',
      MESSAGE = 'suppliers cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."code" IS DISTINCT FROM OLD."code"
      OR NEW."numbering_issuance_id" IS DISTINCT FROM OLD."numbering_issuance_id"
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'suppliers_identity_immutable_check',
      MESSAGE = 'supplier identity is immutable';
  END IF;

  SELECT true
  INTO provenance_valid
  FROM "numbering_issuances" AS issuance
  JOIN "numbering_rules" AS rule
    ON rule."id" = issuance."rule_id"
  WHERE issuance."id" = NEW."numbering_issuance_id"
    AND rule."rule_code" = 'SUPPLIER'
    AND issuance."consumer_code" = 'SUPPLIER.CREATE'
    AND issuance."generated_number" = NEW."code"
  FOR KEY SHARE OF issuance, rule;

  IF provenance_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'suppliers_numbering_provenance_check',
      MESSAGE = 'supplier numbering provenance is invalid';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION "enforce_supplier_create_request_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'supplier_create_requests_delete_check',
      MESSAGE = 'supplier create requests cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."idempotency_scope_hash" IS DISTINCT FROM OLD."idempotency_scope_hash"
    OR NEW."request_fingerprint_hash" IS DISTINCT FROM OLD."request_fingerprint_hash"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR (
      OLD."supplier_id" IS NOT NULL
      AND NEW."supplier_id" IS DISTINCT FROM OLD."supplier_id"
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'supplier_create_requests_immutable_check',
      MESSAGE = 'supplier create request identity and completion are immutable';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "suppliers_invariants_trigger"
BEFORE INSERT OR UPDATE OF "id", "code", "numbering_issuance_id" OR DELETE
ON "suppliers"
FOR EACH ROW
EXECUTE FUNCTION "enforce_supplier_invariants"();

CREATE TRIGGER "supplier_create_requests_invariants_trigger"
BEFORE UPDATE OF "id", "idempotency_scope_hash", "request_fingerprint_hash", "supplier_id", "created_at" OR DELETE
ON "supplier_create_requests"
FOR EACH ROW
EXECUTE FUNCTION "enforce_supplier_create_request_invariants"();

-- SeedPermissions
-- 权限目录属于访问治理边界；本 migration 不写任何 Supplier 业务数据。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000138',
    'suppliers:read',
    '查询供应商',
    '查看供应商列表与详情',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000139',
    'suppliers:create',
    '创建供应商',
    '创建停用状态的供应商主数据',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000140',
    'suppliers:update',
    '编辑供应商',
    '编辑供应商基础信息',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000141',
    'suppliers:enable',
    '启用供应商',
    '启用满足合作要求的供应商',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000142',
    'suppliers:disable',
    '停用供应商',
    '停用供应商并保留历史主数据',
    false
  );

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" IN (
    '00000000-0000-4000-8000-000000000138',
    '00000000-0000-4000-8000-000000000139',
    '00000000-0000-4000-8000-000000000140',
    '00000000-0000-4000-8000-000000000141',
    '00000000-0000-4000-8000-000000000142'
  )
  AND permission."code" IN (
    'suppliers:read',
    'suppliers:create',
    'suppliers:update',
    'suppliers:enable',
    'suppliers:disable'
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
    AND table_entry.relname IN ('suppliers', 'supplier_create_requests');

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'supplier migration invariant mismatch: table count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_constraint AS constraint_entry
  WHERE constraint_entry.conrelid IN (
    'suppliers'::regclass,
    'supplier_create_requests'::regclass
  );

  IF actual_count <> 24 THEN
    RAISE EXCEPTION 'supplier migration invariant mismatch: constraint count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_class AS index_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = index_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND index_entry.relkind = 'i'
    AND index_entry.relname = ANY(ARRAY[
      'suppliers_code_key',
      'suppliers_numbering_issuance_id_key',
      'suppliers_registration_country_number_key',
      'suppliers_enabled_updated_at_id_idx',
      'suppliers_entity_type_updated_at_id_idx',
      'suppliers_normalized_legal_name_pattern_idx',
      'suppliers_normalized_short_name_pattern_idx',
      'supplier_create_requests_idempotency_scope_hash_key',
      'supplier_create_requests_supplier_id_key'
    ]);

  IF actual_count <> 9 THEN
    RAISE EXCEPTION 'supplier migration invariant mismatch: index count';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_proc AS procedure_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = procedure_entry.pronamespace
  WHERE namespace_entry.nspname = current_schema()
    AND procedure_entry.proname IN (
      'enforce_supplier_invariants',
      'enforce_supplier_create_request_invariants'
    );

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'supplier migration invariant mismatch: function count';
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
      'suppliers_invariants_trigger',
      'supplier_create_requests_invariants_trigger'
    );

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'supplier migration invariant mismatch: trigger count';
  END IF;

  SELECT array_agg(enum_entry.enumlabel::text ORDER BY enum_entry.enumsortorder)
  INTO actual_values
  FROM pg_enum AS enum_entry
  JOIN pg_type AS type_entry
    ON type_entry.oid = enum_entry.enumtypid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = type_entry.typnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND type_entry.typname = 'supplier_entity_type';

  IF actual_values IS DISTINCT FROM ARRAY['ORGANIZATION', 'INDIVIDUAL'] THEN
    RAISE EXCEPTION 'supplier migration invariant mismatch: entity type enum';
  END IF;

  WITH expected_permission("id", "code") AS (
    VALUES
      ('00000000-0000-4000-8000-000000000138'::uuid, 'suppliers:read'),
      ('00000000-0000-4000-8000-000000000139'::uuid, 'suppliers:create'),
      ('00000000-0000-4000-8000-000000000140'::uuid, 'suppliers:update'),
      ('00000000-0000-4000-8000-000000000141'::uuid, 'suppliers:enable'),
      ('00000000-0000-4000-8000-000000000142'::uuid, 'suppliers:disable')
  )
  SELECT count(*)::integer
  INTO actual_count
  FROM expected_permission AS expected
  JOIN "permissions" AS permission
    ON permission."id" = expected."id"
    AND permission."code" = expected."code"
    AND permission."system_only" = false;

  IF actual_count <> 5
    OR (SELECT count(*) FROM "permissions" WHERE "code" LIKE 'suppliers:%') <> 5
  THEN
    RAISE EXCEPTION 'supplier migration invariant mismatch: permission catalog';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role
    ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission
    ON permission."id" = grant_entry."permission_id"
  WHERE role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin'
    AND permission."code" LIKE 'suppliers:%';

  IF actual_count <> 5 THEN
    RAISE EXCEPTION 'supplier migration invariant mismatch: system admin grants';
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
    AND enum_entry.enumlabel LIKE 'SUPPLIER_%';

  IF actual_values IS DISTINCT FROM ARRAY[
    'SUPPLIER_CREATED',
    'SUPPLIER_DISABLED',
    'SUPPLIER_ENABLED',
    'SUPPLIER_UPDATED'
  ] THEN
    RAISE EXCEPTION 'supplier migration invariant mismatch: audit event count';
  END IF;

  SELECT count(*)::integer INTO actual_count FROM "suppliers";
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'supplier migration invariant mismatch: supplier seed';
  END IF;

  SELECT count(*)::integer INTO actual_count FROM "supplier_create_requests";
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'supplier migration invariant mismatch: create request seed';
  END IF;
END;
$$;

COMMIT;
