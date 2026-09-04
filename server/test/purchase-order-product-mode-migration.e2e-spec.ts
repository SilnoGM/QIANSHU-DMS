import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const migrationPath = resolve(
  __dirname,
  '../prisma/migrations/20260904160000_purchase_order_product_mode/migration.sql',
)

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for E2E tests')
  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^purchase_product_mode_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Purchase product mode E2E schema name is invalid')
  }
  return `"${identifier}"`
}

async function createLegacyTables(
  client: Client,
  lineTypeSql = `CREATE TYPE "purchase_order_line_type" AS ENUM ('CATALOG', 'CUSTOM');`,
): Promise<void> {
  // 夹具只建立本次 migration 需要的旧版最小结构，避免测试依赖开发库当前状态。
  await client.query(`
    ${lineTypeSql}
    CREATE TABLE "purchase_orders" (
      "id" UUID PRIMARY KEY,
      "order_no" VARCHAR(64) NOT NULL,
      "supplier_value" VARCHAR(64) NOT NULL,
      "order_date" DATE NOT NULL,
      "line_subtotal_amount" NUMERIC(30, 4) NOT NULL,
      "purchase_total_amount" NUMERIC(30, 4) NOT NULL,
      "order_status" TEXT NOT NULL,
      "sales_order_id" UUID
    );
    CREATE TABLE "purchase_order_lines" (
      "id" UUID PRIMARY KEY,
      "purchase_order_id" UUID NOT NULL,
      "line_type" ${lineTypeSql.includes('CREATE TYPE') ? '"purchase_order_line_type"' : 'TEXT'} NOT NULL
    );
  `)
}

async function withIsolatedSchema(
  action: (client: Client) => Promise<void>,
): Promise<void> {
  const client = new Client({ connectionString: requireDatabaseUrl() })
  const schemaName = `purchase_product_mode_${randomUUID().replaceAll('-', '')}`
  const quotedSchema = quoteTestSchema(schemaName)

  await client.connect()
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`)
    await client.query(`SET search_path TO ${quotedSchema}, public`)
    await action(client)
  }
  finally {
    await client.query('RESET search_path')
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
    await client.end()
  }
}

describe('purchase order product mode migration with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('backfills CATALOG, CUSTOM and MIXED without changing business facts', async () => {
    await withIsolatedSchema(async (client) => {
      await createLegacyTables(client)
      const catalogOrderId = randomUUID()
      const customOrderId = randomUUID()
      const mixedOrderId = randomUUID()

      await client.query(
        `
          INSERT INTO "purchase_orders" (
            "id", "order_no", "supplier_value", "order_date",
            "line_subtotal_amount", "purchase_total_amount", "order_status",
            "sales_order_id"
          )
          VALUES
            ($1, 'PO-CATALOG', 'SUPPLIER_A', DATE '2026-09-01', 10, 11, 'CONFIRMED', $4),
            ($2, 'PO-CUSTOM', 'LEGACY_SUPPLIER', DATE '2026-09-02', 20, 22, 'CANCELLED', NULL),
            ($3, 'PO-MIXED', 'SUPPLIER_B', DATE '2026-09-03', 30, 33, 'COMPLETED', $5)
        `,
        [catalogOrderId, customOrderId, mixedOrderId, randomUUID(), randomUUID()],
      )
      await client.query(
        `
          INSERT INTO "purchase_order_lines" (
            "id", "purchase_order_id", "line_type"
          )
          VALUES
            (gen_random_uuid(), $1, 'CATALOG'),
            (gen_random_uuid(), $2, 'CUSTOM'),
            (gen_random_uuid(), $3, 'CATALOG'),
            (gen_random_uuid(), $3, 'CUSTOM')
        `,
        [catalogOrderId, customOrderId, mixedOrderId],
      )

      const before = await client.query(`
        SELECT
          "id", "order_no", "supplier_value", "order_date",
          "line_subtotal_amount", "purchase_total_amount", "order_status",
          "sales_order_id"
        FROM "purchase_orders"
        ORDER BY "order_no"
      `)
      const beforeLineCount = await client.query<{ count: string }>(
        'SELECT COUNT(*) AS "count" FROM "purchase_order_lines"',
      )

      await client.query(readFileSync(migrationPath, 'utf8'))

      const after = await client.query(`
        SELECT
          "id", "order_no", "supplier_value", "order_date",
          "line_subtotal_amount", "purchase_total_amount", "order_status",
          "sales_order_id"
        FROM "purchase_orders"
        ORDER BY "order_no"
      `)
      const modes = await client.query<{ mode: string, orderNo: string }>(`
        SELECT "order_no" AS "orderNo", "product_mode"::text AS "mode"
        FROM "purchase_orders"
        ORDER BY "order_no"
      `)
      const afterLineCount = await client.query<{ count: string }>(
        'SELECT COUNT(*) AS "count" FROM "purchase_order_lines"',
      )

      expect(after.rows).toEqual(before.rows)
      expect(afterLineCount.rows).toEqual(beforeLineCount.rows)
      expect(modes.rows).toEqual([
        { mode: 'CATALOG', orderNo: 'PO-CATALOG' },
        { mode: 'CUSTOM', orderNo: 'PO-CUSTOM' },
        { mode: 'MIXED', orderNo: 'PO-MIXED' },
      ])
      await expect(client.query(
        `INSERT INTO "purchase_orders" (
          "id", "order_no", "product_mode", "supplier_value",
          "custom_supplier_name", "order_date", "line_subtotal_amount",
          "purchase_total_amount", "order_status"
        ) VALUES (
          gen_random_uuid(), 'PO-BOTH', 'CUSTOM', 'SUPPLIER_A',
          'Custom Supplier', CURRENT_DATE, 1, 1, 'CONFIRMED'
        )`,
      )).rejects.toMatchObject({
        code: '23514',
        constraint: 'purchase_orders_supplier_source_exactly_one_check',
      })
      await expect(client.query(
        `INSERT INTO "purchase_orders" (
          "id", "order_no", "product_mode", "supplier_value",
          "custom_supplier_name", "order_date", "line_subtotal_amount",
          "purchase_total_amount", "order_status"
        ) VALUES (
          gen_random_uuid(), 'PO-NEITHER', 'CUSTOM', NULL,
          NULL, CURRENT_DATE, 1, 1, 'CONFIRMED'
        )`,
      )).rejects.toMatchObject({
        code: '23514',
        constraint: 'purchase_orders_supplier_source_exactly_one_check',
      })
    })
  })

  it('fails closed when a historical purchase order has no lines', async () => {
    await withIsolatedSchema(async (client) => {
      await createLegacyTables(client)
      await client.query(`
        INSERT INTO "purchase_orders" (
          "id", "order_no", "supplier_value", "order_date",
          "line_subtotal_amount", "purchase_total_amount", "order_status"
        ) VALUES (
          gen_random_uuid(), 'PO-EMPTY', 'SUPPLIER_A', CURRENT_DATE,
          0, 0, 'CONFIRMED'
        )
      `)

      await expect(client.query(readFileSync(migrationPath, 'utf8')))
        .rejects.toThrow('purchase order product mode migration invariant mismatch')
      await client.query('ROLLBACK')

      const columns = await client.query<{ count: string }>(`
        SELECT COUNT(*) AS "count"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'purchase_orders'
          AND column_name = 'product_mode'
      `)
      expect(columns.rows[0]?.count).toBe('0')
    })
  })

  it('fails closed when a historical line type is unknown', async () => {
    await withIsolatedSchema(async (client) => {
      await createLegacyTables(client, '')
      const orderId = randomUUID()
      await client.query(`
        INSERT INTO "purchase_orders" (
          "id", "order_no", "supplier_value", "order_date",
          "line_subtotal_amount", "purchase_total_amount", "order_status"
        ) VALUES (
          $1, 'PO-UNKNOWN', 'SUPPLIER_A', CURRENT_DATE,
          1, 1, 'CONFIRMED'
        )
      `, [orderId])
      await client.query(`
        INSERT INTO "purchase_order_lines" (
          "id", "purchase_order_id", "line_type"
        ) VALUES (gen_random_uuid(), $1, 'UNKNOWN')
      `, [orderId])

      await expect(client.query(readFileSync(migrationPath, 'utf8')))
        .rejects.toThrow('purchase order product mode migration invariant mismatch')
      await client.query('ROLLBACK')
    })
  })
})
