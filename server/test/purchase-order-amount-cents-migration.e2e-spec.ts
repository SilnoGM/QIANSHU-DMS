import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

const migrationPath = resolve(__dirname, '../prisma/migrations/20260916110000_purchase_order_amount_cents/migration.sql')

function isolatedDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('Isolated test database is required')
  const url = new URL(value)
  const known = (url.username === 'qianshu_ci' && url.pathname === '/qianshu_ci')
    || (url.username === 'receipt_test' && url.pathname === '/receipt_test')
  if (!known || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Database is outside isolated boundary')
  }
  return value
}

async function withSchema(action: (client: Client, schema: string) => Promise<void>) {
  const client = new Client({ connectionString: isolatedDatabaseUrl() })
  const schema = `purchase_cents_${randomUUID().replaceAll('-', '')}`
  await client.connect()
  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    await client.query(`
      CREATE TABLE purchase_orders (
        line_subtotal_amount numeric(30,4) NOT NULL DEFAULT 0,
        purchase_total_amount numeric(30,4) NOT NULL DEFAULT 0,
        deposit_due_amount numeric(30,4) NOT NULL DEFAULT 0,
        balance_due_amount numeric(30,4) NOT NULL DEFAULT 0,
        create_request_fingerprint_version varchar(32) NOT NULL DEFAULT 'purchase-order.create.v5',
        payment_status text NOT NULL DEFAULT 'UNPAID',
        CONSTRAINT purchase_orders_amount_scales_check CHECK (scale(purchase_total_amount) <= 4)
      );
      CREATE TABLE purchase_order_lines (
        reference_purchase_unit_price_amount numeric(30,4) NOT NULL DEFAULT 0,
        actual_purchase_unit_price_amount numeric(30,4) NOT NULL DEFAULT 0,
        line_total_amount numeric(30,4) NOT NULL DEFAULT 0,
        CONSTRAINT purchase_order_lines_amount_scales_check CHECK (scale(line_total_amount) <= 4)
      );
      CREATE TABLE purchase_order_payments (
        amount numeric(30,4) NOT NULL,
        CONSTRAINT purchase_order_payments_amount_check CHECK (amount > 0 AND scale(amount) <= 4)
      );
      CREATE TABLE purchase_order_amount_revisions (old_purchase_total_amount numeric(30,4));
      CREATE TABLE purchase_order_image_drafts (snapshot jsonb, snapshot_hash text);
      CREATE FUNCTION enforce_purchase_order_line_subtotal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
      CREATE FUNCTION enforce_purchase_order_payment_summary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
      CREATE CONSTRAINT TRIGGER purchase_orders_line_subtotal_trigger AFTER INSERT OR UPDATE OF line_subtotal_amount ON purchase_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_purchase_order_line_subtotal();
      CREATE CONSTRAINT TRIGGER purchase_orders_payment_summary_trigger AFTER INSERT OR UPDATE OF purchase_total_amount, payment_status ON purchase_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_purchase_order_payment_summary();
    `)
    await action(client, schema)
  }
  finally {
    await client.query('ROLLBACK')
    await client.query('RESET search_path')
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await client.end()
  }
}

describe('purchase operational amount cents migration', () => {
  jest.setTimeout(30_000)

  it.each([
    ['purchase_orders', 'line_subtotal_amount'],
    ['purchase_orders', 'purchase_total_amount'],
    ['purchase_orders', 'deposit_due_amount'],
    ['purchase_orders', 'balance_due_amount'],
    ['purchase_order_lines', 'actual_purchase_unit_price_amount'],
    ['purchase_order_lines', 'line_total_amount'],
    ['purchase_order_payments', 'amount'],
  ])('fails before changing %s.%s when stored operational values contain sub-cents', async (table, column) => {
    await withSchema(async (client, schema) => {
      await client.query(`INSERT INTO "${table}" ("${column}") VALUES (12.3456)`)
      await expect(client.query(readFileSync(migrationPath, 'utf8'))).rejects.toMatchObject({ code: '23514', constraint: 'purchase_order_operational_amount_cents_required' })
      await client.query('ROLLBACK')
      const value = await client.query(`SELECT "${column}"::text AS amount FROM "${table}"`)
      expect(value.rows).toEqual([{ amount: '12.3456' }])
      const precision = await client.query('SELECT numeric_scale FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3', [schema, table, column])
      expect(precision.rows[0]).toEqual({ numeric_scale: 4 })
    })
  })

  it('converts exact-cent amounts, keeps immutable history and references unchanged, and defaults new requests to v6', async () => {
    await withSchema(async (client, schema) => {
      const snapshot = { amount: '12.3456', version: 'purchase-order.create.v5' }
      await client.query(`
        INSERT INTO purchase_orders VALUES (12.3400, 12.3400, 2.3400, 10.0000, 'purchase-order.create.v5', 'UNPAID');
        INSERT INTO purchase_order_lines VALUES (12.3456, 12.3400, 24.6800);
        INSERT INTO purchase_order_payments VALUES (2.3400);
        INSERT INTO purchase_order_amount_revisions VALUES (11.1234);
      `)
      await client.query('INSERT INTO purchase_order_image_drafts VALUES ($1, $2)', [snapshot, 'immutable-image-hash'])
      await client.query(readFileSync(migrationPath, 'utf8'))
      expect((await client.query('SELECT * FROM purchase_orders')).rows).toEqual([{
        line_subtotal_amount: '12.34', purchase_total_amount: '12.34', deposit_due_amount: '2.34', balance_due_amount: '10.00', create_request_fingerprint_version: 'purchase-order.create.v5', payment_status: 'UNPAID',
      }])
      expect((await client.query('SELECT * FROM purchase_order_lines')).rows).toEqual([{
        reference_purchase_unit_price_amount: '12.3456', actual_purchase_unit_price_amount: '12.34', line_total_amount: '24.68',
      }])
      expect((await client.query('SELECT * FROM purchase_order_payments')).rows).toEqual([{ amount: '2.34' }])
      expect((await client.query('SELECT * FROM purchase_order_amount_revisions')).rows).toEqual([{ old_purchase_total_amount: '11.1234' }])
      expect((await client.query('SELECT * FROM purchase_order_image_drafts')).rows).toEqual([{ snapshot, snapshot_hash: 'immutable-image-hash' }])
      const scales = await client.query(`SELECT numeric_scale FROM information_schema.columns WHERE table_schema = $1 AND table_name IN ('purchase_orders', 'purchase_order_lines', 'purchase_order_payments') AND data_type = 'numeric' AND column_name <> 'reference_purchase_unit_price_amount'`, [schema])
      expect(scales.rows).toHaveLength(7)
      expect(scales.rows.every((row: { numeric_scale: number }) => row.numeric_scale === 2)).toBe(true)
      const triggers = await client.query<{ tgname: string, tgdeferrable: boolean, tginitdeferred: boolean, tgenabled: string, definition: string }>(`SELECT tgname, tgdeferrable, tginitdeferred, tgenabled, pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid = 'purchase_orders'::regclass AND NOT tgisinternal ORDER BY tgname`)
      expect(triggers.rows).toHaveLength(2)
      for (const trigger of triggers.rows) {
        expect(trigger).toMatchObject({ tgdeferrable: true, tginitdeferred: true, tgenabled: 'O' })
      }
      expect(triggers.rows[0].definition).toContain('UPDATE OF line_subtotal_amount')
      expect(triggers.rows[1].definition).toContain('UPDATE OF purchase_total_amount, payment_status')
      expect((await client.query('INSERT INTO purchase_orders DEFAULT VALUES RETURNING create_request_fingerprint_version')).rows[0]).toEqual({ create_request_fingerprint_version: 'purchase-order.create.v6' })
    })
  })
})
