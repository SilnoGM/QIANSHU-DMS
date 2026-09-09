import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const existingMigration = readFileSync(resolve(__dirname, '../prisma/migrations/20260908013900_purchase_order_review_shipping_marks/migration.sql'), 'utf8')
const existingImmutableFunction = existingMigration.slice(existingMigration.indexOf('CREATE OR REPLACE FUNCTION "reject_purchase_order_part_mutation"'), existingMigration.indexOf('CREATE OR REPLACE FUNCTION "enforce_purchase_order_part_item_creation"'))

const migrationPath = resolve(__dirname, '../prisma/migrations/20260909100000_purchase_order_part_status/migration.sql')

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for E2E tests')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username !== 'qianshu_ci' || url.pathname !== '/qianshu_ci') {
    throw new Error('Purchase part status migration requires the isolated CI database')
  }
  return value
}

describe('purchase part status migration with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('backfills every order state without changing marks or allocations and defaults new parts to pending', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `purchase_part_status_${randomUUID().replaceAll('-', '')}`
    await client.connect()
    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET search_path TO "${schemaName}", public`)
      await client.query(`
        CREATE TYPE purchase_order_status AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'COMPLETED', 'CANCELLED');
        CREATE TABLE purchase_orders (
          id UUID PRIMARY KEY, order_status purchase_order_status NOT NULL,
          shipping_mark_text TEXT, part_configuration_sealed BOOLEAN NOT NULL DEFAULT true,
          create_request_fingerprint_version TEXT NOT NULL DEFAULT 'purchase-order.create.v5',
          fulfillment_status TEXT NOT NULL DEFAULT 'PREPARING'
        );
        CREATE TABLE purchase_order_parts (
          id UUID PRIMARY KEY, purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id), part_number INTEGER NOT NULL DEFAULT 1,
          shipping_mark_text TEXT, shipping_mark_issuance_id UUID, shipping_mark_key_hash BYTEA
        );
        CREATE TABLE purchase_order_part_items (
          id UUID PRIMARY KEY, purchase_order_part_id UUID NOT NULL REFERENCES purchase_order_parts(id), quantity INTEGER
        );
        INSERT INTO purchase_orders (id, order_status) SELECT gen_random_uuid(), unnest(enum_range(NULL::purchase_order_status));
        INSERT INTO purchase_order_parts (id, purchase_order_id, shipping_mark_text, shipping_mark_issuance_id, shipping_mark_key_hash)
          SELECT gen_random_uuid(), id, 'LEGACY-MARK-' || order_status, gen_random_uuid(), decode('aabb', 'hex')
          FROM purchase_orders;
        INSERT INTO purchase_order_part_items SELECT gen_random_uuid(), id, 3 FROM purchase_order_parts;
      `)
      await client.query(existingImmutableFunction)
      await client.query(`
        CREATE TRIGGER purchase_order_parts_immutable_trigger BEFORE UPDATE OR DELETE ON purchase_order_parts
          FOR EACH ROW EXECUTE FUNCTION reject_purchase_order_part_mutation();
        CREATE TRIGGER purchase_order_part_items_immutable_trigger BEFORE UPDATE OR DELETE ON purchase_order_part_items
          FOR EACH ROW EXECUTE FUNCTION reject_purchase_order_part_mutation();
      `)
      const before = await client.query('SELECT * FROM purchase_order_parts ORDER BY id')
      const allocations = await client.query('SELECT * FROM purchase_order_part_items ORDER BY id')
      await client.query(readFileSync(migrationPath, 'utf8'))
      expect((await client.query(`SELECT id, purchase_order_id, part_number, shipping_mark_text,
        shipping_mark_issuance_id, shipping_mark_key_hash FROM purchase_order_parts ORDER BY id`)).rows).toEqual(before.rows)
      expect((await client.query('SELECT * FROM purchase_order_part_items ORDER BY id')).rows).toEqual(allocations.rows)
      expect((await client.query(`SELECT orders.order_status::text, part.status::text
        FROM purchase_orders orders JOIN purchase_order_parts part ON orders.id = part.purchase_order_id
        ORDER BY orders.order_status::text`)).rows).toEqual([
        { order_status: 'CANCELLED', status: 'CANCELLED' },
        { order_status: 'COMPLETED', status: 'ACTIVE' },
        { order_status: 'CONFIRMED', status: 'ACTIVE' },
        { order_status: 'PENDING_REVIEW', status: 'PENDING_REVIEW' },
      ])
      const created = await client.query(`INSERT INTO purchase_order_parts (id, purchase_order_id)
        SELECT gen_random_uuid(), id FROM purchase_orders WHERE order_status = 'PENDING_REVIEW' RETURNING status`)
      expect(created.rows).toEqual([{ status: 'PENDING_REVIEW' }])
      await expect(client.query("UPDATE purchase_order_parts SET status = 'ACTIVE' WHERE status = 'PENDING_REVIEW'"))
        .rejects.toMatchObject({ code: '23514' })
      await client.query("UPDATE purchase_orders SET order_status = 'CONFIRMED', shipping_mark_text = 'REVIEW-MARK' WHERE order_status = 'PENDING_REVIEW'")
      // 原一次补码在状态生效之前执行；补码不能顺带篡改生命周期或产品配置。
      await expect(client.query("UPDATE purchase_order_parts SET shipping_mark_text = 'REVIEW-MARK', status = 'ACTIVE' WHERE shipping_mark_text IS NULL"))
        .rejects.toMatchObject({ code: '23514' })
      await client.query("UPDATE purchase_order_parts SET shipping_mark_text = 'REVIEW-MARK' WHERE shipping_mark_text IS NULL")
      await expect(client.query("UPDATE purchase_order_parts SET shipping_mark_text = 'REPLACED-MARK' WHERE shipping_mark_text = 'REVIEW-MARK'"))
        .rejects.toMatchObject({ code: '23514' })
      await client.query("UPDATE purchase_order_parts SET status = 'ACTIVE' WHERE status = 'PENDING_REVIEW'")
      await expect(client.query("UPDATE purchase_order_parts SET status = 'CANCELLED' WHERE status = 'ACTIVE'"))
        .rejects.toMatchObject({ code: '23514' })
      await client.query("UPDATE purchase_orders SET order_status = 'CANCELLED'")
      await client.query("UPDATE purchase_order_parts SET status = 'CANCELLED' WHERE status = 'ACTIVE'")
      await expect(client.query("UPDATE purchase_order_parts SET status = 'ACTIVE' WHERE status = 'CANCELLED'"))
        .rejects.toMatchObject({ code: '23514' })
      await expect(client.query('UPDATE purchase_order_parts SET part_number = 2')).rejects.toMatchObject({ code: '23514' })
      await expect(client.query('DELETE FROM purchase_order_parts')).rejects.toMatchObject({ code: '23514' })
      await expect(client.query('UPDATE purchase_order_part_items SET quantity = 4')).rejects.toMatchObject({ code: '23514' })
      await expect(client.query('DELETE FROM purchase_order_part_items')).rejects.toMatchObject({ code: '23514' })
      const pendingOrderId = randomUUID()
      await client.query("INSERT INTO purchase_orders (id, order_status) VALUES ($1, 'PENDING_REVIEW')", [pendingOrderId])
      await client.query('INSERT INTO purchase_order_parts (id, purchase_order_id) VALUES ($1, $2)', [randomUUID(), pendingOrderId])
      await client.query("UPDATE purchase_orders SET order_status = 'CANCELLED' WHERE id = $1", [pendingOrderId])
      expect((await client.query("UPDATE purchase_order_parts SET status = 'CANCELLED' WHERE purchase_order_id = $1 RETURNING status, shipping_mark_text", [pendingOrderId])).rows)
        .toEqual([{ status: 'CANCELLED', shipping_mark_text: null }])
      await expect(client.query('UPDATE purchase_order_parts SET status = NULL')).rejects.toMatchObject({ code: '23514' })
    }
    finally {
      await client.query('ROLLBACK')
      await client.query('RESET search_path')
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.end()
    }
  })
})
