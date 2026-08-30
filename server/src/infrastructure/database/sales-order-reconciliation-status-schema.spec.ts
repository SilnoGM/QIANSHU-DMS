import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationDirectory = '20260830120000_expand_sales_order_status_reconciliation'
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations',
  migrationDirectory,
  'migration.sql',
)

function extractPrismaEnum(source: string, name: string): readonly string[] {
  const match = source.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`, 'u'))
  if (!match?.[1]) throw new Error(`Missing Prisma enum ${name}`)
  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('@@'))
}

describe('sales order reconciliation status schema', () => {
  it('publishes the five-state order enum in business order', () => {
    const schema = readFileSync(schemaPath, 'utf8')

    expect(extractPrismaEnum(schema, 'SalesOrderStatus')).toEqual([
      'DRAFT',
      'CONFIRMED',
      'PENDING_RECONCILIATION',
      'COMPLETED',
      'CANCELLED',
    ])
  })

  it('appends one atomic enum migration with the completed-order invariant', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain('sales_order_status_next')
    for (const status of [
      'DRAFT',
      'CONFIRMED',
      'PENDING_RECONCILIATION',
      'COMPLETED',
      'CANCELLED',
    ]) {
      expect(migration).toContain(`'${status}'`)
    }
    expect(migration).toContain('sales_orders_completed_requires_signed_paid_check')
    expect(migration).toMatch(/"order_status"\s*<>\s*'COMPLETED'/u)
    expect(migration).toMatch(/"fulfillment_status"\s*=\s*'SIGNED'/u)
    expect(migration).toMatch(/"payment_status"\s*=\s*'PAID'/u)
    expect(migration).toContain('sales order status migration invariant mismatch: enum values')
    expect(migration).toContain('sales order status migration invariant mismatch: completed order')
    expect(migration).not.toMatch(/UPDATE\s+"sales_orders"/iu)
    expect(migration).not.toMatch(/"version"|"updated_at"/u)
    expect(migration).not.toMatch(/\bCASCADE\b/iu)
  })
})
