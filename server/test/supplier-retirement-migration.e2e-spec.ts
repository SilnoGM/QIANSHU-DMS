import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const serverRoot = resolve(__dirname, '..')
const preRetirementMigrationPaths = [
  '20260710152144_init',
  '20260717090000_user_auth_rbac',
  '20260720090000_user_profiles',
  '20260727090000_regions_schema_and_permissions',
  '20260727100000_regions_seed',
  '20260729090000_currency_exchange_rate_schema_and_permissions',
  '20260729100000_currency_seed',
  '20260802090000_numbering_management_schema_and_permissions',
  '20260803090000_dictionary_management_schema_and_permissions',
  '20260805090000_supplier_management_schema_and_permissions',
].map(directory => resolve(
  serverRoot,
  `prisma/migrations/${directory}/migration.sql`,
))
const retirementMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260809090000_supplier_domain_retirement/migration.sql',
)

const SUPPLIER_DICTIONARY_TYPE_ID =
  '00000000-0000-4000-8000-000000002001'
const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const SUPPLIER_PERMISSION_CODES = [
  'suppliers:create',
  'suppliers:disable',
  'suppliers:enable',
  'suppliers:read',
  'suppliers:update',
] as const
const RETAINED_AUDIT_EVENT_TYPES = [
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
] as const

interface NumberingHierarchy {
  readonly generatedNumber: string
  readonly issuanceId: string
  readonly periodStateId: string
  readonly ruleId: string
  readonly segmentId: string
  readonly versionId: string
}

interface SupplierFixture {
  readonly dictionaryItemId: string
  readonly dictionaryTypeId: string
  readonly nullAuditId: string
  readonly otherAuditId: string
  readonly otherHierarchy: NumberingHierarchy
  readonly ordinaryRoleId: string
  readonly regionId: string
  readonly supplierId: string
  readonly supplierRuleId: string
}

function requireCiDatabaseUrl(): string {
  const rawValue = process.env.DATABASE_URL
  if (typeof rawValue !== 'string') {
    throw new Error('Supplier retirement E2E CI database URL is required')
  }

  let url: URL
  try {
    url = new URL(rawValue)
  }
  catch {
    throw new Error('Supplier retirement E2E CI database URL is invalid')
  }

  const port = Number.parseInt(url.port, 10)
  const query = [...url.searchParams.entries()]
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || url.username !== 'qianshu_ci'
    || url.password.length === 0
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || !/^\d{1,5}$/u.test(url.port)
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
    || url.pathname !== '/qianshu_ci'
    || url.hash !== ''
    || JSON.stringify(query) !== JSON.stringify([['schema', 'public']])
  ) {
    throw new Error('Supplier retirement E2E database URL is outside CI boundary')
  }

  return url.toString()
}

function quoteTestSchema(identifier: string): string {
  if (!/^supplier_retirement_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Supplier retirement E2E schema name is invalid')
  }
  return `"${identifier}"`
}

function quoteDependencySchema(identifier: string): string {
  if (!/^supplier_permission_dependency_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Supplier retirement dependency schema name is invalid')
  }
  return `"${identifier}"`
}

function readDatabaseErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  return Reflect.get(error, 'code')
}

function readDatabaseErrorConstraint(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  return Reflect.get(error, 'constraint')
}

async function withPreRetirementSchema(
  action: (client: Client) => Promise<void>,
): Promise<void> {
  const client = new Client({ connectionString: requireCiDatabaseUrl() })
  const schemaName = `supplier_retirement_${randomUUID().replaceAll('-', '')}`
  const quotedSchema = quoteTestSchema(schemaName)
  let schemaCreated = false

  await client.connect()
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`)
    schemaCreated = true
    await client.query(`SET search_path TO ${quotedSchema}, public`)
    for (const migrationPath of preRetirementMigrationPaths) {
      await client.query(readFileSync(migrationPath, 'utf8'))
    }
    await action(client)
  }
  finally {
    await client.query('ROLLBACK').catch(() => undefined)
    if (schemaCreated) {
      await client.query('SET search_path TO public').catch(() => undefined)
      await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`)
        .catch(() => undefined)
    }
    await client.end()
  }
}

async function applyRetirementMigration(client: Client): Promise<void> {
  await client.query(readFileSync(retirementMigrationPath, 'utf8'))
}

async function expectRetirementFailure(
  client: Client,
  expectedCode: '2BP01' | 'P0001',
): Promise<void> {
  try {
    await applyRetirementMigration(client)
  }
  catch (error) {
    // 只断言 PostgreSQL 稳定错误码，不输出 SQL、连接信息或已舍弃业务字段。
    expect(readDatabaseErrorCode(error)).toBe(expectedCode)
    await client.query('ROLLBACK')
    return
  }
  throw new Error('Expected Supplier retirement migration to fail')
}

async function insertNumberingHierarchy(
  client: Client,
  ruleCode: string,
  consumerCode: string,
  options: { readonly publishVersion?: boolean } = {},
): Promise<NumberingHierarchy> {
  const ruleId = randomUUID()
  const versionId = randomUUID()
  const segmentId = randomUUID()
  const periodStateId = randomUUID()
  const issuanceId = randomUUID()
  const generatedNumber = `${ruleCode}-${randomUUID().slice(0, 8).toUpperCase()}`

  await client.query(
    `
      INSERT INTO "numbering_rules" ("id", "rule_code", "name")
      VALUES ($1, $2, 'Retirement E2E rule')
    `,
    [ruleId, ruleCode],
  )
  await client.query(
    `
      INSERT INTO "numbering_rule_versions" (
        "id", "rule_id", "revision", "reset_policy", "config_fingerprint"
      )
      VALUES ($1, $2, 1, 'NEVER', repeat('a', 64))
    `,
    [versionId, ruleId],
  )
  await client.query(
    `
      INSERT INTO "numbering_rule_segments" (
        "id", "version_id", "position", "type", "fixed_value"
      )
      VALUES ($1, $2, 0, 'FIXED', $3)
    `,
    [segmentId, versionId, ruleCode.replaceAll('_', '')],
  )
  await client.query(
    `
      INSERT INTO "numbering_period_states" (
        "id", "rule_id", "period_key", "next_sequence_value", "used_count"
      )
      VALUES ($1, $2, 'ALL', 2, 1)
    `,
    [periodStateId, ruleId],
  )
  await client.query(
    `
      INSERT INTO "numbering_issuances" (
        "id", "rule_id", "rule_version_id", "period_key",
        "generated_number", "sequence_value", "consumer_code",
        "idempotency_key_hash", "request_fingerprint_hash"
      )
      VALUES ($1, $2, $3, 'ALL', $4, 1, $5, $6, $7)
    `,
    [
      issuanceId,
      ruleId,
      versionId,
      generatedNumber,
      consumerCode,
      Buffer.from(randomUUID().replaceAll('-', '').padEnd(64, '0'), 'hex'),
      Buffer.from(randomUUID().replaceAll('-', '').padEnd(64, '1'), 'hex'),
    ],
  )

  if (options.publishVersion === true) {
    await client.query(
      `
        UPDATE "numbering_rule_versions"
        SET "status" = 'ACTIVE', "published_at" = CURRENT_TIMESTAMP
        WHERE "id" = $1
      `,
      [versionId],
    )
  }

  return {
    generatedNumber,
    issuanceId,
    periodStateId,
    ruleId,
    segmentId,
    versionId,
  }
}

async function insertAudit(
  client: Client,
  input: {
    readonly eventType: string
    readonly metadata?: Record<string, string>
    readonly targetId?: string
    readonly targetType?: string
  },
): Promise<string> {
  const id = randomUUID()
  await client.query(
    `
      INSERT INTO "audit_events" (
        "id", "event_type", "outcome", "actor_type", "target_type",
        "target_id", "request_id", "metadata"
      )
      VALUES ($1, $2, 'SUCCESS', 'SYSTEM', $3, $4, $5, $6::jsonb)
    `,
    [
      id,
      input.eventType,
      input.targetType ?? null,
      input.targetId ?? null,
      `req_${randomUUID()}`,
      JSON.stringify(input.metadata ?? {}),
    ],
  )
  return id
}

async function seedSupplierAndCanaries(
  client: Client,
): Promise<SupplierFixture> {
  const supplierHierarchy = await insertNumberingHierarchy(
    client,
    'SUPPLIER',
    'SUPPLIER.CREATE',
  )
  const otherHierarchy = await insertNumberingHierarchy(
    client,
    'ORDER_NO',
    'ORDER.CREATE',
    { publishVersion: true },
  )
  await client.query(
    `
      INSERT INTO "numbering_issuances" (
        "rule_id", "rule_version_id", "period_key", "generated_number",
        "sequence_value", "consumer_code", "idempotency_key_hash",
        "request_fingerprint_hash"
      )
      VALUES ($1, $2, 'ALL', $3, 2, 'LEGACY.CREATE', $4, $5)
    `,
    [
      supplierHierarchy.ruleId,
      supplierHierarchy.versionId,
      `SUPPLIER-${randomUUID().slice(0, 8).toUpperCase()}`,
      Buffer.alloc(32, 4),
      Buffer.alloc(32, 5),
    ],
  )
  const supplierId = randomUUID()
  await client.query(
    `
      INSERT INTO "suppliers" (
        "id", "code", "numbering_issuance_id", "legal_name",
        "normalized_legal_name", "entity_type", "remark"
      )
      VALUES ($1, $2, $3, 'Discarded supplier', 'discarded supplier',
        'ORGANIZATION', 'must not migrate')
    `,
    [
      supplierId,
      supplierHierarchy.generatedNumber,
      supplierHierarchy.issuanceId,
    ],
  )
  await client.query(
    `
      INSERT INTO "supplier_create_requests" (
        "idempotency_scope_hash", "request_fingerprint_hash", "supplier_id"
      )
      VALUES ($1, $2, $3)
    `,
    [Buffer.alloc(32, 2), Buffer.alloc(32, 3), supplierId],
  )
  await insertAudit(client, {
    eventType: 'SUPPLIER_CREATED',
    targetType: 'Supplier',
    targetId: supplierId,
  })
  await insertAudit(client, {
    eventType: 'AUTH_RETENTION_PURGED',
    targetType: 'Supplier',
    targetId: supplierId,
  })
  await insertAudit(client, {
    eventType: 'NUMBERING_RULE_CREATED',
    targetType: 'NumberingRule',
    targetId: supplierHierarchy.ruleId,
    metadata: { ruleCode: 'SUPPLIER' },
  })
  await insertAudit(client, {
    eventType: 'NUMBERING_RULE_UPDATED',
    metadata: { ruleCode: 'SUPPLIER' },
  })
  const otherAuditId = await insertAudit(client, {
    eventType: 'NUMBERING_RULE_CREATED',
    targetType: 'NumberingRule',
    targetId: otherHierarchy.ruleId,
    metadata: { ruleCode: 'ORDER_NO' },
  })
  const nullAuditId = await insertAudit(client, {
    eventType: 'AUTH_RETENTION_PURGED',
  })

  const dictionaryTypeId = randomUUID()
  const dictionaryItemId = randomUUID()
  const dictionaryCode =
    `e2e_${randomUUID().replaceAll('-', '')}.retirement_canary`
  await client.query(
    `
      INSERT INTO "dictionary_types" (
        "id", "code", "name", "description", "sort_order"
      )
      VALUES ($1, $2, 'Retirement canary', 'Must remain byte-equivalent', 99)
    `,
    [dictionaryTypeId, dictionaryCode],
  )
  await client.query(
    `
      INSERT INTO "dictionary_items" (
        "id", "dictionary_type_id", "value", "label", "tone", "sort_order"
      )
      VALUES ($1, $2, 'CANARY', 'Canary item', 'INFO', 7)
    `,
    [dictionaryItemId, dictionaryTypeId],
  )
  const ordinaryRoleId = randomUUID()
  await client.query(
    `
      INSERT INTO "roles" ("id", "code", "name", "description")
      VALUES ($1, $2, 'Retirement canary role', 'Must remain unchanged')
    `,
    [ordinaryRoleId, `retirement_canary_${randomUUID().replaceAll('-', '')}`],
  )
  await client.query(
    `
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT $1::uuid, permission."id"
      FROM "permissions" AS permission
      WHERE permission."code" IN ('dictionaries:read', 'suppliers:read')
    `,
    [ordinaryRoleId],
  )
  const region = await client.query<{ id: string }>(`
    SELECT "id"::text AS "id"
    FROM "regions"
    ORDER BY "id"
    LIMIT 1
  `)
  const regionId = region.rows[0]?.id
  if (regionId === undefined) {
    throw new Error('Expected a seeded Region canary')
  }

  return {
    dictionaryItemId,
    dictionaryTypeId,
    nullAuditId,
    otherAuditId,
    otherHierarchy,
    ordinaryRoleId,
    regionId,
    supplierId,
    supplierRuleId: supplierHierarchy.ruleId,
  }
}

async function readProtectedCanarySnapshot(
  client: Client,
  fixture: SupplierFixture,
): Promise<unknown> {
  const result = await client.query<{ snapshot: unknown }>(`
    SELECT jsonb_build_object(
      'rule', (
        SELECT to_jsonb(rule) FROM "numbering_rules" AS rule
        WHERE rule."id" = $1::uuid
      ),
      'version', (
        SELECT to_jsonb(version_entry)
        FROM "numbering_rule_versions" AS version_entry
        WHERE version_entry."id" = $2::uuid
      ),
      'segment', (
        SELECT to_jsonb(segment) FROM "numbering_rule_segments" AS segment
        WHERE segment."id" = $3::uuid
      ),
      'periodState', (
        SELECT to_jsonb(period_state)
        FROM "numbering_period_states" AS period_state
        WHERE period_state."id" = $4::uuid
      ),
      'issuance', (
        SELECT to_jsonb(issuance) FROM "numbering_issuances" AS issuance
        WHERE issuance."id" = $5::uuid
      ),
      'audit', (
        SELECT to_jsonb(audit_entry) FROM "audit_events" AS audit_entry
        WHERE audit_entry."id" = $6::uuid
      ),
      'nullAudit', (
        SELECT to_jsonb(audit_entry) FROM "audit_events" AS audit_entry
        WHERE audit_entry."id" = $7::uuid
      ),
      'permission', (
        SELECT to_jsonb(permission) FROM "permissions" AS permission
        WHERE permission."code" = 'dictionaries:read'
      ),
      'grants', (
        SELECT COALESCE(
          jsonb_agg(to_jsonb(grant_entry) ORDER BY grant_entry."role_id"),
          '[]'::jsonb
        )
        FROM "role_permissions" AS grant_entry
        JOIN "permissions" AS permission
          ON permission."id" = grant_entry."permission_id"
        WHERE permission."code" = 'dictionaries:read'
      ),
      'dictionaryType', (
        SELECT to_jsonb(type_entry) FROM "dictionary_types" AS type_entry
        WHERE type_entry."id" = $8::uuid
      ),
      'dictionaryItem', (
        SELECT to_jsonb(item) FROM "dictionary_items" AS item
        WHERE item."id" = $9::uuid
      ),
      'region', (
        SELECT to_jsonb(region) FROM "regions" AS region
        WHERE region."id" = $10::uuid
      ),
      'ordinaryRole', (
        SELECT to_jsonb(role) FROM "roles" AS role
        WHERE role."id" = $11::uuid
      )
    ) AS "snapshot"
  `, [
    fixture.otherHierarchy.ruleId,
    fixture.otherHierarchy.versionId,
    fixture.otherHierarchy.segmentId,
    fixture.otherHierarchy.periodStateId,
    fixture.otherHierarchy.issuanceId,
    fixture.otherAuditId,
    fixture.nullAuditId,
    fixture.dictionaryTypeId,
    fixture.dictionaryItemId,
    fixture.regionId,
    fixture.ordinaryRoleId,
  ])
  return result.rows[0]?.snapshot
}

async function readRollbackSnapshot(client: Client): Promise<unknown> {
  const result = await client.query<{ snapshot: unknown }>(`
    SELECT jsonb_build_object(
      'supplierTable', to_regclass('suppliers')::text,
      'createRequestTable', to_regclass('supplier_create_requests')::text,
      'supplierType', to_regtype('supplier_entity_type')::text,
      'supplierFunction',
        to_regprocedure('enforce_supplier_invariants()')::text,
      'createRequestFunction',
        to_regprocedure('enforce_supplier_create_request_invariants()')::text,
      'suppliers', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry) ORDER BY row_entry."id"),
          '[]'::jsonb) FROM "suppliers" AS row_entry
      ),
      'createRequests', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry) ORDER BY row_entry."id"),
          '[]'::jsonb) FROM "supplier_create_requests" AS row_entry
      ),
      'rules', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry) ORDER BY row_entry."id"),
          '[]'::jsonb) FROM "numbering_rules" AS row_entry
      ),
      'versions', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry) ORDER BY row_entry."id"),
          '[]'::jsonb) FROM "numbering_rule_versions" AS row_entry
      ),
      'segments', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry) ORDER BY row_entry."id"),
          '[]'::jsonb) FROM "numbering_rule_segments" AS row_entry
      ),
      'periodStates', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry) ORDER BY row_entry."id"),
          '[]'::jsonb) FROM "numbering_period_states" AS row_entry
      ),
      'issuances', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry) ORDER BY row_entry."id"),
          '[]'::jsonb) FROM "numbering_issuances" AS row_entry
      ),
      'auditEvents', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry) ORDER BY row_entry."id"),
          '[]'::jsonb) FROM "audit_events" AS row_entry
      ),
      'permissions', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry) ORDER BY row_entry."id"),
          '[]'::jsonb) FROM "permissions" AS row_entry
      ),
      'rolePermissions', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry)
          ORDER BY row_entry."role_id", row_entry."permission_id"), '[]'::jsonb)
        FROM "role_permissions" AS row_entry
      ),
      'dictionaryTypes', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry) ORDER BY row_entry."id"),
          '[]'::jsonb) FROM "dictionary_types" AS row_entry
      ),
      'dictionaryItems', (
        SELECT COALESCE(jsonb_agg(to_jsonb(row_entry) ORDER BY row_entry."id"),
          '[]'::jsonb) FROM "dictionary_items" AS row_entry
      ),
      'auditEnum', (
        SELECT jsonb_agg(enum_entry.enumlabel::text
          ORDER BY enum_entry.enumsortorder)
        FROM pg_enum AS enum_entry
        JOIN pg_type AS type_entry ON type_entry.oid = enum_entry.enumtypid
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = type_entry.typnamespace
        WHERE namespace_entry.nspname = current_schema()
          AND type_entry.typname = 'audit_event_type'
      ),
      'temporaryAuditEnum', (
        SELECT count(*)
        FROM pg_type AS type_entry
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = type_entry.typnamespace
        WHERE namespace_entry.nspname = current_schema()
          AND type_entry.typname = 'audit_event_type_without_supplier'
      ),
      'triggers', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'table', table_entry.relname,
          'name', trigger_entry.tgname,
          'enabled', trigger_entry.tgenabled,
          'function', procedure_entry.proname
        ) ORDER BY table_entry.relname, trigger_entry.tgname), '[]'::jsonb)
        FROM pg_trigger AS trigger_entry
        JOIN pg_class AS table_entry ON table_entry.oid = trigger_entry.tgrelid
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = table_entry.relnamespace
        JOIN pg_proc AS procedure_entry
          ON procedure_entry.oid = trigger_entry.tgfoid
        WHERE namespace_entry.nspname = current_schema()
          AND NOT trigger_entry.tgisinternal
      ),
      'unknownDependency',
        to_regclass('supplier_retirement_unknown_dependency')::text,
      'unknownAuditDependency',
        to_regclass('supplier_retirement_unknown_audit_dependency')::text,
      'unknownNumberingDependency',
        to_regclass('supplier_retirement_unknown_numbering_dependency')::text,
      'unknownMutationDependency',
        to_regclass('supplier_retirement_unknown_mutation_dependency')::text,
      'crossSchemaPermissionDependency',
        to_regclass('supplier_retirement_cross_schema_permission')::text
    ) AS "snapshot"
  `)
  return result.rows[0]?.snapshot
}

async function expectNumberingTriggersRejectMutation(
  client: Client,
  hierarchy: NumberingHierarchy,
): Promise<void> {
  const cases = [
    {
      query: 'DELETE FROM "numbering_issuances" WHERE "id" = $1::uuid',
      id: hierarchy.issuanceId,
      constraint: 'numbering_issuances_immutable_check',
    },
    {
      query: 'DELETE FROM "numbering_rule_segments" WHERE "id" = $1::uuid',
      id: hierarchy.segmentId,
      constraint: 'numbering_rule_segments_parent_draft_check',
    },
    {
      query: 'DELETE FROM "numbering_rule_versions" WHERE "id" = $1::uuid',
      id: hierarchy.versionId,
      constraint: 'numbering_rule_versions_delete_check',
    },
    {
      query: 'DELETE FROM "numbering_rules" WHERE "id" = $1::uuid',
      id: hierarchy.ruleId,
      constraint: 'numbering_rules_delete_check',
    },
  ] as const

  await client.query('BEGIN')
  try {
    for (const [index, testCase] of cases.entries()) {
      const savepoint = `numbering_trigger_rejection_${index}`
      await client.query(`SAVEPOINT ${savepoint}`)
      try {
        await client.query(testCase.query, [testCase.id])
      }
      catch (error) {
        expect(readDatabaseErrorCode(error)).toBe('23514')
        expect(readDatabaseErrorConstraint(error)).toBe(testCase.constraint)
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        await client.query(`RELEASE SAVEPOINT ${savepoint}`)
        continue
      }
      throw new Error(`Expected ${testCase.constraint} to reject deletion`)
    }
  }
  finally {
    await client.query('ROLLBACK')
  }
}

async function expectRetiredState(
  client: Client,
  fixture?: SupplierFixture,
): Promise<void> {
  const catalog = await client.query<{
    description: string
    enabled: boolean
    id: string
    itemCount: number
    name: string
    sortOrder: number
    version: number
  }>(`
    SELECT
      type_entry."id"::text AS "id",
      type_entry."name" AS "name",
      type_entry."description" AS "description",
      type_entry."enabled" AS "enabled",
      type_entry."sort_order" AS "sortOrder",
      type_entry."version" AS "version",
      count(item."id")::integer AS "itemCount"
    FROM "dictionary_types" AS type_entry
    LEFT JOIN "dictionary_items" AS item
      ON item."dictionary_type_id" = type_entry."id"
    WHERE type_entry."code" = $1
    GROUP BY type_entry."id"
  `, [SUPPLIER_DICTIONARY_CODE])
  expect(catalog.rows).toEqual([{
    description: '合作供方中的供应商列表',
    enabled: false,
    id: SUPPLIER_DICTIONARY_TYPE_ID,
    itemCount: 0,
    name: '供应商',
    sortOrder: 0,
    version: 1,
  }])

  const retiredObjects = await client.query<{
    createRequestFunction: string | null
    createRequestTable: string | null
    entityType: string | null
    supplierFunction: string | null
    supplierTable: string | null
  }>(`
    SELECT
      to_regclass('supplier_create_requests')::text AS "createRequestTable",
      to_regclass('suppliers')::text AS "supplierTable",
      to_regprocedure('enforce_supplier_create_request_invariants()')::text
        AS "createRequestFunction",
      to_regprocedure('enforce_supplier_invariants()')::text
        AS "supplierFunction",
      to_regtype('supplier_entity_type')::text AS "entityType"
  `)
  expect(retiredObjects.rows).toEqual([{
    createRequestFunction: null,
    createRequestTable: null,
    entityType: null,
    supplierFunction: null,
    supplierTable: null,
  }])

  const permissions = await client.query<{ code: string }>(`
    SELECT "code"
    FROM "permissions"
    WHERE "code" LIKE 'suppliers:%'
    ORDER BY "code"
  `)
  expect(permissions.rows).toEqual([])
  const grants = await client.query<{ count: number }>(`
    SELECT count(*)::integer AS "count"
    FROM "role_permissions" AS grant_entry
    JOIN "permissions" AS permission
      ON permission."id" = grant_entry."permission_id"
    WHERE permission."code" LIKE 'suppliers:%'
  `)
  expect(grants.rows).toEqual([{ count: 0 }])

  const enumValues = await client.query<{ label: string }>(`
    SELECT enum_entry.enumlabel::text AS "label"
    FROM pg_enum AS enum_entry
    JOIN pg_type AS type_entry ON type_entry.oid = enum_entry.enumtypid
    JOIN pg_namespace AS namespace_entry
      ON namespace_entry.oid = type_entry.typnamespace
    WHERE namespace_entry.nspname = current_schema()
      AND type_entry.typname = 'audit_event_type'
    ORDER BY enum_entry.enumsortorder
  `)
  expect(enumValues.rows.map(row => row.label)).toEqual(
    RETAINED_AUDIT_EVENT_TYPES,
  )
  const postRetirementAuditId = randomUUID()
  await client.query(
    `
      INSERT INTO "audit_events" (
        "id", "event_type", "outcome", "actor_type", "request_id"
      )
      VALUES ($1, 'USER_UPDATED', 'SUCCESS', 'SYSTEM', $2)
    `,
    [postRetirementAuditId, `req_${randomUUID()}`],
  )
  await expect(client.query<{ eventType: string }>(`
    SELECT "event_type"::text AS "eventType"
    FROM "audit_events"
    WHERE "id" = $1::uuid
  `, [postRetirementAuditId])).resolves.toMatchObject({
    rows: [{ eventType: 'USER_UPDATED' }],
  })

  const indexAndTriggers = await client.query<{
    auditIndexReady: boolean
    auditIndexValid: boolean
    enabledTriggerCount: number
  }>(`
    SELECT
      index_entry.indisvalid AS "auditIndexValid",
      index_entry.indisready AS "auditIndexReady",
      (
        SELECT count(*)::integer
        FROM pg_trigger AS trigger_entry
        JOIN pg_class AS table_entry ON table_entry.oid = trigger_entry.tgrelid
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = table_entry.relnamespace
        WHERE namespace_entry.nspname = current_schema()
          AND trigger_entry.tgname = ANY(ARRAY[
            'numbering_issuances_immutability_trigger',
            'numbering_rule_segments_parent_draft_trigger',
            'numbering_rule_versions_invariants_trigger',
            'numbering_rules_invariants_trigger'
          ])
          AND trigger_entry.tgenabled = 'O'
      ) AS "enabledTriggerCount"
    FROM pg_index AS index_entry
    WHERE index_entry.indexrelid =
      'audit_events_event_type_occurred_at_idx'::regclass
  `)
  expect(indexAndTriggers.rows).toEqual([{
    auditIndexReady: true,
    auditIndexValid: true,
    enabledTriggerCount: 4,
  }])

  if (fixture === undefined) {
    return
  }
  const numberingCanary = await client.query<{
    issuanceId: string
    ruleId: string
  }>(`
    SELECT
      rule."id"::text AS "ruleId",
      issuance."id"::text AS "issuanceId"
    FROM "numbering_rules" AS rule
    JOIN "numbering_issuances" AS issuance
      ON issuance."rule_id" = rule."id"
    WHERE rule."rule_code" = 'ORDER_NO'
  `)
  expect(numberingCanary.rows).toEqual([{
    issuanceId: fixture.otherHierarchy.issuanceId,
    ruleId: fixture.otherHierarchy.ruleId,
  }])
  const supplierHierarchy = await client.query<{ count: number }>(`
    SELECT count(*)::integer AS "count"
    FROM "numbering_rules"
    WHERE "id" = $1::uuid OR "rule_code" = 'SUPPLIER'
  `, [fixture.supplierRuleId])
  expect(supplierHierarchy.rows).toEqual([{ count: 0 }])
  const auditCanary = await client.query<{ id: string }>(`
    SELECT "id"::text AS "id"
    FROM "audit_events"
    WHERE "id" = $1::uuid
  `, [fixture.otherAuditId])
  expect(auditCanary.rows).toEqual([{ id: fixture.otherAuditId }])
  const supplierAudit = await client.query<{ count: number }>(`
    SELECT count(*)::integer AS "count"
    FROM "audit_events"
    WHERE "target_type" = 'Supplier'
      OR (
        "target_type" = 'NumberingRule'
        AND "target_id" = $1
      )
      OR (
        "event_type"::text = ANY(ARRAY[
          'NUMBERING_RULE_CREATED',
          'NUMBERING_RULE_UPDATED',
          'NUMBERING_RULE_VERSION_PUBLISHED',
          'NUMBERING_RULE_ENABLED',
          'NUMBERING_RULE_DISABLED'
        ])
        AND "metadata" ->> 'ruleCode' = 'SUPPLIER'
      )
  `, [fixture.supplierRuleId])
  expect(supplierAudit.rows).toEqual([{ count: 0 }])
  await expectNumberingTriggersRejectMutation(client, fixture.otherHierarchy)
}

describe('supplier retirement migration replay against PostgreSQL', () => {
  jest.setTimeout(90_000)

  it('replays the complete empty history into one disabled empty Catalog', async () => {
    await withPreRetirementSchema(async (client) => {
      await applyRetirementMigration(client)
      await expectRetiredState(client)
    })
  })

  it('discards Supplier data while preserving non-Supplier canaries', async () => {
    await withPreRetirementSchema(async (client) => {
      const fixture = await seedSupplierAndCanaries(client)
      const protectedBefore = await readProtectedCanarySnapshot(client, fixture)
      await applyRetirementMigration(client)
      await expectRetiredState(client, fixture)
      await expect(readProtectedCanarySnapshot(client, fixture))
        .resolves.toEqual(protectedBefore)
    })
  })

  it.each([
    {
      id: randomUUID(),
      code: SUPPLIER_DICTIONARY_CODE,
    },
    {
      id: SUPPLIER_DICTIONARY_TYPE_ID,
      code: `e2e_${randomUUID().replaceAll('-', '')}.occupied_id`,
    },
  ])('rolls back when Dictionary Type identity is occupied', async (conflict) => {
    await withPreRetirementSchema(async (client) => {
      await client.query(
        `
          INSERT INTO "dictionary_types" ("id", "code", "name")
          VALUES ($1, $2, 'Conflicting Type')
        `,
        [conflict.id, conflict.code],
      )
      const before = await readRollbackSnapshot(client)
      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)

      const rollbackState = await client.query<{
        auditTypeCount: number
        conflictCount: number
        permissionCodes: string[]
        supplierTable: string | null
        targetTypeCount: number
      }>(`
        SELECT
          (SELECT count(*)::integer FROM pg_enum AS enum_entry
            JOIN pg_type AS type_entry ON type_entry.oid = enum_entry.enumtypid
            JOIN pg_namespace AS namespace_entry
              ON namespace_entry.oid = type_entry.typnamespace
            WHERE namespace_entry.nspname = current_schema()
              AND type_entry.typname = 'audit_event_type') AS "auditTypeCount",
          (SELECT count(*)::integer FROM "dictionary_types"
            WHERE "id" = $1::uuid AND "code" = $2) AS "conflictCount",
          ARRAY(SELECT "code" FROM "permissions"
            WHERE "code" LIKE 'suppliers:%' ORDER BY "code")
            AS "permissionCodes",
          to_regclass('suppliers')::text AS "supplierTable",
          (SELECT count(*)::integer FROM "dictionary_types"
            WHERE "code" = $3) AS "targetTypeCount"
      `, [conflict.id, conflict.code, SUPPLIER_DICTIONARY_CODE])
      expect(rollbackState.rows).toEqual([{
        auditTypeCount: 44,
        conflictCount: 1,
        permissionCodes: SUPPLIER_PERMISSION_CODES,
        supplierTable: 'suppliers',
        targetTypeCount: conflict.code === SUPPLIER_DICTIONARY_CODE ? 1 : 0,
      }])
    })
  })

  it('rolls back late when an unknown object depends on Supplier schema', async () => {
    await withPreRetirementSchema(async (client) => {
      const fixture = await seedSupplierAndCanaries(client)
      await client.query(`
        CREATE VIEW "supplier_retirement_unknown_dependency" AS
        SELECT "id" FROM "suppliers"
      `)

      const before = await readRollbackSnapshot(client)
      await expectRetirementFailure(client, '2BP01')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
      const rollbackState = await client.query<{
        dictionaryCount: number
        permissionCount: number
        supplierCount: number
        supplierRuleCount: number
        viewName: string | null
      }>(`
        SELECT
          (SELECT count(*)::integer FROM "dictionary_types"
            WHERE "code" = $1) AS "dictionaryCount",
          (SELECT count(*)::integer FROM "permissions"
            WHERE "code" LIKE 'suppliers:%') AS "permissionCount",
          (SELECT count(*)::integer FROM "suppliers"
            WHERE "id" = $2::uuid) AS "supplierCount",
          (SELECT count(*)::integer FROM "numbering_rules"
            WHERE "id" = $3::uuid) AS "supplierRuleCount",
          to_regclass('supplier_retirement_unknown_dependency')::text
            AS "viewName"
      `, [
        SUPPLIER_DICTIONARY_CODE,
        fixture.supplierId,
        fixture.supplierRuleId,
      ])
      expect(rollbackState.rows).toEqual([{
        dictionaryCount: 0,
        permissionCount: 5,
        supplierCount: 1,
        supplierRuleCount: 1,
        viewName: 'supplier_retirement_unknown_dependency',
      }])
    })
  })

  it('rolls back when a protected Numbering trigger is disabled', async () => {
    await withPreRetirementSchema(async (client) => {
      await client.query(`
        ALTER TABLE "numbering_issuances"
        DISABLE TRIGGER "numbering_issuances_immutability_trigger"
      `)
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
    })
  })

  it('rolls back when a Supplier Permission ID and code no longer match', async () => {
    await withPreRetirementSchema(async (client) => {
      await client.query(`
        UPDATE "permissions"
        SET "code" = 'suppliers:read_drift'
        WHERE "id" = '00000000-0000-4000-8000-000000000138'::uuid
      `)
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
    })
  })

  it('rolls back for a cross-schema Permission foreign key', async () => {
    await withPreRetirementSchema(async (client) => {
      const current = await client.query<{ schemaName: string }>(
        'SELECT current_schema() AS "schemaName"',
      )
      const currentSchemaName = current.rows[0]?.schemaName
      if (currentSchemaName === undefined) {
        throw new Error('Supplier retirement current schema is unavailable')
      }
      const quotedCurrentSchema = quoteTestSchema(currentSchemaName)
      const dependencySchemaName =
        `supplier_permission_dependency_${randomUUID().replaceAll('-', '')}`
      const quotedDependencySchema = quoteDependencySchema(dependencySchemaName)

      await client.query(`CREATE SCHEMA ${quotedDependencySchema}`)
      try {
        await client.query(`
          CREATE TABLE ${quotedDependencySchema}."permission_reference" (
            "permission_id" UUID NOT NULL,
            CONSTRAINT "supplier_retirement_cross_schema_permission_fkey"
              FOREIGN KEY ("permission_id")
              REFERENCES ${quotedCurrentSchema}."permissions" ("id")
              ON DELETE CASCADE
          )
        `)
        await client.query(`
          INSERT INTO ${quotedDependencySchema}."permission_reference"
            ("permission_id")
          VALUES ('00000000-0000-4000-8000-000000000138'::uuid)
        `)
        const before = await readRollbackSnapshot(client)

        await expectRetirementFailure(client, 'P0001')
        await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
        await expect(client.query<{ count: number }>(`
          SELECT count(*)::integer AS "count"
          FROM ${quotedDependencySchema}."permission_reference"
        `)).resolves.toMatchObject({ rows: [{ count: 1 }] })
      }
      finally {
        await client.query(`DROP SCHEMA ${quotedDependencySchema} CASCADE`)
      }
    })
  })

  it('rolls back when the physical Audit enum order drifts', async () => {
    await withPreRetirementSchema(async (client) => {
      await client.query(
        'ALTER TYPE "audit_event_type" ADD VALUE \'SUPPLIER_DRIFT\'',
      )
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
    })
  })

  it('rolls back when another column depends on the Audit enum', async () => {
    await withPreRetirementSchema(async (client) => {
      await client.query(`
        CREATE TABLE "supplier_retirement_unknown_audit_dependency" (
          "event_type" "audit_event_type" NOT NULL
        )
      `)
      await client.query(`
        INSERT INTO "supplier_retirement_unknown_audit_dependency"
          ("event_type")
        VALUES ('USER_UPDATED')
      `)
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
      await expect(client.query<{ count: number }>(`
        SELECT count(*)::integer AS "count"
        FROM "supplier_retirement_unknown_audit_dependency"
      `)).resolves.toMatchObject({ rows: [{ count: 1 }] })
    })
  })

  it('rolls back when a SUPPLIER consumer points at another Rule', async () => {
    await withPreRetirementSchema(async (client) => {
      await insertNumberingHierarchy(
        client,
        'ORDER_DRIFT',
        'SUPPLIER.CREATE',
      )
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
    })
  })

  it('rolls back when a Supplier row points at another Numbering Rule', async () => {
    await withPreRetirementSchema(async (client) => {
      const hierarchy = await insertNumberingHierarchy(
        client,
        'ORDER_PROVENANCE',
        'ORDER.CREATE',
      )
      await client.query(`
        ALTER TABLE "suppliers"
        DISABLE TRIGGER "suppliers_invariants_trigger"
      `)
      await client.query(`
        INSERT INTO "suppliers" (
          "code", "numbering_issuance_id", "legal_name",
          "normalized_legal_name", "entity_type"
        )
        VALUES ($1, $2, 'Drifted supplier', 'drifted supplier', 'ORGANIZATION')
      `, [hierarchy.generatedNumber, hierarchy.issuanceId])
      await client.query(`
        ALTER TABLE "suppliers"
        ENABLE TRIGGER "suppliers_invariants_trigger"
      `)
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
    })
  })

  it('rolls back before an unknown Numbering foreign key can cascade', async () => {
    await withPreRetirementSchema(async (client) => {
      const hierarchy = await insertNumberingHierarchy(
        client,
        'SUPPLIER',
        'SUPPLIER.CREATE',
      )
      await client.query(`
        CREATE TABLE "supplier_retirement_unknown_numbering_dependency" (
          "id" UUID PRIMARY KEY,
          "segment_id" UUID NOT NULL,
          CONSTRAINT "supplier_retirement_unknown_numbering_fkey"
            FOREIGN KEY ("segment_id")
            REFERENCES "numbering_rule_segments" ("id")
            ON DELETE CASCADE
        )
      `)
      await client.query(`
        INSERT INTO "supplier_retirement_unknown_numbering_dependency"
          ("id", "segment_id")
        VALUES ($1, $2)
      `, [randomUUID(), hierarchy.segmentId])
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
      await expect(client.query<{ count: number }>(`
        SELECT count(*)::integer AS "count"
        FROM "supplier_retirement_unknown_numbering_dependency"
      `)).resolves.toMatchObject({ rows: [{ count: 1 }] })
    })
  })

  it('rolls back before an unknown Audit foreign key can cascade', async () => {
    await withPreRetirementSchema(async (client) => {
      const auditId = await insertAudit(client, {
        eventType: 'SUPPLIER_CREATED',
        targetType: 'Supplier',
        targetId: randomUUID(),
      })
      await client.query(`
        CREATE TABLE "supplier_retirement_unknown_mutation_dependency" (
          "id" UUID PRIMARY KEY,
          "audit_event_id" UUID NOT NULL,
          CONSTRAINT "supplier_retirement_unknown_audit_fkey"
            FOREIGN KEY ("audit_event_id") REFERENCES "audit_events" ("id")
            ON DELETE CASCADE
        )
      `)
      await client.query(`
        INSERT INTO "supplier_retirement_unknown_mutation_dependency"
          ("id", "audit_event_id")
        VALUES ($1, $2)
      `, [randomUUID(), auditId])
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
      await expect(client.query<{ count: number }>(`
        SELECT count(*)::integer AS "count"
        FROM "supplier_retirement_unknown_mutation_dependency"
      `)).resolves.toMatchObject({ rows: [{ count: 1 }] })
    })
  })

  it('rolls back before an Audit DELETE rule can write a side effect', async () => {
    await withPreRetirementSchema(async (client) => {
      const auditId = await insertAudit(client, {
        eventType: 'SUPPLIER_CREATED',
        targetType: 'Supplier',
        targetId: randomUUID(),
      })
      await client.query(`
        CREATE TABLE "supplier_retirement_rule_side_effect" (
          "audit_event_id" UUID PRIMARY KEY
        )
      `)
      await client.query(`
        CREATE RULE "supplier_retirement_audit_delete_side_effect_rule" AS
        ON DELETE TO "audit_events"
        DO ALSO
          INSERT INTO "supplier_retirement_rule_side_effect"
            ("audit_event_id")
          VALUES (OLD."id")
      `)
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
      await expect(client.query<{
        auditCount: number
        ruleCount: number
        sideEffectCount: number
      }>(`
        SELECT
          (SELECT count(*)::integer FROM "audit_events"
            WHERE "id" = $1::uuid) AS "auditCount",
          (SELECT count(*)::integer
            FROM pg_rewrite AS rewrite_entry
            JOIN pg_class AS table_entry
              ON table_entry.oid = rewrite_entry.ev_class
            JOIN pg_namespace AS namespace_entry
              ON namespace_entry.oid = table_entry.relnamespace
            WHERE namespace_entry.nspname = current_schema()
              AND table_entry.relname = 'audit_events'
              AND rewrite_entry.rulename =
                'supplier_retirement_audit_delete_side_effect_rule')
            AS "ruleCount",
          (SELECT count(*)::integer
            FROM "supplier_retirement_rule_side_effect")
            AS "sideEffectCount"
      `, [auditId])).resolves.toMatchObject({
        rows: [{
          auditCount: 1,
          ruleCount: 1,
          sideEffectCount: 0,
        }],
      })
    })
  })

  it('rolls back when Supplier Rule Audit identity is contradictory', async () => {
    await withPreRetirementSchema(async (client) => {
      const hierarchy = await insertNumberingHierarchy(
        client,
        'SUPPLIER',
        'SUPPLIER.CREATE',
      )
      await insertAudit(client, {
        eventType: 'NUMBERING_RULE_UPDATED',
        targetType: 'NumberingRule',
        targetId: hierarchy.ruleId,
        metadata: { ruleCode: 'ORDER_NO' },
      })
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
    })
  })

  it('rolls back when Supplier lifecycle metadata targets another domain', async () => {
    await withPreRetirementSchema(async (client) => {
      await insertAudit(client, {
        eventType: 'NUMBERING_RULE_CREATED',
        targetType: 'User',
        targetId: randomUUID(),
        metadata: { ruleCode: 'SUPPLIER' },
      })
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
    })
  })

  it('rolls back when a Numbering lifecycle event targets Supplier', async () => {
    await withPreRetirementSchema(async (client) => {
      await insertAudit(client, {
        eventType: 'NUMBERING_RULE_UPDATED',
        targetType: 'Supplier',
        targetId: randomUUID(),
      })
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
    })
  })

  it('rolls back when a non-Numbering event targets the Supplier Rule', async () => {
    await withPreRetirementSchema(async (client) => {
      const hierarchy = await insertNumberingHierarchy(
        client,
        'SUPPLIER',
        'SUPPLIER.CREATE',
      )
      await insertAudit(client, {
        eventType: 'USER_UPDATED',
        targetType: 'NumberingRule',
        targetId: hierarchy.ruleId,
      })
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
    })
  })

  it('rolls back when historical Supplier metadata points at a live other Rule', async () => {
    await withPreRetirementSchema(async (client) => {
      const hierarchy = await insertNumberingHierarchy(
        client,
        'ORDER_AUDIT',
        'ORDER.CREATE',
      )
      await insertAudit(client, {
        eventType: 'NUMBERING_RULE_UPDATED',
        targetId: hierarchy.ruleId,
        metadata: { ruleCode: 'SUPPLIER' },
      })
      const before = await readRollbackSnapshot(client)

      await expectRetirementFailure(client, 'P0001')
      await expect(readRollbackSnapshot(client)).resolves.toEqual(before)
    })
  })
})
