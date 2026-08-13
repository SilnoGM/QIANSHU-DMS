import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MANAGEMENT_PERMISSION_CODES,
  PRODUCT_MANAGEMENT_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const permissionMigrationDirectory = '20260813110000_product_update_permission'
const auditMigrationDirectory = '20260813111000_product_updated_audit_event'

function extractEnumValues(schema: string, enumName: string): readonly string[] {
  const match = schema.match(new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\n\\}`, 'u'))
  if (!match?.[1]) throw new Error(`Missing Prisma enum ${enumName}`)

  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('@@'))
}

describe('product update permission and audit schema', () => {
  it('extends the product permission contract without changing earlier permissions', () => {
    expect(PRODUCT_MANAGEMENT_PERMISSION_CODES).toEqual([
      'products:read',
      'products:create',
      'products:update',
    ])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...PRODUCT_MANAGEMENT_PERMISSION_CODES]),
    )
    expect(new Set(MANAGEMENT_PERMISSION_CODES).size).toBe(
      MANAGEMENT_PERMISSION_CODES.length,
    )
  })

  it('adds one exact update permission and grants it to system_admin atomically', () => {
    const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.includes('product_update_permission'))
      .map(entry => entry.name)
      .sort()
    expect(migrationDirectories).toEqual([permissionMigrationDirectory])

    const migration = readFileSync(
      resolve(migrationsRoot, permissionMigrationDirectory, 'migration.sql'),
      'utf8',
    )
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toMatch(
      /'00000000-0000-4000-8000-000000000145',\s*'products:update',\s*'编辑产品'[\s\S]*?false/u,
    )
    expect(migration).toMatch(
      /role\."id" = '00000000-0000-4000-8000-000000000001'[\s\S]*?role\."code" = 'system_admin'[\s\S]*?permission\."id" = '00000000-0000-4000-8000-000000000145'[\s\S]*?permission\."code" = 'products:update'/u,
    )
    expect(migration).toContain(
      'product update permission migration invariant mismatch: permission catalog',
    )
    expect(migration).toContain(
      'product update permission migration invariant mismatch: system admin grant',
    )
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE)\b/iu)
  })

  it('appends PRODUCT_UPDATED through one enum-only migration', () => {
    const schema = readFileSync(resolve(serverRoot, 'prisma/schema.prisma'), 'utf8')
    const values = extractEnumValues(schema, 'AuditEventType')
    expect(values.filter(value => value === 'PRODUCT_UPDATED')).toHaveLength(1)

    const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.includes('product_updated_audit_event'))
      .map(entry => entry.name)
      .sort()
    expect(migrationDirectories).toEqual([auditMigrationDirectory])

    const migration = readFileSync(
      resolve(migrationsRoot, auditMigrationDirectory, 'migration.sql'),
      'utf8',
    )
    expect(migration).toBe([
      'BEGIN;',
      '',
      'ALTER TYPE "audit_event_type" ADD VALUE \'PRODUCT_UPDATED\';',
      '',
      'COMMIT;',
      '',
    ].join('\n'))
    expect(migration).not.toMatch(/\b(?:CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/iu)
    expect(migration).not.toMatch(/\bALTER\s+(?:TABLE|DOMAIN)\b/iu)
  })
})
