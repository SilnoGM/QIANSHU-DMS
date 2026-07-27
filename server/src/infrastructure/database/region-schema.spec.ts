import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { MANAGEMENT_PERMISSION_CODES } from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260727090000_regions_schema_and_permissions/migration.sql',
)

function readSchema(): string {
  return readFileSync(schemaPath, 'utf8')
}

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8')
}

function extractModel(schema: string, modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`),
  )

  if (!match?.[1]) {
    throw new Error(`Missing Prisma model ${modelName}`)
  }

  return match[1]
}

describe('region database schema', () => {
  it('defines the fixed three-level Prisma model without persisted effective state', () => {
    const schema = readSchema()
    const region = extractModel(schema, 'Region')

    expect(schema).toMatch(
      /enum RegionLevel \{\s+COUNTRY_REGION\s+PROVINCE_STATE\s+CITY\s+@@map\("region_level"\)\s+\}/u,
    )
    for (const field of [
      'id',
      'code',
      'name',
      'normalizedName',
      'englishName',
      'sourceName',
      'sourceCode',
      'administrativeType',
      'level',
      'parentId',
      'enabled',
      'sortOrder',
      'createdAt',
      'updatedAt',
      'parent',
      'children',
    ]) {
      expect(region).toMatch(new RegExp(`\\n\\s*${field}\\s`, 'u'))
    }

    expect(region).not.toContain('effectiveEnabled')
    expect(region).toContain('@unique(map: "regions_code_key")')
    expect(region).toContain(
      '@@unique([parentId, normalizedName], map: "regions_parent_id_normalized_name_key")',
    )
    expect(region).toContain(
      '@@index([parentId, sortOrder, normalizedName, id], map: "regions_parent_id_sort_order_name_id_idx")',
    )
    expect(region).toContain(
      '@@index([level, enabled, normalizedName, id], map: "regions_level_enabled_name_id_idx")',
    )
    expect(region).toMatch(
      /parent\s+Region\?\s+@relation\("RegionHierarchy", fields: \[parentId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/u,
    )
    expect(region).toContain('children Region[] @relation("RegionHierarchy")')
    expect(region).toContain('@@map("regions")')
  })

  it('creates every named database constraint, index and restrictive parent foreign key', () => {
    const migration = readMigration()

    for (const constraintName of [
      'regions_pkey',
      'regions_code_format_check',
      'regions_name_nonblank_check',
      'regions_normalized_name_nonblank_check',
      'regions_english_name_nonblank_check',
      'regions_source_name_nonblank_check',
      'regions_source_code_ascii_check',
      'regions_administrative_type_format_check',
      'regions_sort_order_nonnegative_check',
      'regions_parent_shape_check',
      'regions_no_self_parent_check',
      'regions_parent_id_fkey',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraintName}"`)
    }

    for (const indexName of [
      'regions_code_key',
      'regions_parent_id_normalized_name_key',
      'regions_root_normalized_name_key',
      'regions_parent_id_sort_order_name_id_idx',
      'regions_level_enabled_name_id_idx',
    ]) {
      expect(migration).toContain(`INDEX "${indexName}"`)
    }

    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "regions_root_normalized_name_key"[\s\S]*?WHERE "parent_id" IS NULL;/u,
    )
    expect(migration).toMatch(
      /CONSTRAINT "regions_parent_id_fkey"[\s\S]*?ON DELETE RESTRICT ON UPDATE RESTRICT;/u,
    )
  })

  it('uses one database trigger as the final hierarchy and identity boundary', () => {
    const migration = readMigration()

    expect(migration).toContain(
      'CREATE FUNCTION "enforce_region_hierarchy"()',
    )
    expect(migration).toContain('FOR SHARE')
    expect(migration).toContain(
      "WHEN 'PROVINCE_STATE' THEN 'COUNTRY_REGION'::\"region_level\"",
    )
    expect(migration).toContain(
      "WHEN 'CITY' THEN 'PROVINCE_STATE'::\"region_level\"",
    )
    expect(migration).toContain(
      "CONSTRAINT = 'regions_identity_immutable_check'",
    )
    expect(migration).toContain(
      "CONSTRAINT = 'regions_hierarchy_check'",
    )
    for (const column of ['id', 'code', 'level', 'parent_id']) {
      expect(migration).toMatch(
        new RegExp(
          `NEW\\."${column}" IS DISTINCT FROM OLD\\."${column}"`,
          'u',
        ),
      )
    }
    expect(migration).toMatch(
      /CREATE TRIGGER "regions_hierarchy_trigger"[\s\S]*?BEFORE INSERT OR UPDATE OF "id", "code", "level", "parent_id"[\s\S]*?EXECUTE FUNCTION "enforce_region_hierarchy"\(\);/u,
    )
  })

  it('adds assignable region permissions, system administrator grants and audit events atomically', () => {
    const migration = readMigration()
    const permissionSeeds = [
      ['00000000-0000-4000-8000-000000000113', 'regions:read'],
      ['00000000-0000-4000-8000-000000000114', 'regions:create'],
      ['00000000-0000-4000-8000-000000000115', 'regions:update'],
      ['00000000-0000-4000-8000-000000000116', 'regions:enable'],
      ['00000000-0000-4000-8000-000000000117', 'regions:disable'],
    ] as const

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)

    for (const eventType of [
      'REGION_CREATED',
      'REGION_UPDATED',
      'REGION_ENABLED',
      'REGION_DISABLED',
    ]) {
      expect(readSchema()).toContain(`  ${eventType}`)
      expect(migration).toContain(
        `ALTER TYPE "audit_event_type" ADD VALUE '${eventType}'`,
      )
    }

    for (const [id, code] of permissionSeeds) {
      expect(migration).toMatch(
        new RegExp(`'${id}',\\s*'${code}'[\\s\\S]*?false`, 'u'),
      )
      expect(migration).toContain(`'${code}'`)
      expect(MANAGEMENT_PERMISSION_CODES).toContain(code)
    }

    expect(migration).toMatch(
      /INSERT INTO "role_permissions"[\s\S]*?'00000000-0000-4000-8000-000000000001'[\s\S]*?WHERE "code" IN \([\s\S]*?'regions:read'[\s\S]*?'regions:disable'[\s\S]*?\);/u,
    )
  })
})
