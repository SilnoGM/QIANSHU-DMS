import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const migrationPath = resolve(
  __dirname,
  '../prisma/migrations/20260830120000_expand_sales_order_status_reconciliation/migration.sql',
)

const targetOrderStatuses = [
  'DRAFT',
  'CONFIRMED',
  'PENDING_RECONCILIATION',
  'COMPLETED',
  'CANCELLED',
] as const

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for E2E tests')
  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^sales_order_reconciliation_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Sales Order Reconciliation E2E schema name is invalid')
  }
  return `"${identifier}"`
}

describe('sales order reconciliation status migration with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('preserves existing states and enforces completed as signed and paid', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `sales_order_reconciliation_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    const draftOrderId = randomUUID()
    const confirmedOrderId = randomUUID()
    const cancelledOrderId = randomUUID()
    const completedOrderId = randomUUID()
    const unchangedBusinessTime = new Date('2026-08-20T08:00:00.000Z')

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      await client.query(`SET search_path TO ${quotedSchema}, public`)

      // 只建立本次 migration 依赖的旧版最小结构，避免测试结果依赖开发库当前状态。
      await client.query(`
        CREATE TYPE "sales_order_status" AS ENUM (
          'DRAFT',
          'CONFIRMED',
          'CANCELLED'
        );
        CREATE TYPE "sales_order_fulfillment_status" AS ENUM (
          'PENDING',
          'SIGNED'
        );
        CREATE TYPE "sales_order_payment_status" AS ENUM (
          'UNPAID',
          'PARTIALLY_PAID',
          'PAID'
        );
        CREATE TABLE "sales_orders" (
          "id" UUID PRIMARY KEY,
          "order_status" "sales_order_status" NOT NULL DEFAULT 'DRAFT',
          "fulfillment_status" "sales_order_fulfillment_status" NOT NULL DEFAULT 'PENDING',
          "payment_status" "sales_order_payment_status" NOT NULL DEFAULT 'UNPAID',
          "version" INTEGER NOT NULL DEFAULT 1,
          "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `)

      await client.query(
        `
          INSERT INTO "sales_orders" (
            "id",
            "order_status",
            "fulfillment_status",
            "payment_status",
            "version",
            "updated_at"
          )
          VALUES
            ($1, 'DRAFT', 'PENDING', 'UNPAID', 2, $4),
            ($2, 'CONFIRMED', 'SIGNED', 'PAID', 3, $4),
            ($3, 'CANCELLED', 'PENDING', 'UNPAID', 4, $4)
        `,
        [draftOrderId, confirmedOrderId, cancelledOrderId, unchangedBusinessTime],
      )

      await client.query(readFileSync(migrationPath, 'utf8'))

      const enumValues = await client.query<{ value: string }>(`
        SELECT enum_value."enumlabel" AS "value"
        FROM "pg_type" AS enum_type
        INNER JOIN "pg_enum" AS enum_value
          ON enum_value."enumtypid" = enum_type."oid"
        INNER JOIN "pg_namespace" AS enum_namespace
          ON enum_namespace."oid" = enum_type."typnamespace"
        WHERE enum_type."typname" = 'sales_order_status'
          AND enum_namespace."nspname" = current_schema()
        ORDER BY enum_value."enumsortorder"
      `)
      expect(enumValues.rows.map(row => row.value)).toEqual(targetOrderStatuses)

      const existingOrders = await client.query<{
        id: string
        orderStatus: string
        updatedAt: Date
        version: number
      }>(`
        SELECT
          "id",
          "order_status"::text AS "orderStatus",
          "version",
          "updated_at" AS "updatedAt"
        FROM "sales_orders"
      `)
      expect(existingOrders.rows).toEqual(expect.arrayContaining([
        {
          id: draftOrderId,
          orderStatus: 'DRAFT',
          updatedAt: unchangedBusinessTime,
          version: 2,
        },
        {
          id: confirmedOrderId,
          orderStatus: 'CONFIRMED',
          updatedAt: unchangedBusinessTime,
          version: 3,
        },
        {
          id: cancelledOrderId,
          orderStatus: 'CANCELLED',
          updatedAt: unchangedBusinessTime,
          version: 4,
        },
      ]))

      await expect(client.query(
        `
          INSERT INTO "sales_orders" (
            "id", "order_status", "fulfillment_status", "payment_status"
          )
          VALUES ($1, 'COMPLETED', 'PENDING', 'PAID')
        `,
        [randomUUID()],
      )).rejects.toMatchObject({ code: '23514' })

      await expect(client.query(
        `
          INSERT INTO "sales_orders" (
            "id", "order_status", "fulfillment_status", "payment_status"
          )
          VALUES ($1, 'COMPLETED', 'SIGNED', 'PAID')
        `,
        [completedOrderId],
      )).resolves.toMatchObject({ rowCount: 1 })
    }
    finally {
      await client.query('RESET search_path')
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
      await client.end()
    }
  })
})
