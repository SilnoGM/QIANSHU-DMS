import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { MANAGEMENT_PERMISSION_CODES } from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationDirectory =
  '20260805090000_supplier_management_schema_and_permissions'
const migrationPath = resolve(
  serverRoot,
  `prisma/migrations/${migrationDirectory}/migration.sql`,
)

const SUPPLIER_PERMISSION_SEEDS = [
  ['00000000-0000-4000-8000-000000000138', 'suppliers:read'],
  ['00000000-0000-4000-8000-000000000139', 'suppliers:create'],
  ['00000000-0000-4000-8000-000000000140', 'suppliers:update'],
  ['00000000-0000-4000-8000-000000000141', 'suppliers:enable'],
  ['00000000-0000-4000-8000-000000000142', 'suppliers:disable'],
] as const

const SUPPLIER_AUDIT_EVENT_TYPES = [
  'SUPPLIER_CREATED',
  'SUPPLIER_UPDATED',
  'SUPPLIER_ENABLED',
  'SUPPLIER_DISABLED',
] as const

function readSchema(): string {
  return readFileSync(schemaPath, 'utf8')
}

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8')
}

function extractBlock(
  source: string,
  keyword: 'enum' | 'model',
  name: string,
): string {
  const match = source.match(
    new RegExp(`${keyword} ${name} \\{([\\s\\S]*?)\\n\\}`, 'u'),
  )

  if (!match?.[1]) {
    throw new Error(`Missing Prisma ${keyword} ${name}`)
  }
  return match[1]
}

function extractEnumValues(schema: string, enumName: string): string[] {
  return extractBlock(schema, 'enum', enumName)
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[A-Z][A-Z0-9_]*$/u.test(line))
}

describe('supplier management database schema', () => {
  it('defines the confirmed entity type and two global Prisma models', () => {
    const schema = readSchema()
    const supplier = extractBlock(schema, 'model', 'Supplier')
    const createRequest = extractBlock(schema, 'model', 'SupplierCreateRequest')

    expect(extractEnumValues(schema, 'SupplierEntityType')).toEqual([
      'ORGANIZATION',
      'INDIVIDUAL',
    ])
    for (const field of [
      'id', 'code', 'numberingIssuanceId', 'legalName',
      'normalizedLegalName', 'shortName', 'normalizedShortName', 'entityType',
      'registrationCountryRegionId', 'registrationNumber',
      'normalizedRegistrationNumber', 'contactName', 'normalizedContactName',
      'contactPhone', 'normalizedContactPhone', 'contactWechatId',
      'normalizedContactWechatId', 'addressCountryRegionId',
      'addressProvinceStateId', 'addressCityId', 'addressLine', 'postalCode',
      'remark', 'enabled', 'version', 'createdAt', 'updatedAt',
      'numberingIssuance', 'registrationCountryRegion', 'addressCountryRegion',
      'addressProvinceState', 'addressCity', 'createRequest',
    ]) {
      expect(supplier).toMatch(new RegExp(`\\n\\s*${field}\\s`, 'u'))
    }
    expect(supplier).toContain('@unique(map: "suppliers_code_key")')
    expect(supplier).toContain(
      '@unique(map: "suppliers_numbering_issuance_id_key")',
    )
    expect(supplier).toContain(
      '@@unique([registrationCountryRegionId, normalizedRegistrationNumber], map: "suppliers_registration_country_number_key")',
    )
    expect(supplier).toContain('@@map("suppliers")')

    for (const field of [
      'id', 'idempotencyScopeHash', 'requestFingerprintHash', 'supplierId',
      'createdAt', 'supplier',
    ]) {
      expect(createRequest).toMatch(new RegExp(`\\n\\s*${field}\\s`, 'u'))
    }
    expect(createRequest).toContain(
      '@unique(map: "supplier_create_requests_idempotency_scope_hash_key")',
    )
    expect(createRequest).toContain(
      '@unique(map: "supplier_create_requests_supplier_id_key")',
    )
    expect(createRequest).toContain('@@map("supplier_create_requests")')

    for (const rejectedField of [
      'tenantId', 'organizationId', 'deletedAt', 'archivedAt', 'website',
      'email', 'position', 'bankAccount', 'paymentTerm',
    ]) {
      expect(supplier).not.toContain(rejectedField)
      expect(createRequest).not.toContain(rejectedField)
    }
  })

  it('creates exact constraints, indexes, restrictive FKs and final triggers', () => {
    const migration = readMigration()

    for (const constraintName of [
      'suppliers_pkey', 'suppliers_code_nonblank_check',
      'suppliers_legal_name_nonblank_check',
      'suppliers_normalized_legal_name_nonblank_check',
      'suppliers_registration_shape_check', 'suppliers_address_region_prefix_check',
      'suppliers_enable_requirements_check', 'suppliers_version_positive_check',
      'supplier_create_requests_pkey',
      'supplier_create_requests_idempotency_scope_hash_32_bytes_check',
      'supplier_create_requests_request_fingerprint_hash_32_bytes_check',
      'suppliers_numbering_issuance_id_fkey',
      'suppliers_registration_country_region_id_fkey',
      'suppliers_address_country_region_id_fkey',
      'suppliers_address_province_state_id_fkey',
      'suppliers_address_city_id_fkey',
      'supplier_create_requests_supplier_id_fkey',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraintName}"`)
    }
    for (const indexName of [
      'suppliers_code_key', 'suppliers_numbering_issuance_id_key',
      'suppliers_registration_country_number_key',
      'suppliers_enabled_updated_at_id_idx',
      'suppliers_entity_type_updated_at_id_idx',
      'suppliers_normalized_legal_name_pattern_idx',
      'suppliers_normalized_short_name_pattern_idx',
      'supplier_create_requests_idempotency_scope_hash_key',
      'supplier_create_requests_supplier_id_key',
    ]) {
      expect(migration).toContain(`INDEX "${indexName}"`)
    }
    expect(migration).toMatch(
      /CONSTRAINT "suppliers_numbering_issuance_id_fkey"[\s\S]*?ON DELETE RESTRICT ON UPDATE RESTRICT;/u,
    )
    expect(migration).toMatch(
      /CREATE TRIGGER "suppliers_invariants_trigger"[\s\S]*?EXECUTE FUNCTION "enforce_supplier_invariants"\(\);/u,
    )
    expect(migration).toMatch(
      /CREATE TRIGGER "supplier_create_requests_invariants_trigger"[\s\S]*?EXECUTE FUNCTION "enforce_supplier_create_request_invariants"\(\);/u,
    )
    expect(migration).toContain("CONSTRAINT = 'suppliers_delete_check'")
    expect(migration).toContain(
      "CONSTRAINT = 'suppliers_identity_immutable_check'",
    )
    expect(migration).toContain(
      "CONSTRAINT = 'suppliers_numbering_provenance_check'",
    )
    expect(migration).toContain(
      "CONSTRAINT = 'supplier_create_requests_delete_check'",
    )
    expect(migration).toContain(
      "CONSTRAINT = 'supplier_create_requests_immutable_check'",
    )
  })

  it('adds exact permissions, system administrator grants and audit events', () => {
    const migration = readMigration()
    const schema = readSchema()

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).not.toContain('IF NOT EXISTS')
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    for (const eventType of SUPPLIER_AUDIT_EVENT_TYPES) {
      expect(schema).toContain(`  ${eventType}`)
      expect(migration).toContain(
        `ALTER TYPE "audit_event_type" ADD VALUE '${eventType}'`,
      )
    }
    for (const [id, code] of SUPPLIER_PERMISSION_SEEDS) {
      expect(migration).toContain(`'${id}'`)
      expect(migration).toContain(`'${code}'`)
    }
    expect(MANAGEMENT_PERMISSION_CODES.slice(-5)).toEqual(
      SUPPLIER_PERMISSION_SEEDS.map(([, code]) => code),
    )
    expect(migration).toMatch(
      /role\."code" = 'system_admin'[\s\S]*?'suppliers:read'[\s\S]*?'suppliers:disable'/u,
    )
  })

  it('self-checks physical boundaries and keeps supplier business data empty', () => {
    const migration = readMigration()

    for (const assertion of [
      'supplier migration invariant mismatch: table count',
      'supplier migration invariant mismatch: constraint count',
      'supplier migration invariant mismatch: index count',
      'supplier migration invariant mismatch: function count',
      'supplier migration invariant mismatch: trigger count',
      'supplier migration invariant mismatch: entity type enum',
      'supplier migration invariant mismatch: permission catalog',
      'supplier migration invariant mismatch: system admin grants',
      'supplier migration invariant mismatch: audit event count',
      'supplier migration invariant mismatch: supplier seed',
      'supplier migration invariant mismatch: create request seed',
    ]) {
      expect(migration).toContain(assertion)
    }
    expect(migration).not.toContain('INSERT INTO "suppliers"')
    expect(migration).not.toContain('INSERT INTO "supplier_create_requests"')
    expect(migration).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE)\s+"numbering_rules"/iu,
    )
  })

  it('keeps one append-only supplier migration with no business seed', () => {
    const migrationDirectories = readdirSync(
      resolve(serverRoot, 'prisma/migrations'),
      { withFileTypes: true },
    )
      .filter(entry => entry.isDirectory() && entry.name.includes('supplier_'))
      .map(entry => entry.name)
      .sort()

    expect(migrationDirectories).toEqual([migrationDirectory])
  })
})
