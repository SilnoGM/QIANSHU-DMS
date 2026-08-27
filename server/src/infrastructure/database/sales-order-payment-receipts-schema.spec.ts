import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260825120000_sales_order_payment_and_receipt_semantics/migration.sql',
)

function extractPrismaBlock(source: string, kind: 'enum' | 'model', name: string): string {
  const match = source.match(
    new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`, 'u'),
  )
  if (!match?.[1]) throw new Error(`Missing Prisma ${kind} ${name}`)
  return match[1]
}

describe('sales order payment and receipt schema', () => {
  it('uses the confirmed payment and document types without referenceNo', () => {
    const schema = readFileSync(schemaPath, 'utf8')

    expect(extractPrismaBlock(schema, 'enum', 'SalesOrderPaymentType')).toMatch(
      /DEPOSIT\s+PROGRESS\s+INVOICE_TAX\s+BALANCE\s+OTHER\s+@@map\("sales_order_payment_type"\)/u,
    )
    expect(extractPrismaBlock(schema, 'enum', 'SalesOrderDocumentType')).toMatch(
      /ORDER_ISSUANCE_VOUCHER\s+PAYMENT_VOUCHER\s+DELIVERY_RECEIPT\s+@@map\("sales_order_document_type"\)/u,
    )

    const payment = extractPrismaBlock(schema, 'model', 'SalesOrderPayment')
    expect(payment).not.toMatch(/^\s*referenceNo\s/mu)
  })

  it('migrates old data fail-closed and enforces document relationship cardinality', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain('DROP COLUMN "reference_no"')
    expect(migration).toContain('sales_order_documents_payment_shape_check')
    expect(migration).toContain('sales_order_documents_active_issuance_voucher_key')
    expect(migration).toContain('sales_order_documents_active_payment_voucher_key')
    expect(migration).toContain("'ORDER_ISSUANCE_VOUCHER'")
    expect(migration).toContain("'PAYMENT_VOUCHER'")
    expect(migration).toContain("'DELIVERY_RECEIPT'")
    expect(migration).toContain('multiple active issuance vouchers')
    expect(migration).toContain('multiple active payment vouchers')
    expect(migration).toContain('invalid payment relation shape')
  })
})
