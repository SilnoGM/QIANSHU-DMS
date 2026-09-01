import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const migrationPath = resolve(
  __dirname,
  '../prisma/migrations/20260901150000_backfill_sales_order_purchase_coverage/migration.sql',
)

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for E2E tests')
  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^sales_purchase_coverage_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Sales purchase coverage E2E schema name is invalid')
  }
  return `"${identifier}"`
}

describe('sales order purchase coverage backfill migration', () => {
  jest.setTimeout(30_000)

  it('advances only fully covered pending sales orders and records the final purchase actor', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `sales_purchase_coverage_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    const actorId = randomUUID()
    const fullOrderId = randomUUID()
    const partialOrderId = randomUUID()
    const cancelledOnlyOrderId = randomUUID()
    const advancedOrderId = randomUUID()
    const emptyOrderId = randomUUID()
    const orderIds = [
      fullOrderId,
      partialOrderId,
      cancelledOnlyOrderId,
      advancedOrderId,
      emptyOrderId,
    ]

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      await client.query(`SET search_path TO ${quotedSchema}, public`)
      await client.query(`
        CREATE TABLE "sales_orders" (
          "id" UUID PRIMARY KEY,
          "order_status" TEXT NOT NULL,
          "fulfillment_status" TEXT NOT NULL,
          "version" INTEGER NOT NULL DEFAULT 1,
          "updated_at" TIMESTAMPTZ(6) NOT NULL
        );
        CREATE TABLE "sales_order_lines" (
          "id" UUID PRIMARY KEY,
          "sales_order_id" UUID NOT NULL,
          "quantity" INTEGER NOT NULL
        );
        CREATE TABLE "purchase_orders" (
          "id" UUID PRIMARY KEY,
          "sales_order_id" UUID,
          "purchase_type" TEXT NOT NULL,
          "order_status" TEXT NOT NULL,
          "created_by_user_id" UUID NOT NULL,
          "created_at" TIMESTAMPTZ(6) NOT NULL
        );
        CREATE TABLE "purchase_order_lines" (
          "id" UUID PRIMARY KEY,
          "purchase_order_id" UUID NOT NULL,
          "source_sales_order_line_id" UUID,
          "quantity" INTEGER NOT NULL
        );
        CREATE TABLE "sales_order_status_history" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "sales_order_id" UUID NOT NULL,
          "dimension" TEXT NOT NULL,
          "from_status" TEXT NOT NULL,
          "to_status" TEXT NOT NULL,
          "reason" TEXT,
          "changed_by_user_id" UUID NOT NULL,
          "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `)

      const historicalTime = new Date('2026-08-30T08:00:00.000Z')
      for (const [index, id] of orderIds.entries()) {
        await client.query(
          `INSERT INTO "sales_orders"
            ("id", "order_status", "fulfillment_status", "version", "updated_at")
           VALUES ($1, 'CONFIRMED', $2, $3, $4)`,
          [id, id === advancedOrderId ? 'PREPARING' : 'PENDING', index + 1, historicalTime],
        )
      }

      const lineByOrder = new Map<string, string>()
      for (const orderId of orderIds.filter(id => id !== emptyOrderId)) {
        const lineId = randomUUID()
        lineByOrder.set(orderId, lineId)
        await client.query(
          `INSERT INTO "sales_order_lines" ("id", "sales_order_id", "quantity")
           VALUES ($1, $2, 2)`,
          [lineId, orderId],
        )
      }

      for (const [index, input] of [
        { orderId: fullOrderId, quantity: 2, status: 'CONFIRMED' },
        { orderId: partialOrderId, quantity: 1, status: 'CONFIRMED' },
        { orderId: cancelledOnlyOrderId, quantity: 2, status: 'CANCELLED' },
        { orderId: advancedOrderId, quantity: 2, status: 'CONFIRMED' },
      ].entries()) {
        const purchaseOrderId = randomUUID()
        await client.query(
          `INSERT INTO "purchase_orders"
            ("id", "sales_order_id", "purchase_type", "order_status", "created_by_user_id", "created_at")
           VALUES ($1, $2, 'SALES_LINKED', $3, $4, $5)`,
          [purchaseOrderId, input.orderId, input.status, actorId, new Date(`2026-08-30T0${index + 1}:00:00.000Z`)],
        )
        await client.query(
          `INSERT INTO "purchase_order_lines"
            ("id", "purchase_order_id", "source_sales_order_line_id", "quantity")
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), purchaseOrderId, lineByOrder.get(input.orderId), input.quantity],
        )
      }

      const migration = readFileSync(migrationPath, 'utf8')
      await client.query(migration)
      // migration 只处理 PENDING，重复执行不得追加历史记录。
      await client.query(migration)

      const orderRows = await client.query<{
        fulfillmentStatus: string
        id: string
        version: number
      }>(`
        SELECT
          "id",
          "fulfillment_status" AS "fulfillmentStatus",
          "version"
        FROM "sales_orders"
      `)
      const orderById = new Map(orderRows.rows.map(row => [row.id, row]))
      expect(orderById.get(fullOrderId)).toMatchObject({
        fulfillmentStatus: 'PREPARING',
        version: 2,
      })
      expect(orderById.get(partialOrderId)).toMatchObject({
        fulfillmentStatus: 'PENDING',
        version: 2,
      })
      expect(orderById.get(cancelledOnlyOrderId)).toMatchObject({
        fulfillmentStatus: 'PENDING',
        version: 3,
      })
      expect(orderById.get(advancedOrderId)).toMatchObject({
        fulfillmentStatus: 'PREPARING',
        version: 4,
      })
      expect(orderById.get(emptyOrderId)).toMatchObject({
        fulfillmentStatus: 'PENDING',
        version: 5,
      })

      const history = await client.query<{
        actorId: string
        fromStatus: string
        orderId: string
        reason: string
        toStatus: string
      }>(`
        SELECT
          "sales_order_id" AS "orderId",
          "from_status" AS "fromStatus",
          "to_status" AS "toStatus",
          "reason",
          "changed_by_user_id" AS "actorId"
        FROM "sales_order_status_history"
      `)
      expect(history.rows).toEqual([{
        actorId,
        fromStatus: 'PENDING',
        orderId: fullOrderId,
        reason: '历史采购已覆盖全部销售产品，迁移校准',
        toStatus: 'PREPARING',
      }])
    }
    finally {
      await client.query('RESET search_path')
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
      await client.end()
    }
  })
})
