import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationDirectory = '20260812100000_product_created_audit_event'
const migrationPath = resolve(
  serverRoot,
  `prisma/migrations/${migrationDirectory}/migration.sql`,
)

function extractEnumValues(schema: string, enumName: string): readonly string[] {
  const match = schema.match(new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\n\\}`, 'u'))
  if (!match?.[1]) throw new Error(`Missing Prisma enum ${enumName}`)

  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('@@'))
}

describe('product create audit database schema', () => {
  it('appends PRODUCT_CREATED to the Prisma AuditEventType enum', () => {
    const values = extractEnumValues(readFileSync(schemaPath, 'utf8'), 'AuditEventType')

    expect(values).toContain('PRODUCT_CREATED')
    expect(values.filter(value => value === 'PRODUCT_CREATED')).toHaveLength(1)
  })

  it('uses one exact forward migration that only extends the audit enum', () => {
    const matchingDirectories = readdirSync(
      resolve(serverRoot, 'prisma/migrations'),
      { withFileTypes: true },
    )
      .filter(entry => entry.isDirectory() && entry.name.includes('product_created_audit_event'))
      .map(entry => entry.name)
      .sort()

    expect(matchingDirectories).toEqual([migrationDirectory])

    const migration = readFileSync(migrationPath, 'utf8')

    // 精确文本约束防止本次审计扩展夹带表结构、权限或业务 seed。
    expect(migration).toBe([
      'BEGIN;',
      '',
      'ALTER TYPE "audit_event_type" ADD VALUE \'PRODUCT_CREATED\';',
      '',
      'COMMIT;',
      '',
    ].join('\n'))
    expect(migration).not.toMatch(/\b(?:CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/iu)
    expect(migration).not.toMatch(/\bALTER\s+(?:TABLE|DOMAIN)\b/iu)
    expect(migration).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/iu)
    expect(migration).not.toMatch(/\b(?:curl|fetch|https?):/iu)
  })
})
