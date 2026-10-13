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

    // 代收回填专用值追加在末尾（与数据库枚举顺序一致）：DOC 注释允许出现在值之前。
    expect(extractPrismaBlock(schema, 'enum', 'SalesOrderPaymentType')).toMatch(
      /DEPOSIT\s+PROGRESS\s+INVOICE_TAX\s+BALANCE\s+OTHER\s+(?:\/\/\/[^\n]*\n\s*)?COD_BALANCE\s+@@map\("sales_order_payment_type"\)/u,
    )
    expect(extractPrismaBlock(schema, 'enum', 'SalesOrderPaymentOrigin')).toMatch(
      /LEGACY\s+REVIEWED\s+(?:\/\/\/[^\n]*\n\s*)?COD_SETTLEMENT\s+@@map\("sales_order_payment_origin"\)/u,
    )
    expect(extractPrismaBlock(schema, 'enum', 'SalesOrderDocumentType')).toMatch(
      /ORDER_ISSUANCE_VOUCHER\s+PAYMENT_VOUCHER\s+DELIVERY_RECEIPT\s+@@map\("sales_order_document_type"\)/u,
    )

    const payment = extractPrismaBlock(schema, 'model', 'SalesOrderPayment')
    expect(payment).not.toMatch(/^\s*referenceNo\s/mu)
    // 代收回填的溯源锚点：可空、唯一，指向产生这笔收款的结算记录。
    expect(payment).toMatch(/slhReconciliationSettlementId String\? @unique\(map: "sales_order_payments_reconciliation_settlement_key"\)/u)
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
