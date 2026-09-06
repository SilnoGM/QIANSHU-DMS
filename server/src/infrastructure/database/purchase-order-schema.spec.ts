import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MANAGEMENT_PERMISSION_CODES,
  PURCHASE_ORDER_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260827120000_purchase_order_domain/migration.sql',
)
const fulfillmentStatusMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260831120000_remove_purchase_order_pending_order/migration.sql',
)
const completionStatusMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260831130000_purchase_order_auto_completion/migration.sql',
)
const productModeMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260904160000_purchase_order_product_mode/migration.sql',
)

function extractPrismaBlock(
  source: string,
  kind: 'enum' | 'model',
  name: string,
): string {
  const match = source.match(
    new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`, 'u'),
  )
  if (!match?.[1]) throw new Error(`Missing Prisma ${kind} ${name}`)
  return match[1]
}

function enumValues(source: string, name: string): readonly string[] {
  return extractPrismaBlock(source, 'enum', name)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('@@'))
}

describe('purchase order domain schema', () => {
  it('publishes the exact purchase enums and six domain models', () => {
    const schema = readFileSync(schemaPath, 'utf8')

    expect(enumValues(schema, 'PurchaseOrderType')).toEqual([
      'SALES_LINKED',
      'STOCK',
    ])
    expect(enumValues(schema, 'PurchaseOrderStatus')).toEqual([
      'CONFIRMED',
      'COMPLETED',
      'CANCELLED',
    ])
    expect(enumValues(schema, 'PurchaseOrderFulfillmentStatus')).toEqual([
      'ORDERED',
      'PREPARING',
      'SHIPPED',
      'SIGNED',
    ])
    expect(enumValues(schema, 'PurchaseOrderPaymentStatus')).toEqual([
      'UNPAID',
      'PARTIALLY_PAID',
      'PAID',
    ])
    expect(enumValues(schema, 'PurchaseOrderLineType')).toEqual([
      'CATALOG',
      'CUSTOM',
    ])
    expect(enumValues(schema, 'PurchaseOrderProductMode')).toEqual([
      'CATALOG',
      'CUSTOM',
      'MIXED',
    ])
    expect(enumValues(schema, 'PurchaseOrderPaymentType')).toEqual([
      'DEPOSIT',
      'BALANCE',
      'OTHER',
    ])
    expect(enumValues(schema, 'PurchaseOrderDocumentType')).toEqual([
      'PAYMENT_VOUCHER',
      'ORDER_ISSUANCE_VOUCHER',
      'DELIVERY_RECEIPT',
    ])
    expect(enumValues(schema, 'PurchaseOrderStatusDimension')).toEqual([
      'ORDER',
      'FULFILLMENT',
      'PAYMENT',
    ])

    for (const model of [
      'PurchaseOrder',
      'PurchaseOrderLine',
      'PurchaseOrderPayment',
      'PurchaseOrderDocument',
      'PurchaseOrderStatusHistory',
      'PurchaseOrderAmountRevision',
    ]) {
      expect(extractPrismaBlock(schema, 'model', model)).toBeTruthy()
    }

    const order = extractPrismaBlock(schema, 'model', 'PurchaseOrder')
    expect(order).toMatch(/salesOrderId\s+String\?/u)
    expect(order).not.toMatch(/@@unique\(\[salesOrderId\]/u)
    expect(order).toMatch(
      /productMode\s+PurchaseOrderProductMode\s+@map\("product_mode"\)/u,
    )
    expect(order).toMatch(
      /supplierValue\s+String\?\s+@map\("supplier_value"\)\s+@db\.VarChar\(64\)/u,
    )
    expect(order).toMatch(
      /customSupplierName\s+String\?\s+@map\("custom_supplier_name"\)\s+@db\.VarChar\(128\)/u,
    )
    expect(order).toMatch(/currencyCode\s+String\s+@default\("CNY"\)/u)
    expect(order).toMatch(
      /fulfillmentStatus\s+PurchaseOrderFulfillmentStatus\s+@default\(ORDERED\)/u,
    )

    const line = extractPrismaBlock(schema, 'model', 'PurchaseOrderLine')
    expect(line).toMatch(/sourceSalesOrderLineId\s+String\?/u)
    expect(line).not.toMatch(/@@unique\(\[sourceSalesOrderLineId\]/u)
    expect(line).toMatch(/referencePurchaseUnitPriceAmount\s+Decimal/u)
    expect(line).toMatch(/actualPurchaseUnitPriceAmount\s+Decimal/u)
  })

  it('keeps standalone documents independent of payments and stores exact amount revisions', () => {
    const schema = readFileSync(schemaPath, 'utf8')
    const document = extractPrismaBlock(schema, 'model', 'PurchaseOrderDocument')
    expect(document).toMatch(/paymentId\s+String\?/u)
    const revision = extractPrismaBlock(schema, 'model', 'PurchaseOrderAmountRevision')
    for (const side of ['old', 'new']) {
      for (const amount of ['LineSubtotalAmount', 'PurchaseTotalAmount', 'DepositDueAmount', 'BalanceDueAmount']) {
        expect(revision).toMatch(new RegExp(`${side}${amount}\\s+Decimal[^\\n]*@db\\.Decimal\\(30, 4\\)`, 'u'))
      }
    }
    expect(revision).toMatch(/reason\s+String\s+@db\.VarChar\(500\)/u)
    const migration = readFileSync(resolve(serverRoot,
      'prisma/migrations/20260906120000_purchase_order_records/migration.sql'), 'utf8')
    expect(migration).toContain('purchase_order_documents_active_issuance_key')
    expect(migration).toContain('purchase_order_amount_revisions_amounts_check')
    expect(migration).toContain('purchase_order_amount_revisions_reason_check')
    expect(migration).toContain('DROP NOT NULL')
    expect(migration).not.toMatch(/UPDATE\s+"purchase_orders"|INSERT INTO\s+"purchase_order_amount_revisions"/u)
  })

  it('backfills a lossless product mode and enforces one supplier source', () => {
    const migration = readFileSync(productModeMigrationPath, 'utf8')

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain(
      'LOCK TABLE "purchase_orders", "purchase_order_lines" IN ACCESS EXCLUSIVE MODE',
    )
    expect(migration).toMatch(
      /CREATE TYPE "purchase_order_product_mode" AS ENUM \('CATALOG', 'CUSTOM', 'MIXED'\)/u,
    )
    expect(migration).toMatch(
      /WHEN[\s\S]*?has_catalog[\s\S]*?AND[\s\S]*?has_custom[\s\S]*?THEN 'MIXED'/u,
    )
    expect(migration).toMatch(
      /WHEN[\s\S]*?has_custom[\s\S]*?THEN 'CUSTOM'/u,
    )
    expect(migration).toMatch(
      /UPDATE "purchase_orders"[\s\S]*?SET CONSTRAINTS "purchase_orders_line_source_trigger" IMMEDIATE;[\s\S]*?ALTER TABLE "purchase_orders"/u,
    )
    expect(migration).toContain(
      'purchase_orders_supplier_source_exactly_one_check',
    )
    expect(migration).toContain(
      'purchase order product mode migration invariant mismatch',
    )
    expect(migration).toContain(
      'purchase_orders_custom_supplier_date_id_idx',
    )
    for (const protectedColumn of [
      'order_no',
      'line_subtotal_amount',
      'purchase_total_amount',
      'order_status',
      'sales_order_id',
    ]) {
      expect(migration).not.toContain(`SET "${protectedColumn}"`)
    }
    expect(migration).not.toMatch(/\bCASCADE\b/iu)
  })

  it('maps historical pending-order facts before removing the obsolete enum value', () => {
    const migration = readFileSync(fulfillmentStatusMigrationPath, 'utf8')

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain('LOCK TABLE "purchase_orders" IN ACCESS EXCLUSIVE MODE')
    expect(migration).toMatch(
      /ALTER TABLE "purchase_orders"[\s\S]*?ALTER COLUMN "fulfillment_status"[\s\S]*?CASE "fulfillment_status"::text[\s\S]*?WHEN 'PENDING_ORDER' THEN 'ORDERED'/u,
    )
    expect(migration).toMatch(
      /CREATE TYPE "purchase_order_fulfillment_status_next" AS ENUM \([\s\S]*?'ORDERED'[\s\S]*?'PREPARING'[\s\S]*?'SHIPPED'[\s\S]*?'SIGNED'[\s\S]*?\)/u,
    )
    expect(migration).toMatch(
      /UPDATE "purchase_order_status_history"[\s\S]*?"from_status" = 'ORDERED'[\s\S]*?"from_status" = 'PENDING_ORDER'/u,
    )
    expect(migration).toMatch(
      /UPDATE "purchase_order_status_history"[\s\S]*?"to_status" = 'ORDERED'[\s\S]*?"to_status" = 'PENDING_ORDER'/u,
    )
    expect(migration).toContain("SET DEFAULT 'ORDERED'")
    expect(migration).not.toMatch(
      /(?:CREATE|DROP|ALTER)\s+[\s\S]{0,80}\sIF\s+(?:NOT\s+)?EXISTS\b/iu,
    )
    expect(migration).not.toMatch(/\bCASCADE\b/iu)
  })

  it('backfills completed orders and enforces the signed-and-paid invariant', () => {
    const migration = readFileSync(completionStatusMigrationPath, 'utf8')

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain(
      'LOCK TABLE "purchase_orders" IN ACCESS EXCLUSIVE MODE',
    )
    expect(migration).toContain('purchase_order_status_next')
    expect(migration).toMatch(
      /UPDATE "purchase_orders"[\s\S]*?SET "order_status" = 'COMPLETED'[\s\S]*?"order_status" = 'CONFIRMED'[\s\S]*?"fulfillment_status" = 'SIGNED'[\s\S]*?"payment_status" = 'PAID'/u,
    )
    expect(migration).toContain(
      'purchase_orders_completed_requires_signed_paid_check',
    )
    expect(migration).toMatch(/"order_status"\s*<>\s*'COMPLETED'/u)
    expect(migration).toMatch(/"fulfillment_status"\s*=\s*'SIGNED'/u)
    expect(migration).toMatch(/"payment_status"\s*=\s*'PAID'/u)
    expect(migration).toContain(
      'purchase order completion migration invariant mismatch: backfill',
    )
    expect(migration).toContain(
      'CREATE CONSTRAINT TRIGGER "purchase_orders_source_quantity_trigger"',
    )
    expect(migration).not.toMatch(/"version"|"updated_at"/u)
    expect(migration).not.toMatch(/\bCASCADE\b/iu)
  })

  it('adds strict SQL constraints, deferred invariants and permission seeds', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).not.toMatch(
      /(?:CREATE|DROP|ALTER)\s+[\s\S]{0,80}\sIF\s+(?:NOT\s+)?EXISTS\b/iu,
    )
    expect(migration).not.toMatch(/\bCASCADE\b/iu)

    for (const table of [
      'purchase_orders',
      'purchase_order_lines',
      'purchase_order_payments',
      'purchase_order_documents',
      'purchase_order_status_history',
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`)
    }

    for (const constraint of [
      'purchase_orders_type_source_shape_check',
      'purchase_orders_currency_check',
      'purchase_orders_total_matches_lines_check',
      'purchase_orders_payment_terms_sum_check',
      'purchase_order_lines_type_shape_check',
      'purchase_order_lines_custom_prices_equal_check',
      'purchase_order_lines_total_check',
      'purchase_order_payments_amount_check',
      'purchase_order_payments_void_shape_check',
      'purchase_order_documents_payment_shape_check',
    ]) {
      expect(migration).toContain(constraint)
    }

    expect(migration).toContain('enforce_purchase_order_line_source')
    expect(migration).toContain('enforce_purchase_order_line_subtotal')
    expect(migration).toContain('enforce_purchase_order_payment_summary')
    expect(migration).toContain('enforce_purchase_order_source_quantity')
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED')

    const permissionSeeds = [
      ['00000000-0000-4000-8000-000000000159', 'purchase-orders:read', false],
      ['00000000-0000-4000-8000-000000000160', 'purchase-orders:create', false],
      ['00000000-0000-4000-8000-000000000161', 'purchase-orders:create-stock', true],
      ['00000000-0000-4000-8000-000000000162', 'purchase-orders:update', false],
      ['00000000-0000-4000-8000-000000000163', 'purchase-orders:payment', false],
      ['00000000-0000-4000-8000-000000000164', 'purchase-orders:document', false],
    ] as const
    for (const [id, code, systemOnly] of permissionSeeds) {
      expect(migration).toMatch(
        new RegExp(`'${id}',[\\s\\S]*?'${code}',[\\s\\S]*?${systemOnly}`, 'u'),
      )
    }
  })

  it('exposes the exact permission catalog including the system-only stock capability', () => {
    expect(PURCHASE_ORDER_PERMISSION_CODES).toEqual([
      'purchase-orders:read',
      'purchase-orders:create',
      'purchase-orders:create-stock',
      'purchase-orders:update',
      'purchase-orders:payment',
      'purchase-orders:document',
    ])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...PURCHASE_ORDER_PERMISSION_CODES]),
    )
  })
})
