import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const migrationPath = resolve(
  __dirname,
  '../prisma/migrations/20260826160000_expand_sales_order_fulfillment_status/migration.sql',
)

const targetFulfillmentStatuses = [
  'PENDING',
  'PREPARING',
  'LAND_TRANSIT',
  'WAREHOUSE_ARRIVED',
  'SEA_TRANSIT',
  'SIGNED',
] as const

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }
  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^sales_order_fulfillment_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Sales Order Fulfillment E2E schema name is invalid')
  }
  return `"${identifier}"`
}

describe('sales order fulfillment status migration with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('maps legacy state without creating a business mutation', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `sales_order_fulfillment_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    const migratedOrderId = randomUUID()
    const untouchedOrderId = randomUUID()
    const unchangedBusinessTime = new Date('2026-08-20T08:00:00.000Z')

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      await client.query(`SET search_path TO ${quotedSchema}, public`)

      // 只建立本次 migration 依赖的旧版最小结构，避免测试结果依赖开发库当前状态。
      await client.query(`
        CREATE TYPE "sales_order_fulfillment_status" AS ENUM (
          'PENDING',
          'PREPARING',
          'SHIPPED',
          'SIGNED'
        );
        CREATE TYPE "sales_order_status_dimension" AS ENUM (
          'ORDER',
          'FULFILLMENT',
          'PAYMENT'
        );
        CREATE TYPE "audit_event_type" AS ENUM (
          'SALES_ORDER_FULFILLMENT_STATUS_CHANGED'
        );

        CREATE TABLE "sales_orders" (
          "id" UUID PRIMARY KEY,
          "fulfillment_status" "sales_order_fulfillment_status" NOT NULL DEFAULT 'PENDING',
          "version" INTEGER NOT NULL DEFAULT 1,
          "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE "sales_order_status_history" (
          "id" UUID PRIMARY KEY,
          "dimension" "sales_order_status_dimension" NOT NULL,
          "from_status" VARCHAR(32) NOT NULL,
          "to_status" VARCHAR(32) NOT NULL
        );
        CREATE TABLE "audit_events" (
          "id" UUID PRIMARY KEY,
          "event_type" "audit_event_type" NOT NULL,
          "metadata" JSONB NOT NULL DEFAULT '{}'
        );
      `)

      await client.query(
        `
          INSERT INTO "sales_orders" (
            "id", "fulfillment_status", "version", "updated_at"
          )
          VALUES
            ($1, 'SHIPPED', 7, $3),
            ($2, 'PENDING', 3, $3)
        `,
        [migratedOrderId, untouchedOrderId, unchangedBusinessTime],
      )
      await client.query(`
          INSERT INTO "sales_order_status_history" (
            "id", "dimension", "from_status", "to_status"
          )
          VALUES
            (gen_random_uuid(), 'FULFILLMENT', 'PREPARING', 'SHIPPED'),
            (gen_random_uuid(), 'FULFILLMENT', 'SHIPPED', 'SIGNED'),
            (gen_random_uuid(), 'PAYMENT', 'SHIPPED', 'SIGNED')
      `)
      await client.query(`
          INSERT INTO "audit_events" ("id", "event_type", "metadata")
          VALUES
            (
              gen_random_uuid(),
              'SALES_ORDER_FULFILLMENT_STATUS_CHANGED',
              '{"fromStatus":"PREPARING","toStatus":"SHIPPED","reason":"test"}'::jsonb
            ),
            (
              gen_random_uuid(),
              'SALES_ORDER_FULFILLMENT_STATUS_CHANGED',
              '{"fromStatus":"SHIPPED","toStatus":"SIGNED","reason":"test"}'::jsonb
            )
      `)

      await client.query(readFileSync(migrationPath, 'utf8'))

      const enumValues = await client.query<{ value: string }>(`
        SELECT enum_value."enumlabel" AS "value"
        FROM "pg_type" AS enum_type
        INNER JOIN "pg_enum" AS enum_value
          ON enum_value."enumtypid" = enum_type."oid"
        INNER JOIN "pg_namespace" AS enum_namespace
          ON enum_namespace."oid" = enum_type."typnamespace"
        WHERE enum_type."typname" = 'sales_order_fulfillment_status'
          AND enum_namespace."nspname" = current_schema()
        ORDER BY enum_value."enumsortorder"
      `)
      expect(enumValues.rows.map(row => row.value)).toEqual(
        targetFulfillmentStatuses,
      )

      const orders = await client.query<{
        fulfillmentStatus: string
        id: string
        updatedAt: Date
        version: number
      }>(`
        SELECT
          "id",
          "fulfillment_status"::text AS "fulfillmentStatus",
          "version",
          "updated_at" AS "updatedAt"
        FROM "sales_orders"
        ORDER BY "id"
      `)
      expect(orders.rows).toEqual(expect.arrayContaining([
        {
          fulfillmentStatus: 'LAND_TRANSIT',
          id: migratedOrderId,
          updatedAt: unchangedBusinessTime,
          version: 7,
        },
        {
          fulfillmentStatus: 'PENDING',
          id: untouchedOrderId,
          updatedAt: unchangedBusinessTime,
          version: 3,
        },
      ]))

      const history = await client.query<{
        dimension: string
        fromStatus: string
        toStatus: string
      }>(`
        SELECT
          "dimension"::text AS "dimension",
          "from_status" AS "fromStatus",
          "to_status" AS "toStatus"
        FROM "sales_order_status_history"
        ORDER BY "dimension", "from_status", "to_status"
      `)
      expect(history.rows).toEqual(expect.arrayContaining([
        {
          dimension: 'FULFILLMENT',
          fromStatus: 'PREPARING',
          toStatus: 'LAND_TRANSIT',
        },
        {
          dimension: 'FULFILLMENT',
          fromStatus: 'LAND_TRANSIT',
          toStatus: 'SIGNED',
        },
        // 非履约维度中的同名业务文本不属于本次迁移范围。
        {
          dimension: 'PAYMENT',
          fromStatus: 'SHIPPED',
          toStatus: 'SIGNED',
        },
      ]))

      const auditEvents = await client.query<{
        fromStatus: string
        reason: string
        toStatus: string
      }>(`
        SELECT
          "metadata" ->> 'fromStatus' AS "fromStatus",
          "metadata" ->> 'toStatus' AS "toStatus",
          "metadata" ->> 'reason' AS "reason"
        FROM "audit_events"
        ORDER BY "metadata" ->> 'fromStatus'
      `)
      expect(auditEvents.rows).toEqual([
        {
          fromStatus: 'LAND_TRANSIT',
          reason: 'test',
          toStatus: 'SIGNED',
        },
        {
          fromStatus: 'PREPARING',
          reason: 'test',
          toStatus: 'LAND_TRANSIT',
        },
      ])
    }
    finally {
      await client.query('RESET search_path')
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
      await client.end()
    }
  })
})
