import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { insertFixture } from './fixtures/sales-receipt-schema.fixture'

const migrationsPath = resolve(__dirname, '../prisma/migrations')

describe('sales receipt historical migration', () => {
  jest.setTimeout(60_000)
  it('preserves existing payment and balances as LEGACY and prevents new legacy inserts', async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    const schema = `receipt_migration_${randomUUID().replaceAll('-', '')}`
    await client.connect()
    try {
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET search_path TO "${schema}"`)
      const directories = readdirSync(migrationsPath).filter(name => /^\d/u.test(name)).sort()
      for (const directory of directories.filter(name => name < '20260908120000')) {
        await client.query(readFileSync(resolve(migrationsPath, directory, 'migration.sql'), 'utf8'))
      }
      await client.query('BEGIN')
      const fixture = await insertFixture(client)
      const paymentId = randomUUID()
      await client.query(`INSERT INTO sales_order_payments (id,sales_order_id,payment_type,amount,received_at,payment_method,created_by_user_id)
        VALUES ($1,$2,'DEPOSIT',100,CURRENT_TIMESTAMP,'bank_transfer',$3)`, [paymentId,fixture.salesOrderId,fixture.userId])
      await client.query(`INSERT INTO sales_order_documents (sales_order_id,media_asset_id,payment_id,document_type,title,created_by_user_id)
        VALUES ($1,$2,$3,'PAYMENT_VOUCHER','历史凭证',$4)`, [fixture.salesOrderId,fixture.assetId,paymentId,fixture.userId])
      await client.query(`UPDATE sales_orders SET payment_status='PARTIALLY_PAID' WHERE id=$1`,[fixture.salesOrderId])
      await client.query('COMMIT')
      const before = await client.query('SELECT id,balance FROM fund_accounts ORDER BY id')
      for (const directory of directories.filter(name => name >= '20260908120000')) {
        await client.query(readFileSync(resolve(migrationsPath, directory, 'migration.sql'), 'utf8'))
      }
      const payment = await client.query('SELECT amount::text,origin,fund_posting_batch_id,fund_reversal_batch_id FROM sales_order_payments WHERE id=$1',[paymentId])
      expect(payment.rows).toEqual([{ amount:'100.0000',origin:'LEGACY',fund_posting_batch_id:null,fund_reversal_batch_id:null }])
      const after = await client.query('SELECT id,balance FROM fund_accounts ORDER BY id')
      expect(after.rows).toEqual(before.rows)
      await expect(client.query(`INSERT INTO sales_order_payments (sales_order_id,payment_type,amount,received_at,created_by_user_id,origin)
        VALUES ($1,'DEPOSIT',100,CURRENT_TIMESTAMP,$2,'LEGACY')`,[fixture.salesOrderId,fixture.userId])).rejects.toMatchObject({ code:'23514',constraint:'sales_order_payments_review_required_check' })
    } finally {
      await client.query('ROLLBACK')
      await client.query('RESET search_path')
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await client.end()
    }
  })
})
