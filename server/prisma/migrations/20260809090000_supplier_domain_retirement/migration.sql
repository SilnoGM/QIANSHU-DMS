BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- 固定取得全部退役对象的写锁，避免检查结果与后续删除之间发生并发漂移。
LOCK TABLE "supplier_create_requests" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "suppliers" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "numbering_rules" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "numbering_rule_versions" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "numbering_rule_segments" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "numbering_period_states" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "numbering_issuances" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "audit_events" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "permissions" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "role_permissions" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "dictionary_types" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "dictionary_items" IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE "supplier_retirement_snapshot" (
  "supplier_rule_id" UUID,
  "protected_rule_count" BIGINT NOT NULL,
  "protected_version_count" BIGINT NOT NULL,
  "protected_segment_count" BIGINT NOT NULL,
  "protected_period_state_count" BIGINT NOT NULL,
  "protected_issuance_count" BIGINT NOT NULL,
  "protected_audit_count" BIGINT NOT NULL
) ON COMMIT DROP;

-- 任何历史结构、固定身份或语义漂移都必须在写入前终止整个事务。
DO $$
DECLARE
  actual_count INTEGER;
  actual_values TEXT[];
  supplier_rule_id UUID;
BEGIN
  SELECT count(*)::integer
  INTO actual_count
  FROM pg_class AS table_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = table_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND table_entry.relkind = 'r'
    AND table_entry.relname IN ('supplier_create_requests', 'suppliers');

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'supplier retirement precondition mismatch: tables';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_proc AS procedure_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = procedure_entry.pronamespace
  WHERE namespace_entry.nspname = current_schema()
    AND procedure_entry.pronargs = 0
    AND procedure_entry.prorettype = 'trigger'::regtype
    AND procedure_entry.proname IN (
      'enforce_supplier_create_request_invariants',
      'enforce_supplier_invariants'
    );

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'supplier retirement precondition mismatch: functions';
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
    AND trigger_entry.tgenabled = 'O'
    AND (
      (
        trigger_entry.tgname = 'suppliers_invariants_trigger'
        AND table_entry.relname = 'suppliers'
        AND trigger_entry.tgfoid =
          'enforce_supplier_invariants()'::regprocedure
      )
      OR (
        trigger_entry.tgname = 'supplier_create_requests_invariants_trigger'
        AND table_entry.relname = 'supplier_create_requests'
        AND trigger_entry.tgfoid =
          'enforce_supplier_create_request_invariants()'::regprocedure
      )
    );

  IF actual_count <> 2 THEN
    RAISE EXCEPTION 'supplier retirement precondition mismatch: triggers';
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
    AND table_entry.relname IN ('supplier_create_requests', 'suppliers');

  IF actual_count <> 2 THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: supplier trigger surface';
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
    RAISE EXCEPTION 'supplier retirement precondition mismatch: entity type';
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
    AND permission."code" = expected."code";

  IF actual_count <> 5
    OR (
      SELECT count(*)
      FROM "permissions"
      WHERE "id" IN (
        '00000000-0000-4000-8000-000000000138'::uuid,
        '00000000-0000-4000-8000-000000000139'::uuid,
        '00000000-0000-4000-8000-000000000140'::uuid,
        '00000000-0000-4000-8000-000000000141'::uuid,
        '00000000-0000-4000-8000-000000000142'::uuid
      )
      OR "code" LIKE 'suppliers:%'
    ) <> 5
  THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: permission identity';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "dictionary_types"
  WHERE "id" = '00000000-0000-4000-8000-000000002001'::uuid
    OR "code" = 'service_provider.supplier';

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: dictionary identity occupied';
  END IF;

  SELECT array_agg(enum_entry.enumlabel::text ORDER BY enum_entry.enumsortorder)
  INTO actual_values
  FROM pg_enum AS enum_entry
  JOIN pg_type AS type_entry
    ON type_entry.oid = enum_entry.enumtypid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = type_entry.typnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND type_entry.typname = 'audit_event_type';

  IF actual_values IS DISTINCT FROM ARRAY[
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
    'AUTH_RETENTION_PURGED',
    'REGION_CREATED',
    'REGION_UPDATED',
    'REGION_ENABLED',
    'REGION_DISABLED',
    'CURRENCY_CREATED',
    'CURRENCY_UPDATED',
    'CURRENCY_ENABLED',
    'CURRENCY_DISABLED',
    'EXCHANGE_RATE_CREATED',
    'EXCHANGE_RATE_UPDATED',
    'NUMBERING_RULE_CREATED',
    'NUMBERING_RULE_UPDATED',
    'NUMBERING_RULE_VERSION_PUBLISHED',
    'NUMBERING_RULE_ENABLED',
    'NUMBERING_RULE_DISABLED',
    'DICTIONARY_TYPE_CREATED',
    'DICTIONARY_TYPE_UPDATED',
    'DICTIONARY_TYPE_ENABLED',
    'DICTIONARY_TYPE_DISABLED',
    'DICTIONARY_ITEM_CREATED',
    'DICTIONARY_ITEM_UPDATED',
    'DICTIONARY_ITEM_ENABLED',
    'DICTIONARY_ITEM_DISABLED',
    'SUPPLIER_CREATED',
    'SUPPLIER_UPDATED',
    'SUPPLIER_ENABLED',
    'SUPPLIER_DISABLED'
  ] THEN
    RAISE EXCEPTION 'supplier retirement precondition mismatch: audit enum';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_type AS type_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = type_entry.typnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND type_entry.typname = 'audit_event_type_without_supplier';

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: temporary audit enum occupied';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_attribute AS attribute_entry
  JOIN pg_class AS table_entry
    ON table_entry.oid = attribute_entry.attrelid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = table_entry.relnamespace
  JOIN pg_type AS type_entry
    ON type_entry.oid = attribute_entry.atttypid
  WHERE namespace_entry.nspname = current_schema()
    AND table_entry.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND NOT attribute_entry.attisdropped
    AND (
      type_entry.typname = 'audit_event_type'
      OR type_entry.typname = '_audit_event_type'
    );

  IF actual_count <> 1
    OR (
      SELECT count(*)
      FROM pg_attribute AS attribute_entry
      JOIN pg_class AS table_entry
        ON table_entry.oid = attribute_entry.attrelid
      JOIN pg_namespace AS namespace_entry
        ON namespace_entry.oid = table_entry.relnamespace
      JOIN pg_type AS type_entry
        ON type_entry.oid = attribute_entry.atttypid
      WHERE namespace_entry.nspname = current_schema()
        AND table_entry.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND table_entry.relname = 'audit_events'
        AND attribute_entry.attname = 'event_type'
        AND NOT attribute_entry.attisdropped
        AND type_entry.typname = 'audit_event_type'
    ) <> 1
    OR (
      SELECT count(*)
      FROM pg_attrdef AS default_entry
      JOIN pg_attribute AS attribute_entry
        ON attribute_entry.attrelid = default_entry.adrelid
        AND attribute_entry.attnum = default_entry.adnum
      JOIN pg_type AS type_entry
        ON type_entry.oid = attribute_entry.atttypid
      JOIN pg_class AS table_entry
        ON table_entry.oid = attribute_entry.attrelid
      JOIN pg_namespace AS namespace_entry
        ON namespace_entry.oid = table_entry.relnamespace
      WHERE namespace_entry.nspname = current_schema()
        AND table_entry.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND type_entry.typname IN ('audit_event_type', '_audit_event_type')
    ) <> 0
    OR (
      SELECT count(*)
      FROM pg_proc AS procedure_entry
      JOIN pg_namespace AS namespace_entry
        ON namespace_entry.oid = procedure_entry.pronamespace
      WHERE namespace_entry.nspname = current_schema()
        AND (
          procedure_entry.prorettype = 'audit_event_type'::regtype
          OR 'audit_event_type'::regtype = ANY(procedure_entry.proargtypes)
        )
    ) <> 0
  THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: audit enum dependencies';
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
    AND trigger_entry.tgenabled = 'O'
    AND (
      (
        trigger_entry.tgname = 'numbering_issuances_immutability_trigger'
        AND table_entry.relname = 'numbering_issuances'
        AND trigger_entry.tgfoid =
          'enforce_numbering_issuance_immutability()'::regprocedure
      )
      OR (
        trigger_entry.tgname = 'numbering_rule_segments_parent_draft_trigger'
        AND table_entry.relname = 'numbering_rule_segments'
        AND trigger_entry.tgfoid =
          'enforce_numbering_rule_segment_parent_draft()'::regprocedure
      )
      OR (
        trigger_entry.tgname = 'numbering_rule_versions_invariants_trigger'
        AND table_entry.relname = 'numbering_rule_versions'
        AND trigger_entry.tgfoid =
          'enforce_numbering_rule_version_invariants()'::regprocedure
      )
      OR (
        trigger_entry.tgname = 'numbering_rules_invariants_trigger'
        AND table_entry.relname = 'numbering_rules'
        AND trigger_entry.tgfoid =
          'enforce_numbering_rule_invariants()'::regprocedure
      )
    );

  IF actual_count <> 4 THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: numbering triggers';
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
    AND table_entry.relname IN (
      'numbering_rules',
      'numbering_rule_versions',
      'numbering_rule_segments',
      'numbering_period_states',
      'numbering_issuances'
    );

  IF actual_count <> 4 THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: numbering trigger surface';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_constraint AS constraint_entry
  JOIN pg_class AS referenced_table
    ON referenced_table.oid = constraint_entry.confrelid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = referenced_table.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND constraint_entry.contype = 'f'
    AND referenced_table.relname IN (
      'numbering_rules',
      'numbering_rule_versions',
      'numbering_rule_segments',
      'numbering_period_states',
      'numbering_issuances'
    );

  IF actual_count <> 7
    OR (
      SELECT count(*)
      FROM pg_constraint AS constraint_entry
      JOIN pg_class AS source_table
        ON source_table.oid = constraint_entry.conrelid
      JOIN pg_namespace AS source_namespace
        ON source_namespace.oid = source_table.relnamespace
      JOIN pg_class AS referenced_table
        ON referenced_table.oid = constraint_entry.confrelid
      JOIN pg_namespace AS namespace_entry
        ON namespace_entry.oid = referenced_table.relnamespace
      JOIN LATERAL (
        SELECT array_agg(attribute_entry.attname::text
          ORDER BY key_entry.ordinality)
          AS "columns"
        FROM unnest(constraint_entry.conkey)
          WITH ORDINALITY AS key_entry("attnum", "ordinality")
        JOIN pg_attribute AS attribute_entry
          ON attribute_entry.attrelid = constraint_entry.conrelid
          AND attribute_entry.attnum = key_entry."attnum"
      ) AS source_key ON true
      JOIN LATERAL (
        SELECT array_agg(attribute_entry.attname::text
          ORDER BY key_entry.ordinality)
          AS "columns"
        FROM unnest(constraint_entry.confkey)
          WITH ORDINALITY AS key_entry("attnum", "ordinality")
        JOIN pg_attribute AS attribute_entry
          ON attribute_entry.attrelid = constraint_entry.confrelid
          AND attribute_entry.attnum = key_entry."attnum"
      ) AS referenced_key ON true
      JOIN (
        VALUES
          (
            'numbering_rule_versions_rule_id_fkey',
            'numbering_rule_versions',
            ARRAY['rule_id']::text[],
            'numbering_rules',
            ARRAY['id']::text[]
          ),
          (
            'numbering_rule_segments_version_id_fkey',
            'numbering_rule_segments',
            ARRAY['version_id']::text[],
            'numbering_rule_versions',
            ARRAY['id']::text[]
          ),
          (
            'numbering_period_states_rule_id_fkey',
            'numbering_period_states',
            ARRAY['rule_id']::text[],
            'numbering_rules',
            ARRAY['id']::text[]
          ),
          (
            'numbering_issuances_rule_id_fkey',
            'numbering_issuances',
            ARRAY['rule_id']::text[],
            'numbering_rules',
            ARRAY['id']::text[]
          ),
          (
            'numbering_issuances_rule_version_id_rule_id_fkey',
            'numbering_issuances',
            ARRAY['rule_version_id', 'rule_id']::text[],
            'numbering_rule_versions',
            ARRAY['id', 'rule_id']::text[]
          ),
          (
            'numbering_issuances_rule_id_period_key_fkey',
            'numbering_issuances',
            ARRAY['rule_id', 'period_key']::text[],
            'numbering_period_states',
            ARRAY['rule_id', 'period_key']::text[]
          ),
          (
            'suppliers_numbering_issuance_id_fkey',
            'suppliers',
            ARRAY['numbering_issuance_id']::text[],
            'numbering_issuances',
            ARRAY['id']::text[]
          )
      ) AS expected_constraint(
        "name",
        "source_table",
        "source_columns",
        "referenced_table",
        "referenced_columns"
      )
        ON expected_constraint."name" = constraint_entry.conname
        AND expected_constraint."source_table" = source_table.relname
        AND expected_constraint."source_columns" = source_key."columns"
        AND expected_constraint."referenced_table" = referenced_table.relname
        AND expected_constraint."referenced_columns" = referenced_key."columns"
      WHERE namespace_entry.nspname = current_schema()
        AND source_namespace.nspname = current_schema()
        AND constraint_entry.contype = 'f'
        AND constraint_entry.confdeltype = 'r'
        AND constraint_entry.confupdtype = 'r'
    ) <> 7
  THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: numbering dependencies';
  END IF;

  SELECT count(*)::integer, (array_agg("id" ORDER BY "id"))[1]
  INTO actual_count, supplier_rule_id
  FROM "numbering_rules"
  WHERE "rule_code" = 'SUPPLIER';

  IF actual_count > 1 THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: supplier rule cardinality';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "suppliers" AS supplier
  LEFT JOIN "numbering_issuances" AS issuance
    ON issuance."id" = supplier."numbering_issuance_id"
  WHERE supplier_rule_id IS NULL
    OR issuance."id" IS NULL
    OR issuance."rule_id" IS DISTINCT FROM supplier_rule_id
    OR issuance."consumer_code" <> 'SUPPLIER.CREATE'
    OR issuance."generated_number" <> supplier."code";

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: supplier numbering provenance';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "numbering_issuances" AS issuance
    WHERE issuance."consumer_code" LIKE 'SUPPLIER.%'
      AND issuance."rule_id" IS DISTINCT FROM supplier_rule_id
  ) THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: consumer identity drift';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_class AS table_entry
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = table_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND table_entry.relname IN (
      'supplier_create_requests',
      'suppliers',
      'numbering_rules',
      'numbering_rule_versions',
      'numbering_rule_segments',
      'numbering_period_states',
      'numbering_issuances',
      'audit_events',
      'permissions',
      'role_permissions',
      'dictionary_types',
      'dictionary_items'
    )
    AND (table_entry.relrowsecurity OR table_entry.relforcerowsecurity);

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: row level security';
  END IF;

  -- PostgreSQL Rule 会在解析阶段改写 DML，既不属于 Trigger 也不属于 FK。
  -- 因此所有本迁移会 INSERT/DELETE 的目标表都必须保持没有自定义 Rule，
  -- 防止退役写操作通过 DO ALSO/DO INSTEAD 暗中修改外部数据。
  SELECT count(*)::integer
  INTO actual_count
  FROM pg_rewrite AS rewrite_entry
  JOIN pg_class AS table_entry
    ON table_entry.oid = rewrite_entry.ev_class
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = table_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND rewrite_entry.rulename <> '_RETURN'
    AND table_entry.relname IN (
      'dictionary_types',
      'audit_events',
      'permissions',
      'role_permissions',
      'numbering_rules',
      'numbering_rule_versions',
      'numbering_rule_segments',
      'numbering_period_states',
      'numbering_issuances'
    );

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: mutation rules';
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
    AND table_entry.relname IN (
      'audit_events',
      'permissions',
      'role_permissions'
    );

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: mutation triggers';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_constraint AS constraint_entry
  JOIN pg_class AS referenced_table
    ON referenced_table.oid = constraint_entry.confrelid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = referenced_table.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND constraint_entry.contype = 'f'
    AND referenced_table.relname IN ('audit_events', 'role_permissions');

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: mutation dependencies';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_constraint AS constraint_entry
  JOIN pg_class AS source_table
    ON source_table.oid = constraint_entry.conrelid
  JOIN pg_namespace AS source_namespace
    ON source_namespace.oid = source_table.relnamespace
  JOIN pg_class AS referenced_table
    ON referenced_table.oid = constraint_entry.confrelid
  JOIN pg_namespace AS referenced_namespace
    ON referenced_namespace.oid = referenced_table.relnamespace
  WHERE referenced_namespace.nspname = current_schema()
    AND constraint_entry.contype = 'f'
    AND referenced_table.relname = 'permissions';

  IF actual_count <> 1
    OR (
      SELECT count(*)
      FROM pg_constraint AS constraint_entry
      JOIN pg_class AS source_table
        ON source_table.oid = constraint_entry.conrelid
      JOIN pg_namespace AS source_namespace
        ON source_namespace.oid = source_table.relnamespace
      JOIN pg_class AS referenced_table
        ON referenced_table.oid = constraint_entry.confrelid
      JOIN pg_namespace AS referenced_namespace
        ON referenced_namespace.oid = referenced_table.relnamespace
      WHERE source_namespace.nspname = current_schema()
        AND referenced_namespace.nspname = current_schema()
        AND constraint_entry.contype = 'f'
        AND constraint_entry.conname =
          'role_permissions_permission_id_fkey'
        AND source_table.relname = 'role_permissions'
        AND constraint_entry.conkey = ARRAY[
          (
            SELECT attribute_entry.attnum
            FROM pg_attribute AS attribute_entry
            WHERE attribute_entry.attrelid = source_table.oid
              AND attribute_entry.attname = 'permission_id'
          )
        ]::smallint[]
        AND referenced_table.relname = 'permissions'
        AND constraint_entry.confkey = ARRAY[
          (
            SELECT attribute_entry.attnum
            FROM pg_attribute AS attribute_entry
            WHERE attribute_entry.attrelid = referenced_table.oid
              AND attribute_entry.attname = 'id'
          )
        ]::smallint[]
        AND constraint_entry.confdeltype = 'c'
        AND constraint_entry.confupdtype = 'c'
    ) <> 1
  THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: permission dependency';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM pg_trigger AS trigger_entry
  JOIN pg_class AS table_entry
    ON table_entry.oid = trigger_entry.tgrelid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = table_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND table_entry.relname = 'dictionary_types'
    AND NOT trigger_entry.tgisinternal;

  IF actual_count <> 1
    OR (
      SELECT count(*)
      FROM pg_trigger AS trigger_entry
      JOIN pg_class AS table_entry
        ON table_entry.oid = trigger_entry.tgrelid
      JOIN pg_namespace AS namespace_entry
        ON namespace_entry.oid = table_entry.relnamespace
      WHERE namespace_entry.nspname = current_schema()
        AND table_entry.relname = 'dictionary_types'
        AND NOT trigger_entry.tgisinternal
        AND trigger_entry.tgname = 'dictionary_types_invariants_trigger'
        AND trigger_entry.tgenabled = 'O'
        AND trigger_entry.tgtype = 31
        AND trigger_entry.tgfoid =
          'enforce_dictionary_type_invariants()'::regprocedure
    ) <> 1
  THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: dictionary trigger';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "audit_events" AS audit_entry
    WHERE (
      audit_entry."event_type"::text LIKE 'SUPPLIER_%'
      AND (
        (
          audit_entry."target_type" IS NOT NULL
          AND audit_entry."target_type" <> 'Supplier'
        )
        OR (
          audit_entry."metadata" ->> 'ruleCode' IS NOT NULL
          AND audit_entry."metadata" ->> 'ruleCode' <> 'SUPPLIER'
        )
      )
    )
    OR (
      audit_entry."target_type" = 'NumberingRule'
      AND audit_entry."target_id" = supplier_rule_id::text
      AND audit_entry."metadata" ->> 'ruleCode' IS NOT NULL
      AND audit_entry."metadata" ->> 'ruleCode'
        NOT IN ('SUPPLIER', 'SUP')
    )
    -- `SUP` 仅代表目标 Rule 在改码前留下的历史 Audit 身份；事件类型、
    -- target type 与 target ID 任一不精确匹配时仍必须失败关闭。
    OR (
      audit_entry."metadata" ->> 'ruleCode' = 'SUP'
      AND (
        supplier_rule_id IS NULL
        OR audit_entry."event_type"::text NOT IN (
          'NUMBERING_RULE_CREATED',
          'NUMBERING_RULE_UPDATED',
          'NUMBERING_RULE_VERSION_PUBLISHED',
          'NUMBERING_RULE_ENABLED',
          'NUMBERING_RULE_DISABLED'
        )
        OR audit_entry."target_type" IS DISTINCT FROM 'NumberingRule'
        OR audit_entry."target_id"
          IS DISTINCT FROM supplier_rule_id::text
      )
    )
    OR (
      supplier_rule_id IS NOT NULL
      AND audit_entry."target_type" = 'NumberingRule'
      AND audit_entry."target_id" = supplier_rule_id::text
      AND audit_entry."event_type"::text NOT IN (
        'NUMBERING_RULE_CREATED',
        'NUMBERING_RULE_UPDATED',
        'NUMBERING_RULE_VERSION_PUBLISHED',
        'NUMBERING_RULE_ENABLED',
        'NUMBERING_RULE_DISABLED'
      )
    )
    OR (
      audit_entry."target_type" = 'Supplier'
      AND audit_entry."event_type"::text IN (
        'NUMBERING_RULE_CREATED',
        'NUMBERING_RULE_UPDATED',
        'NUMBERING_RULE_VERSION_PUBLISHED',
        'NUMBERING_RULE_ENABLED',
        'NUMBERING_RULE_DISABLED'
      )
    )
    OR (
      audit_entry."event_type"::text IN (
        'NUMBERING_RULE_CREATED',
        'NUMBERING_RULE_UPDATED',
        'NUMBERING_RULE_VERSION_PUBLISHED',
        'NUMBERING_RULE_ENABLED',
        'NUMBERING_RULE_DISABLED'
      )
      AND audit_entry."metadata" ->> 'ruleCode' = 'SUPPLIER'
      AND audit_entry."target_type" IS NOT NULL
      AND audit_entry."target_type" <> 'NumberingRule'
    )
    OR (
      supplier_rule_id IS NOT NULL
      AND
      audit_entry."target_type" = 'NumberingRule'
      AND audit_entry."metadata" ->> 'ruleCode' = 'SUPPLIER'
      AND audit_entry."target_id" IS DISTINCT FROM supplier_rule_id::text
    )
    OR (
      supplier_rule_id IS NULL
      AND audit_entry."target_type" = 'NumberingRule'
      AND audit_entry."metadata" ->> 'ruleCode' = 'SUPPLIER'
      AND EXISTS (
        SELECT 1
        FROM "numbering_rules" AS referenced_rule
        WHERE referenced_rule."id"::text = audit_entry."target_id"
      )
    )
    OR (
      audit_entry."event_type"::text IN (
        'NUMBERING_RULE_CREATED',
        'NUMBERING_RULE_UPDATED',
        'NUMBERING_RULE_VERSION_PUBLISHED',
        'NUMBERING_RULE_ENABLED',
        'NUMBERING_RULE_DISABLED'
      )
      AND audit_entry."metadata" ->> 'ruleCode' = 'SUPPLIER'
      AND EXISTS (
        SELECT 1
        FROM "numbering_rules" AS referenced_rule
        WHERE referenced_rule."id"::text = audit_entry."target_id"
          AND referenced_rule."id" IS DISTINCT FROM supplier_rule_id
      )
    )
  ) THEN
    RAISE EXCEPTION
      'supplier retirement precondition mismatch: audit identity drift';
  END IF;
END;
$$;

INSERT INTO "supplier_retirement_snapshot" (
  "supplier_rule_id",
  "protected_rule_count",
  "protected_version_count",
  "protected_segment_count",
  "protected_period_state_count",
  "protected_issuance_count",
  "protected_audit_count"
)
SELECT
  target."supplier_rule_id",
  (
    SELECT count(*)
    FROM "numbering_rules" AS rule
    WHERE rule."id" IS DISTINCT FROM target."supplier_rule_id"
  ),
  (
    SELECT count(*)
    FROM "numbering_rule_versions" AS version_entry
    WHERE version_entry."rule_id" IS DISTINCT FROM target."supplier_rule_id"
  ),
  (
    SELECT count(*)
    FROM "numbering_rule_segments" AS segment
    JOIN "numbering_rule_versions" AS version_entry
      ON version_entry."id" = segment."version_id"
    WHERE version_entry."rule_id" IS DISTINCT FROM target."supplier_rule_id"
  ),
  (
    SELECT count(*)
    FROM "numbering_period_states" AS period_state
    WHERE period_state."rule_id" IS DISTINCT FROM target."supplier_rule_id"
  ),
  (
    SELECT count(*)
    FROM "numbering_issuances" AS issuance
    WHERE issuance."rule_id" IS DISTINCT FROM target."supplier_rule_id"
  ),
  (
    SELECT count(*)
    FROM "audit_events" AS audit_entry
    WHERE (
      audit_entry."event_type"::text IN (
        'SUPPLIER_CREATED',
        'SUPPLIER_UPDATED',
        'SUPPLIER_ENABLED',
        'SUPPLIER_DISABLED'
      )
      OR COALESCE(audit_entry."target_type" = 'Supplier', false)
      OR (
        target."supplier_rule_id" IS NOT NULL
        AND audit_entry."target_type" = 'NumberingRule'
        AND audit_entry."target_id" = target."supplier_rule_id"::text
      )
      OR (
        audit_entry."event_type"::text IN (
          'NUMBERING_RULE_CREATED',
          'NUMBERING_RULE_UPDATED',
          'NUMBERING_RULE_VERSION_PUBLISHED',
          'NUMBERING_RULE_ENABLED',
          'NUMBERING_RULE_DISABLED'
        )
        AND audit_entry."metadata" ->> 'ruleCode' = 'SUPPLIER'
      )
    ) IS NOT TRUE
  )
FROM (
  SELECT (array_agg("id" ORDER BY "id"))[1] AS "supplier_rule_id"
  FROM "numbering_rules"
  WHERE "rule_code" = 'SUPPLIER'
) AS target;

-- 只建立固定、停用且没有 Item 的字典身份，不伪造交互式 Audit。
INSERT INTO "dictionary_types" (
  "id",
  "code",
  "name",
  "description",
  "enabled",
  "sort_order",
  "version"
)
VALUES (
  '00000000-0000-4000-8000-000000002001',
  'service_provider.supplier',
  '供应商',
  '合作供方中的供应商列表',
  false,
  0,
  1
);

DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  '00000000-0000-4000-8000-000000000138'::uuid,
  '00000000-0000-4000-8000-000000000139'::uuid,
  '00000000-0000-4000-8000-000000000140'::uuid,
  '00000000-0000-4000-8000-000000000141'::uuid,
  '00000000-0000-4000-8000-000000000142'::uuid
);

DELETE FROM "permissions" AS permission
USING (
  VALUES
    ('00000000-0000-4000-8000-000000000138'::uuid, 'suppliers:read'),
    ('00000000-0000-4000-8000-000000000139'::uuid, 'suppliers:create'),
    ('00000000-0000-4000-8000-000000000140'::uuid, 'suppliers:update'),
    ('00000000-0000-4000-8000-000000000141'::uuid, 'suppliers:enable'),
    ('00000000-0000-4000-8000-000000000142'::uuid, 'suppliers:disable')
) AS retired_permission("id", "code")
WHERE permission."id" = retired_permission."id"
  AND permission."code" = retired_permission."code";

DELETE FROM "audit_events" AS audit_entry
USING "supplier_retirement_snapshot" AS snapshot
WHERE audit_entry."event_type"::text IN (
    'SUPPLIER_CREATED',
    'SUPPLIER_UPDATED',
    'SUPPLIER_ENABLED',
    'SUPPLIER_DISABLED'
  )
  OR audit_entry."target_type" = 'Supplier'
  OR (
    snapshot."supplier_rule_id" IS NOT NULL
    AND audit_entry."target_type" = 'NumberingRule'
    AND audit_entry."target_id" = snapshot."supplier_rule_id"::text
  )
  OR (
    audit_entry."event_type"::text IN (
      'NUMBERING_RULE_CREATED',
      'NUMBERING_RULE_UPDATED',
      'NUMBERING_RULE_VERSION_PUBLISHED',
      'NUMBERING_RULE_ENABLED',
      'NUMBERING_RULE_DISABLED'
    )
    AND audit_entry."metadata" ->> 'ruleCode' = 'SUPPLIER'
  );

DROP TABLE "supplier_create_requests";
DROP TABLE "suppliers";
DROP FUNCTION "enforce_supplier_create_request_invariants"();
DROP FUNCTION "enforce_supplier_invariants"();
DROP TYPE "supplier_entity_type";

-- 只停用四个会拒绝目标层级删除的 User Trigger，外键始终保持生效。
ALTER TABLE "numbering_issuances"
  DISABLE TRIGGER "numbering_issuances_immutability_trigger";
ALTER TABLE "numbering_rule_segments"
  DISABLE TRIGGER "numbering_rule_segments_parent_draft_trigger";
ALTER TABLE "numbering_rule_versions"
  DISABLE TRIGGER "numbering_rule_versions_invariants_trigger";
ALTER TABLE "numbering_rules"
  DISABLE TRIGGER "numbering_rules_invariants_trigger";

DELETE FROM "numbering_issuances" AS issuance
USING "supplier_retirement_snapshot" AS snapshot
WHERE snapshot."supplier_rule_id" IS NOT NULL
  AND issuance."rule_id" = snapshot."supplier_rule_id";

DELETE FROM "numbering_period_states" AS period_state
USING "supplier_retirement_snapshot" AS snapshot
WHERE snapshot."supplier_rule_id" IS NOT NULL
  AND period_state."rule_id" = snapshot."supplier_rule_id";

DELETE FROM "numbering_rule_segments" AS segment
USING "numbering_rule_versions" AS version_entry,
  "supplier_retirement_snapshot" AS snapshot
WHERE snapshot."supplier_rule_id" IS NOT NULL
  AND segment."version_id" = version_entry."id"
  AND version_entry."rule_id" = snapshot."supplier_rule_id";

DELETE FROM "numbering_rule_versions" AS version_entry
USING "supplier_retirement_snapshot" AS snapshot
WHERE snapshot."supplier_rule_id" IS NOT NULL
  AND version_entry."rule_id" = snapshot."supplier_rule_id";

DELETE FROM "numbering_rules" AS rule
USING "supplier_retirement_snapshot" AS snapshot
WHERE snapshot."supplier_rule_id" IS NOT NULL
  AND rule."id" = snapshot."supplier_rule_id";

ALTER TABLE "numbering_issuances"
  ENABLE TRIGGER "numbering_issuances_immutability_trigger";
ALTER TABLE "numbering_rule_segments"
  ENABLE TRIGGER "numbering_rule_segments_parent_draft_trigger";
ALTER TABLE "numbering_rule_versions"
  ENABLE TRIGGER "numbering_rule_versions_invariants_trigger";
ALTER TABLE "numbering_rules"
  ENABLE TRIGGER "numbering_rules_invariants_trigger";

CREATE TYPE "audit_event_type_without_supplier" AS ENUM (
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
  'AUTH_RETENTION_PURGED',
  'REGION_CREATED',
  'REGION_UPDATED',
  'REGION_ENABLED',
  'REGION_DISABLED',
  'CURRENCY_CREATED',
  'CURRENCY_UPDATED',
  'CURRENCY_ENABLED',
  'CURRENCY_DISABLED',
  'EXCHANGE_RATE_CREATED',
  'EXCHANGE_RATE_UPDATED',
  'NUMBERING_RULE_CREATED',
  'NUMBERING_RULE_UPDATED',
  'NUMBERING_RULE_VERSION_PUBLISHED',
  'NUMBERING_RULE_ENABLED',
  'NUMBERING_RULE_DISABLED',
  'DICTIONARY_TYPE_CREATED',
  'DICTIONARY_TYPE_UPDATED',
  'DICTIONARY_TYPE_ENABLED',
  'DICTIONARY_TYPE_DISABLED',
  'DICTIONARY_ITEM_CREATED',
  'DICTIONARY_ITEM_UPDATED',
  'DICTIONARY_ITEM_ENABLED',
  'DICTIONARY_ITEM_DISABLED'
);

ALTER TABLE "audit_events"
  ALTER COLUMN "event_type"
  TYPE "audit_event_type_without_supplier"
  USING "event_type"::text::"audit_event_type_without_supplier";
DROP TYPE "audit_event_type";
ALTER TYPE "audit_event_type_without_supplier" RENAME TO "audit_event_type";

-- 提交前验证最终状态及所有目标外 Numbering/Audit 基线计数。
DO $$
DECLARE
  actual_count BIGINT;
  actual_values TEXT[];
  snapshot "supplier_retirement_snapshot"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT snapshot FROM "supplier_retirement_snapshot";

  SELECT count(*)
  INTO actual_count
  FROM "dictionary_types"
  WHERE "id" = '00000000-0000-4000-8000-000000002001'::uuid
    AND "code" = 'service_provider.supplier'
    AND "name" = '供应商'
    AND "description" = '合作供方中的供应商列表'
    AND "enabled" = false
    AND "sort_order" = 0
    AND "version" = 1;

  IF actual_count <> 1
    OR (
      SELECT count(*)
      FROM "dictionary_types"
      WHERE "id" = '00000000-0000-4000-8000-000000002001'::uuid
        OR "code" = 'service_provider.supplier'
    ) <> 1
  THEN
    RAISE EXCEPTION
      'supplier retirement invariant mismatch: dictionary type';
  END IF;

  SELECT count(*)
  INTO actual_count
  FROM "dictionary_items"
  WHERE "dictionary_type_id" =
    '00000000-0000-4000-8000-000000002001'::uuid;

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement invariant mismatch: dictionary items';
  END IF;

  SELECT count(*)
  INTO actual_count
  FROM (
    SELECT table_entry.oid
    FROM pg_class AS table_entry
    JOIN pg_namespace AS namespace_entry
      ON namespace_entry.oid = table_entry.relnamespace
    WHERE namespace_entry.nspname = current_schema()
      AND table_entry.relname IN ('supplier_create_requests', 'suppliers')
    UNION ALL
    SELECT procedure_entry.oid
    FROM pg_proc AS procedure_entry
    JOIN pg_namespace AS namespace_entry
      ON namespace_entry.oid = procedure_entry.pronamespace
    WHERE namespace_entry.nspname = current_schema()
      AND procedure_entry.proname IN (
        'enforce_supplier_create_request_invariants',
        'enforce_supplier_invariants'
      )
    UNION ALL
    SELECT type_entry.oid
    FROM pg_type AS type_entry
    JOIN pg_namespace AS namespace_entry
      ON namespace_entry.oid = type_entry.typnamespace
    WHERE namespace_entry.nspname = current_schema()
      AND type_entry.typname = 'supplier_entity_type'
    UNION ALL
    SELECT trigger_entry.oid
    FROM pg_trigger AS trigger_entry
    JOIN pg_class AS table_entry
      ON table_entry.oid = trigger_entry.tgrelid
    JOIN pg_namespace AS namespace_entry
      ON namespace_entry.oid = table_entry.relnamespace
    WHERE namespace_entry.nspname = current_schema()
      AND trigger_entry.tgname IN (
        'suppliers_invariants_trigger',
        'supplier_create_requests_invariants_trigger'
      )
  ) AS retired_object;

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement invariant mismatch: schema objects';
  END IF;

  SELECT count(*)
  INTO actual_count
  FROM "permissions"
  WHERE "id" IN (
      '00000000-0000-4000-8000-000000000138'::uuid,
      '00000000-0000-4000-8000-000000000139'::uuid,
      '00000000-0000-4000-8000-000000000140'::uuid,
      '00000000-0000-4000-8000-000000000141'::uuid,
      '00000000-0000-4000-8000-000000000142'::uuid
    )
    OR "code" LIKE 'suppliers:%';

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement invariant mismatch: permission catalog';
  END IF;

  SELECT count(*)
  INTO actual_count
  FROM "role_permissions"
  WHERE "permission_id" IN (
    '00000000-0000-4000-8000-000000000138'::uuid,
    '00000000-0000-4000-8000-000000000139'::uuid,
    '00000000-0000-4000-8000-000000000140'::uuid,
    '00000000-0000-4000-8000-000000000141'::uuid,
    '00000000-0000-4000-8000-000000000142'::uuid
  );

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement invariant mismatch: role grants';
  END IF;

  SELECT count(*)
  INTO actual_count
  FROM "numbering_rules"
  WHERE "id" = snapshot."supplier_rule_id"
    OR "rule_code" = 'SUPPLIER';

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement invariant mismatch: numbering hierarchy';
  END IF;

  SELECT count(*)
  INTO actual_count
  FROM "audit_events" AS audit_entry
  WHERE audit_entry."event_type"::text LIKE 'SUPPLIER_%'
    OR audit_entry."target_type" = 'Supplier'
    OR (
      snapshot."supplier_rule_id" IS NOT NULL
      AND audit_entry."target_type" = 'NumberingRule'
      AND audit_entry."target_id" = snapshot."supplier_rule_id"::text
    )
    OR (
      audit_entry."event_type"::text IN (
        'NUMBERING_RULE_CREATED',
        'NUMBERING_RULE_UPDATED',
        'NUMBERING_RULE_VERSION_PUBLISHED',
        'NUMBERING_RULE_ENABLED',
        'NUMBERING_RULE_DISABLED'
      )
      AND audit_entry."metadata" ->> 'ruleCode' = 'SUPPLIER'
    );

  IF actual_count <> 0 THEN
    RAISE EXCEPTION
      'supplier retirement invariant mismatch: supplier audit';
  END IF;

  SELECT array_agg(enum_entry.enumlabel::text ORDER BY enum_entry.enumsortorder)
  INTO actual_values
  FROM pg_enum AS enum_entry
  JOIN pg_type AS type_entry
    ON type_entry.oid = enum_entry.enumtypid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = type_entry.typnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND type_entry.typname = 'audit_event_type';

  IF actual_values IS DISTINCT FROM ARRAY[
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
    'AUTH_RETENTION_PURGED',
    'REGION_CREATED',
    'REGION_UPDATED',
    'REGION_ENABLED',
    'REGION_DISABLED',
    'CURRENCY_CREATED',
    'CURRENCY_UPDATED',
    'CURRENCY_ENABLED',
    'CURRENCY_DISABLED',
    'EXCHANGE_RATE_CREATED',
    'EXCHANGE_RATE_UPDATED',
    'NUMBERING_RULE_CREATED',
    'NUMBERING_RULE_UPDATED',
    'NUMBERING_RULE_VERSION_PUBLISHED',
    'NUMBERING_RULE_ENABLED',
    'NUMBERING_RULE_DISABLED',
    'DICTIONARY_TYPE_CREATED',
    'DICTIONARY_TYPE_UPDATED',
    'DICTIONARY_TYPE_ENABLED',
    'DICTIONARY_TYPE_DISABLED',
    'DICTIONARY_ITEM_CREATED',
    'DICTIONARY_ITEM_UPDATED',
    'DICTIONARY_ITEM_ENABLED',
    'DICTIONARY_ITEM_DISABLED'
  ] THEN
    RAISE EXCEPTION 'supplier retirement invariant mismatch: audit enum';
  END IF;

  SELECT count(*)
  INTO actual_count
  FROM pg_index AS index_entry
  JOIN pg_class AS index_class
    ON index_class.oid = index_entry.indexrelid
  JOIN pg_class AS table_entry
    ON table_entry.oid = index_entry.indrelid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = index_class.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND index_class.relname = 'audit_events_event_type_occurred_at_idx'
    AND table_entry.relnamespace = namespace_entry.oid
    AND table_entry.relname = 'audit_events'
    AND index_entry.indisvalid
    AND index_entry.indisready;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION
      'supplier retirement invariant mismatch: audit index';
  END IF;

  SELECT count(*)
  INTO actual_count
  FROM pg_trigger AS trigger_entry
  JOIN pg_class AS table_entry
    ON table_entry.oid = trigger_entry.tgrelid
  JOIN pg_namespace AS namespace_entry
    ON namespace_entry.oid = table_entry.relnamespace
  WHERE namespace_entry.nspname = current_schema()
    AND trigger_entry.tgname IN (
      'numbering_issuances_immutability_trigger',
      'numbering_rule_segments_parent_draft_trigger',
      'numbering_rule_versions_invariants_trigger',
      'numbering_rules_invariants_trigger'
    )
    AND trigger_entry.tgenabled = 'O';

  IF actual_count <> 4 THEN
    RAISE EXCEPTION
      'supplier retirement invariant mismatch: numbering triggers';
  END IF;

  IF (SELECT count(*) FROM "numbering_rules")
      <> snapshot."protected_rule_count"
    OR (SELECT count(*) FROM "numbering_rule_versions")
      <> snapshot."protected_version_count"
    OR (SELECT count(*) FROM "numbering_rule_segments")
      <> snapshot."protected_segment_count"
    OR (SELECT count(*) FROM "numbering_period_states")
      <> snapshot."protected_period_state_count"
    OR (SELECT count(*) FROM "numbering_issuances")
      <> snapshot."protected_issuance_count"
    OR (SELECT count(*) FROM "audit_events")
      <> snapshot."protected_audit_count"
  THEN
    RAISE EXCEPTION
      'supplier retirement invariant mismatch: protected baseline';
  END IF;
END;
$$;

COMMIT;
