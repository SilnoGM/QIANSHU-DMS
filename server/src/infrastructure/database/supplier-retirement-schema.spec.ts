import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const legacyMigrationDirectory =
  '20260805090000_supplier_management_schema_and_permissions'
const retirementMigrationDirectory =
  '20260809090000_supplier_domain_retirement'
const bindingMigrationDirectory =
  '20260906090104_supplier_shipping_mark_rule_bindings'
const legacyMigrationPath = resolve(
  serverRoot,
  `prisma/migrations/${legacyMigrationDirectory}/migration.sql`,
)
const retirementMigrationPath = resolve(
  serverRoot,
  `prisma/migrations/${retirementMigrationDirectory}/migration.sql`,
)

const LEGACY_MIGRATION_SHA256 =
  '9f18a1f0e980fadd384e27985a872b099e1f210fd729b96eeed0872f5e8b284e'
const SUPPLIER_DICTIONARY_TYPE_ID =
  '00000000-0000-4000-8000-000000002001'
const SUPPLIER_PERMISSION_SEEDS = [
  ['00000000-0000-4000-8000-000000000138', 'suppliers:read'],
  ['00000000-0000-4000-8000-000000000139', 'suppliers:create'],
  ['00000000-0000-4000-8000-000000000140', 'suppliers:update'],
  ['00000000-0000-4000-8000-000000000141', 'suppliers:enable'],
  ['00000000-0000-4000-8000-000000000142', 'suppliers:disable'],
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

function readSchema(): string {
  return readFileSync(schemaPath, 'utf8')
}

function readRetirementMigration(): string {
  return readFileSync(retirementMigrationPath, 'utf8')
}

function extractCreatedEnumValues(
  migration: string,
  enumName: string,
): string[] {
  const match = migration.match(new RegExp(
    `CREATE TYPE "${enumName}" AS ENUM \\(([\\s\\S]*?)\\);`,
    'u',
  ))
  if (!match?.[1]) {
    throw new Error(`Missing PostgreSQL enum ${enumName}`)
  }
  return [...match[1].matchAll(/'([A-Z][A-Z0-9_]*)'/gu)]
    .map(entry => entry[1])
}

describe('supplier domain retirement database schema', () => {
  it('keeps legacy retirement immutable and only permits the dictionary-backed binding and payment-profile additions', () => {
    const legacyMigration = readFileSync(legacyMigrationPath)
    expect(createHash('sha256').update(legacyMigration).digest('hex')).toBe(
      LEGACY_MIGRATION_SHA256,
    )

    const supplierMigrationDirectories = readdirSync(
      resolve(serverRoot, 'prisma/migrations'),
      { withFileTypes: true },
    )
      .filter(entry => entry.isDirectory() && entry.name.includes('supplier_'))
      .map(entry => entry.name)
      .sort()
    expect(supplierMigrationDirectories).toEqual([
      legacyMigrationDirectory,
      retirementMigrationDirectory,
      bindingMigrationDirectory,
      '20260917040739_supplier_payment_profiles',
    ])
    expect(readRetirementMigration()).not.toHaveLength(0)

    // 新增的只是以字典稳定值为主键的配置；不得借 supplier_ 命名恢复主数据表或流水。
    const binding = readFileSync(resolve(serverRoot, `prisma/migrations/${bindingMigrationDirectory}/migration.sql`), 'utf8')
    expect([...binding.matchAll(/CREATE TABLE "([^"]+)"/gu)].map(match => match[1])).toEqual(['supplier_shipping_mark_rule_bindings'])
    expect(binding).toContain("t.code = 'service_provider.supplier'")
    expect(binding).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+"?(?:numbering_period_states|numbering_issuances|purchase_orders)\b/iu)
    expect(binding).not.toContain("'suppliers:")
  })

  it('removes Supplier models, relations, enum and audit labels from Prisma', () => {
    const schema = readSchema()

    for (const retiredDeclaration of [
      'enum SupplierEntityType',
      'model Supplier {',
      'model SupplierCreateRequest {',
      'SUPPLIER_CREATED',
      'SUPPLIER_UPDATED',
      'SUPPLIER_ENABLED',
      'SUPPLIER_DISABLED',
      'supplierRegistrations',
      'supplierAddressCountries',
      'supplierAddressProvinces',
      'supplierAddressCities',
      'supplier    Supplier?',
    ]) {
      expect(schema).not.toContain(retiredDeclaration)
    }
  })

  it('uses one strict transaction and the frozen lock order', () => {
    const migration = readRetirementMigration()
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain("SET LOCAL lock_timeout = '5s';")
    expect(migration).toContain("SET LOCAL statement_timeout = '10min';")
    for (const forbidden of [
      'CASCADE',
      'ON CONFLICT DO NOTHING',
      'session_replication_role',
      '_prisma_migrations',
    ]) {
      expect(migration).not.toContain(forbidden)
    }
    expect(migration).not.toMatch(
      /(?:CREATE|DROP|ALTER)\s+[\s\S]{0,80}\sIF\s+(?:NOT\s+)?EXISTS\b/iu,
    )

    const lockedTables = [
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
      'dictionary_items',
    ]
    let previousIndex = -1
    for (const table of lockedTables) {
      const statement = `LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE;`
      const currentIndex = migration.indexOf(statement)
      expect(currentIndex).toBeGreaterThan(previousIndex)
      previousIndex = currentIndex
    }
  })

  it('locks preconditions, identities, trigger state, RLS and audit semantics', () => {
    const migration = readRetirementMigration()
    for (const expectedText of [
      'supplier retirement precondition mismatch: tables',
      'supplier retirement precondition mismatch: functions',
      'supplier retirement precondition mismatch: triggers',
      'supplier retirement precondition mismatch: supplier trigger surface',
      'supplier retirement precondition mismatch: entity type',
      'supplier retirement precondition mismatch: permission identity',
      'supplier retirement precondition mismatch: dictionary identity occupied',
      'supplier retirement precondition mismatch: audit enum',
      'supplier retirement precondition mismatch: temporary audit enum occupied',
      'supplier retirement precondition mismatch: audit enum dependencies',
      'supplier retirement precondition mismatch: numbering triggers',
      'supplier retirement precondition mismatch: numbering trigger surface',
      'supplier retirement precondition mismatch: numbering dependencies',
      'supplier retirement precondition mismatch: supplier rule cardinality',
      'supplier retirement precondition mismatch: supplier numbering provenance',
      'supplier retirement precondition mismatch: consumer identity drift',
      'supplier retirement precondition mismatch: row level security',
      'supplier retirement precondition mismatch: mutation triggers',
      'supplier retirement precondition mismatch: mutation rules',
      'supplier retirement precondition mismatch: mutation dependencies',
      'supplier retirement precondition mismatch: permission dependency',
      'supplier retirement precondition mismatch: dictionary trigger',
      'supplier retirement precondition mismatch: audit identity drift',
    ]) {
      expect(migration).toContain(expectedText)
    }
    for (const [id, code] of SUPPLIER_PERMISSION_SEEDS) {
      expect(migration).toContain(`'${id}'`)
      expect(migration).toContain(`'${code}'`)
    }
  })

  it('bounds the legacy SUP Audit alias to the exact Supplier Rule lifecycle', () => {
    const migration = readRetirementMigration()
    const auditIdentityPreflight = migration.match(
      /FROM "audit_events" AS audit_entry[\s\S]*?supplier retirement precondition mismatch: audit identity drift/u,
    )?.[0]

    expect(auditIdentityPreflight).toBeDefined()
    expect(auditIdentityPreflight).toMatch(
      /"metadata" ->> 'ruleCode'[\s\S]*?NOT IN \('SUPPLIER', 'SUP'\)/u,
    )
    expect(auditIdentityPreflight).toMatch(
      /"metadata" ->> 'ruleCode' = 'SUP'[\s\S]*?supplier_rule_id IS NULL[\s\S]*?"event_type"::text NOT IN[\s\S]*?"target_type" IS DISTINCT FROM 'NumberingRule'[\s\S]*?"target_id"[\s\S]*?IS DISTINCT FROM supplier_rule_id::text/u,
    )
  })

  it('rejects rewrite rules on every table mutated by retirement', () => {
    const migration = readRetirementMigration()
    const rulePreflight = migration.match(
      /FROM pg_rewrite AS rewrite_entry[\s\S]*?supplier retirement precondition mismatch: mutation rules/u,
    )?.[0]

    expect(rulePreflight).toBeDefined()
    expect(rulePreflight).toContain("rewrite_entry.rulename <> '_RETURN'")
    for (const tableName of [
      'dictionary_types',
      'audit_events',
      'permissions',
      'role_permissions',
      'numbering_rules',
      'numbering_rule_versions',
      'numbering_rule_segments',
      'numbering_period_states',
      'numbering_issuances',
    ]) {
      expect(rulePreflight).toContain(`'${tableName}'`)
    }
  })

  it('creates only the fixed disabled supplier Dictionary Type', () => {
    const migration = readRetirementMigration()
    expect(migration).toContain(`'${SUPPLIER_DICTIONARY_TYPE_ID}'`)
    expect(migration).toContain("'service_provider.supplier'")
    expect(migration).toContain("'供应商'")
    expect(migration).toContain("'合作供方中的供应商列表'")
    expect(migration).toMatch(
      /INSERT INTO "dictionary_types"[\s\S]*?false,[\s\S]*?0,[\s\S]*?1[\s\S]*?;/u,
    )
    expect(migration).not.toContain('INSERT INTO "dictionary_items"')
    expect(migration).not.toContain('INSERT INTO "audit_events"')
  })

  it('performs precise deletion, trigger restoration and enum replacement', () => {
    const migration = readRetirementMigration()
    const normalizedMigration = migration.replaceAll(/\s+/gu, ' ')

    for (const statement of [
      'DROP TABLE "supplier_create_requests";',
      'DROP TABLE "suppliers";',
      'DROP FUNCTION "enforce_supplier_create_request_invariants"();',
      'DROP FUNCTION "enforce_supplier_invariants"();',
      'DROP TYPE "supplier_entity_type";',
      'ALTER TABLE "numbering_issuances" DISABLE TRIGGER "numbering_issuances_immutability_trigger";',
      'ALTER TABLE "numbering_rule_segments" DISABLE TRIGGER "numbering_rule_segments_parent_draft_trigger";',
      'ALTER TABLE "numbering_rule_versions" DISABLE TRIGGER "numbering_rule_versions_invariants_trigger";',
      'ALTER TABLE "numbering_rules" DISABLE TRIGGER "numbering_rules_invariants_trigger";',
      'ALTER TABLE "numbering_issuances" ENABLE TRIGGER "numbering_issuances_immutability_trigger";',
      'ALTER TABLE "numbering_rule_segments" ENABLE TRIGGER "numbering_rule_segments_parent_draft_trigger";',
      'ALTER TABLE "numbering_rule_versions" ENABLE TRIGGER "numbering_rule_versions_invariants_trigger";',
      'ALTER TABLE "numbering_rules" ENABLE TRIGGER "numbering_rules_invariants_trigger";',
      'DROP TYPE "audit_event_type";',
      'ALTER TYPE "audit_event_type_without_supplier" RENAME TO "audit_event_type";',
    ]) {
      expect(normalizedMigration).toContain(statement)
    }
    expect(extractCreatedEnumValues(
      migration,
      'audit_event_type_without_supplier',
    )).toEqual(RETAINED_AUDIT_EVENT_TYPES)
    expect(migration).toMatch(
      /ALTER TABLE "audit_events"[\s\S]*?"event_type"::text::"audit_event_type_without_supplier"/u,
    )
  })

  it('self-checks the complete retired boundary before commit', () => {
    const migration = readRetirementMigration()
    for (const assertion of [
      'supplier retirement invariant mismatch: dictionary type',
      'supplier retirement invariant mismatch: dictionary items',
      'supplier retirement invariant mismatch: schema objects',
      'supplier retirement invariant mismatch: permission catalog',
      'supplier retirement invariant mismatch: role grants',
      'supplier retirement invariant mismatch: numbering hierarchy',
      'supplier retirement invariant mismatch: supplier audit',
      'supplier retirement invariant mismatch: audit enum',
      'supplier retirement invariant mismatch: audit index',
      'supplier retirement invariant mismatch: numbering triggers',
      'supplier retirement invariant mismatch: protected baseline',
    ]) {
      expect(migration).toContain(assertion)
    }
  })
})
