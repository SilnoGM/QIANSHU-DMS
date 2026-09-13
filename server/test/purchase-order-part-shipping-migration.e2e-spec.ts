import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const migration = readFileSync(resolve(__dirname, '../prisma/migrations/20260913120000_purchase_order_part_shipping/migration.sql'), 'utf8')
const previous = readFileSync(resolve(__dirname, '../prisma/migrations/20260909100000_purchase_order_part_status/migration.sql'), 'utf8')
const immutableFunction = previous.slice(previous.indexOf('CREATE OR REPLACE FUNCTION'), previous.indexOf('-- 历史状态'))

function isolatedDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username !== 'qianshu_ci' || url.pathname !== '/qianshu_ci') {
    throw new Error('Shipping migration tests require the isolated CI database')
  }
  return value
}

describe('purchase part shipping migration', () => {
  jest.setTimeout(30_000)

  it('fails closed for missing history, backfills trustworthy events and preserves one-time shipment/configuration constraints', async () => {
    const client = new Client({ connectionString: isolatedDatabaseUrl() })
    const schema = `shipping_${randomUUID().replaceAll('-', '')}`
    const actor = randomUUID()
    const shippedOrder = randomUUID()
    const pendingOrder = randomUUID()
    const signedOrder = randomUUID()
    await client.connect()
    try {
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET search_path TO "${schema}", public`)
      await client.query(`
        CREATE TYPE purchase_order_part_status AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'CANCELLED');
        CREATE TYPE purchase_order_fulfillment_status AS ENUM ('ORDERED', 'PREPARING', 'SHIPPED', 'SIGNED');
        CREATE TABLE users (id UUID PRIMARY KEY);
        CREATE TABLE purchase_orders (id UUID PRIMARY KEY, order_status TEXT NOT NULL,
          fulfillment_status purchase_order_fulfillment_status NOT NULL, shipping_mark_text TEXT,
          part_configuration_sealed BOOLEAN DEFAULT true, create_request_fingerprint_version TEXT DEFAULT 'purchase-order.create.v5');
        CREATE TABLE purchase_order_parts (id UUID PRIMARY KEY, purchase_order_id UUID REFERENCES purchase_orders(id),
          status purchase_order_part_status NOT NULL, part_number INTEGER DEFAULT 1, shipping_mark_text TEXT);
        CREATE TABLE purchase_order_part_items (id UUID PRIMARY KEY, quantity INTEGER);
        CREATE TABLE purchase_order_status_history (id UUID PRIMARY KEY, purchase_order_id UUID REFERENCES purchase_orders(id),
          dimension TEXT, to_status TEXT, changed_at TIMESTAMPTZ, changed_by_user_id UUID REFERENCES users(id), reason VARCHAR(500),
          from_status TEXT NOT NULL DEFAULT 'PREPARING',
          CONSTRAINT purchase_order_status_history_status_nonblank_check CHECK (
            from_status !~ '^[[:space:]]*$' AND to_status !~ '^[[:space:]]*$' AND from_status <> to_status));
      `)
      await client.query(immutableFunction)
      await client.query(`CREATE TRIGGER part_immutable BEFORE UPDATE OR DELETE ON purchase_order_parts FOR EACH ROW EXECUTE FUNCTION reject_purchase_order_part_mutation();
        CREATE TRIGGER item_immutable BEFORE UPDATE OR DELETE ON purchase_order_part_items FOR EACH ROW EXECUTE FUNCTION reject_purchase_order_part_mutation();`)
      await client.query('INSERT INTO users VALUES ($1)', [actor])
      await client.query(`INSERT INTO purchase_orders (id, order_status, fulfillment_status) VALUES ($1, 'CONFIRMED', 'SHIPPED'), ($2, 'CONFIRMED', 'PREPARING'), ($3, 'COMPLETED', 'SIGNED')`, [shippedOrder, pendingOrder, signedOrder])
      await client.query(`INSERT INTO purchase_order_parts SELECT gen_random_uuid(), id, 'ACTIVE', 1, 'TEST/01' FROM purchase_orders`)
      await expect(client.query(migration)).rejects.toThrow('trustworthy SHIPPED history')
      await client.query('ROLLBACK')
      expect((await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'purchase_order_parts' AND column_name = 'shipped_at'`, [schema])).rows).toHaveLength(0)
      await client.query(`INSERT INTO purchase_order_status_history (id, purchase_order_id, dimension, to_status, changed_at, changed_by_user_id, reason) SELECT gen_random_uuid(), id, 'FULFILLMENT', 'SHIPPED', '2026-09-01T00:00:00Z', $1, '真实发货说明' FROM purchase_orders WHERE id IN ($2, $3)`, [actor, shippedOrder, signedOrder])
      await client.query(migration)
      await expect(client.query(`INSERT INTO purchase_order_status_history (id, purchase_order_id, dimension, from_status, to_status, changed_at, changed_by_user_id) VALUES (gen_random_uuid(), $1, 'PAYMENT', 'PARTIALLY_SHIPPED', 'PARTIALLY_SHIPPED', now(), $2)`, [shippedOrder, actor])).rejects.toMatchObject({ code: '23514' })
      await expect(client.query(`INSERT INTO purchase_order_status_history (id, purchase_order_id, dimension, from_status, to_status, changed_at, changed_by_user_id) VALUES (gen_random_uuid(), $1, 'FULFILLMENT', 'SHIPPED', 'SHIPPED', now(), $2)`, [shippedOrder, actor])).rejects.toMatchObject({ code: '23514' })
      const backfilled = await client.query(`SELECT shipped_at, shipped_by_id, shipment_recorded_at, shipment_remark FROM purchase_order_parts WHERE purchase_order_id = $1`, [shippedOrder])
      expect(backfilled.rows[0]).toEqual({ shipped_at: new Date('2026-09-01T00:00:00Z'), shipped_by_id: actor, shipment_recorded_at: new Date('2026-09-01T00:00:00Z'), shipment_remark: '真实发货说明' })
      expect((await client.query(`SELECT shipped_at FROM purchase_order_parts WHERE purchase_order_id = $1`, [pendingOrder])).rows).toEqual([{ shipped_at: null }])
      await expect(client.query(`UPDATE purchase_order_parts SET shipment_remark = '篡改' WHERE purchase_order_id = $1`, [shippedOrder])).rejects.toMatchObject({ code: '23514' })
      await client.query(`UPDATE purchase_orders SET fulfillment_status = 'PARTIALLY_SHIPPED' WHERE id = $1`, [pendingOrder])
      await expect(client.query(`UPDATE purchase_order_parts SET shipped_at = now() WHERE purchase_order_id = $1`, [pendingOrder])).rejects.toMatchObject({ code: '23514' })
      await client.query(`UPDATE purchase_order_parts SET shipped_at = now(), shipped_by_id = $1, shipment_recorded_at = now() WHERE purchase_order_id = $2`, [actor, pendingOrder])
      await expect(client.query(`UPDATE purchase_order_parts SET shipped_at = NULL, shipped_by_id = NULL, shipment_recorded_at = NULL WHERE purchase_order_id = $1`, [pendingOrder])).rejects.toMatchObject({ code: '23514' })
      const reviewOrder = randomUUID()
      await client.query(`INSERT INTO purchase_orders (id, order_status, fulfillment_status, shipping_mark_text) VALUES ($1, 'PENDING_REVIEW', 'ORDERED', 'REVIEW/01')`, [reviewOrder])
      await client.query(`INSERT INTO purchase_order_parts (id, purchase_order_id, status) VALUES ($1, $2, 'PENDING_REVIEW')`, [randomUUID(), reviewOrder])
      await expect(client.query(`UPDATE purchase_order_parts SET shipped_at = now(), shipped_by_id = $1, shipment_recorded_at = now() WHERE purchase_order_id = $2`, [actor, reviewOrder])).rejects.toMatchObject({ code: '23514' })
      await client.query(`UPDATE purchase_orders SET order_status = 'CONFIRMED', fulfillment_status = 'PREPARING' WHERE id = $1`, [reviewOrder])
      await client.query(`UPDATE purchase_order_parts SET shipping_mark_text = 'REVIEW/01' WHERE purchase_order_id = $1`, [reviewOrder])
      await client.query(`UPDATE purchase_order_parts SET status = 'ACTIVE' WHERE purchase_order_id = $1`, [reviewOrder])
      await client.query(`UPDATE purchase_orders SET order_status = 'CANCELLED' WHERE id = $1`, [reviewOrder])
      await client.query(`UPDATE purchase_order_parts SET status = 'CANCELLED' WHERE purchase_order_id = $1`, [reviewOrder])
      await expect(client.query('UPDATE purchase_order_parts SET part_number = 2')).rejects.toMatchObject({ code: '23514' })
      await expect(client.query('DELETE FROM purchase_order_parts')).rejects.toMatchObject({ code: '23514' })
      await client.query('INSERT INTO purchase_order_part_items VALUES ($1, 1)', [randomUUID()])
      await expect(client.query('UPDATE purchase_order_part_items SET quantity = 2')).rejects.toMatchObject({ code: '23514' })
    }
    finally {
      await client.query('ROLLBACK')
      await client.query('RESET search_path')
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await client.end()
    }
  })
})
