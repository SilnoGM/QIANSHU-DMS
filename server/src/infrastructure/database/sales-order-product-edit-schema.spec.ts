import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationDirectory = '20260902160000_sales_order_product_editing'
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations',
  migrationDirectory,
  'migration.sql',
)

function extractBlock(
  source: string,
  keyword: 'enum' | 'model',
  name: string,
): string {
  const match = source.match(
    new RegExp(`${keyword} ${name} \\{([\\s\\S]*?)\\n\\}`, 'u'),
  )
  if (!match?.[1]) throw new Error(`Missing Prisma ${keyword} ${name}`)
  return match[1]
}

function enumValues(schema: string, enumName: string): readonly string[] {
  return extractBlock(schema, 'enum', enumName)
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[A-Z][A-Z0-9_]*$/u.test(line))
}

describe('sales order product editing database schema', () => {
  it('publishes one soft-removal field and one products-changed audit event', () => {
    const schema = readFileSync(schemaPath, 'utf8')
    const salesOrderLine = extractBlock(schema, 'model', 'SalesOrderLine')
    const auditEvents = enumValues(schema, 'AuditEventType')

    expect(salesOrderLine).toContain(
      'removedAt                 DateTime?          @map("removed_at") @db.Timestamptz(6)',
    )
    expect(auditEvents.filter(value => value === 'SALES_ORDER_PRODUCTS_CHANGED'))
      .toHaveLength(1)
  })

  it('uses one append-only migration without business-data backfill', () => {
    const matchingDirectories = readdirSync(
      resolve(serverRoot, 'prisma/migrations'),
      { withFileTypes: true },
    )
      .filter(entry => (
        entry.isDirectory()
        && entry.name.includes('sales_order_product_editing')
      ))
      .map(entry => entry.name)
      .sort()

    expect(matchingDirectories).toEqual([migrationDirectory])
    const migration = readFileSync(migrationPath, 'utf8')
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain(
      'ALTER TYPE "audit_event_type" ADD VALUE \'SALES_ORDER_PRODUCTS_CHANGED\';',
    )
    expect(migration).toContain(
      'ALTER TABLE "sales_order_lines" ADD COLUMN "removed_at" TIMESTAMPTZ(6);',
    )
    expect(migration).not.toMatch(
      /(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?"sales_order_lines"/iu,
    )
    expect(migration).not.toContain('IF NOT EXISTS')
    expect(migration).not.toContain('ADD VALUE IF NOT EXISTS')
  })

  it('counts only active sales lines and retains at least one active line', () => {
    const migration = readFileSync(migrationPath, 'utf8')
    const subtotalFunction = migration.match(
      /CREATE OR REPLACE FUNCTION "enforce_sales_order_line_subtotal"\(\)[\s\S]*?\n\$\$;/u,
    )?.[0]

    expect(subtotalFunction).toBeDefined()
    expect(subtotalFunction).toContain('"removed_at" IS NULL')
    expect(subtotalFunction).toContain('line_count < 1')
    expect(subtotalFunction).toContain(
      "CONSTRAINT = 'sales_order_lines_subtotal_check'",
    )
  })

  it('rejects active purchase references to removed sales lines but preserves cancelled history', () => {
    const migration = readFileSync(migrationPath, 'utf8')
    const sourceFunction = migration.match(
      /CREATE OR REPLACE FUNCTION "enforce_purchase_order_line_source"\(\)[\s\S]*?\n\$\$;/u,
    )?.[0]

    expect(sourceFunction).toBeDefined()
    expect(sourceFunction).toMatch(
      /purchase_order\."order_status" <> 'CANCELLED'[\s\S]*?sales_line\."removed_at" IS NOT NULL/u,
    )
    expect(sourceFunction).toContain(
      "CONSTRAINT = 'purchase_order_lines_source_shape_check'",
    )
  })

  it('rejects every removed sales line that still has an active purchased quantity', () => {
    const migration = readFileSync(migrationPath, 'utf8')
    const quantityFunction = migration.match(
      /CREATE OR REPLACE FUNCTION "enforce_purchase_order_source_quantity"\(\)[\s\S]*?\n\$\$;/u,
    )?.[0]

    expect(quantityFunction).toBeDefined()
    expect(quantityFunction).toMatch(
      /sales_line\."removed_at" IS NOT NULL[\s\S]*?purchased\."purchased_quantity" > 0/u,
    )
    expect(quantityFunction).toContain(
      "CONSTRAINT = 'purchase_order_source_quantity_check'",
    )
    expect(migration).toMatch(
      /CREATE CONSTRAINT TRIGGER "sales_order_lines_source_quantity_trigger"[\s\S]*?AFTER UPDATE OF "quantity", "removed_at" ON "sales_order_lines"[\s\S]*?EXECUTE FUNCTION "enforce_purchase_order_source_quantity"\(\);/u,
    )
  })
})
