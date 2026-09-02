import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationDirectory = '20260902100000_sales_order_product_appended_audit_event'
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations',
  migrationDirectory,
  'migration.sql',
)

function extractEnumValues(schema: string, enumName: string): readonly string[] {
  const match = schema.match(new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\n\\}`, 'u'))
  if (!match?.[1]) throw new Error(`Missing Prisma enum ${enumName}`)

  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('@@'))
}

describe('sales order add-on audit schema', () => {
  it('publishes one SALES_ORDER_PRODUCT_APPENDED audit event in Prisma', () => {
    const values = extractEnumValues(readFileSync(schemaPath, 'utf8'), 'AuditEventType')

    expect(values).toContain('SALES_ORDER_PRODUCT_APPENDED')
    expect(values.filter(value => value === 'SALES_ORDER_PRODUCT_APPENDED'))
      .toHaveLength(1)
  })

  it('uses one exact migration that only appends the audit enum value', () => {
    const matchingDirectories = readdirSync(
      resolve(serverRoot, 'prisma/migrations'),
      { withFileTypes: true },
    )
      .filter(entry => (
        entry.isDirectory()
        && entry.name.includes('sales_order_product_appended_audit_event')
      ))
      .map(entry => entry.name)
      .sort()

    expect(matchingDirectories).toEqual([migrationDirectory])
    const migration = readFileSync(migrationPath, 'utf8')

    // 精确文本约束阻止本次审计枚举扩展夹带业务表、权限、索引或数据回填。
    expect(migration).toBe([
      'BEGIN;',
      '',
      'ALTER TYPE "audit_event_type" ADD VALUE \'SALES_ORDER_PRODUCT_APPENDED\';',
      '',
      'COMMIT;',
      '',
    ].join('\n'))
    expect(migration).not.toMatch(
      /\b(?:CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE)\b/iu,
    )
    expect(migration).not.toMatch(/\bALTER\s+(?:TABLE|DOMAIN)\b/iu)
    expect(migration).not.toMatch(/\b(?:INDEX|CONSTRAINT|COLUMN)\b/iu)
    expect(migration).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/iu)
  })
})
