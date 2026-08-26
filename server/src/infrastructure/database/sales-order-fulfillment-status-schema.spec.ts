import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20260826160000_expand_sales_order_fulfillment_status'
const migrationPath = resolve(migrationsRoot, migrationDirectory, 'migration.sql')

function extractPrismaEnum(source: string, name: string): readonly string[] {
  const match = source.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`, 'u'))
  if (!match?.[1]) throw new Error(`Missing Prisma enum ${name}`)
  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('@@'))
}

describe('sales order fulfillment status schema', () => {
  it('publishes the confirmed six-state Prisma enum in business order', () => {
    const schema = readFileSync(schemaPath, 'utf8')

    expect(extractPrismaEnum(schema, 'SalesOrderFulfillmentStatus')).toEqual([
      'PENDING',
      'PREPARING',
      'LAND_TRANSIT',
      'WAREHOUSE_ARRIVED',
      'SEA_TRANSIT',
      'SIGNED',
    ])
  })

  it('appends one strict migration for current state, history and audit metadata', () => {
    const matchingDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.includes('fulfillment_status'))
      .map(entry => entry.name)
      .sort()
    expect(matchingDirectories).toEqual([migrationDirectory])

    const migration = readFileSync(migrationPath, 'utf8')
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain('sales_order_fulfillment_status_next')
    for (const status of [
      'PENDING',
      'PREPARING',
      'LAND_TRANSIT',
      'WAREHOUSE_ARRIVED',
      'SEA_TRANSIT',
      'SIGNED',
    ]) {
      expect(migration).toContain(`'${status}'`)
    }
    expect(migration).toContain("WHEN 'SHIPPED' THEN 'LAND_TRANSIT'")
    expect(migration).toContain('"dimension" = \'FULFILLMENT\'')
    expect(migration).toContain('"event_type" = \'SALES_ORDER_FULFILLMENT_STATUS_CHANGED\'')
    expect(migration).toContain("jsonb_set")
    expect(migration).toContain('fulfillment status migration invariant mismatch: current status')
    expect(migration).toContain('fulfillment status migration invariant mismatch: history')
    expect(migration).toContain('fulfillment status migration invariant mismatch: audit metadata')
    expect(migration).not.toMatch(/UPDATE\s+"sales_orders"/iu)
    expect(migration).not.toMatch(/"version"|"updated_at"/u)
    expect(migration).not.toMatch(
      /(?:CREATE|DROP|ALTER)\s+[\s\S]{0,80}\sIF\s+(?:NOT\s+)?EXISTS\b/iu,
    )
    expect(migration).not.toMatch(/\bCASCADE\b/iu)
  })
})
