import { Client } from 'pg'
import { createReceiptTestDatabase } from './fixtures/receipt-test-database'
import { insertFixture, insertRequest } from './fixtures/sales-receipt-schema.fixture'


async function rejectsConstraint(client: Client, action: () => Promise<unknown>, constraint: string) {
  await client.query('SAVEPOINT receipt_expected_failure')
  let failure: unknown
  try { await action(); await client.query('SET CONSTRAINTS ALL IMMEDIATE') } catch (error) { failure = error }
  await client.query('ROLLBACK TO SAVEPOINT receipt_expected_failure')
  expect(failure).toMatchObject({ code: '23514', constraint })
}

describe('sales receipt migration with isolated PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createReceiptTestDatabase>>
  let client: Client
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    database = await createReceiptTestDatabase()
    client = new Client({ connectionString: database.databaseUrl })
    await client.connect()
  })
  afterAll(async () => { await client.end(); await database.close() })

  it('creates the immutable receipt queue and assignable finance permissions', async () => {
    const table = await client.query<{ name: string | null }>("SELECT to_regclass('public.sales_receipt_requests')::text AS name")
    expect(table.rows[0].name).toBe('sales_receipt_requests')
    const permissions = await client.query("SELECT code, system_only FROM permissions WHERE code LIKE 'sales-receipts:%' ORDER BY code")
    expect(permissions.rows).toEqual([
      { code: 'sales-receipts:read', system_only: false },
      { code: 'sales-receipts:review', system_only: false },
      { code: 'sales-receipts:void', system_only: false },
    ])
    const sources = await client.query(`SELECT type.code FROM fund_business_sources source
      JOIN fund_business_source_posting_types allowed ON allowed.business_source_id = source.id
      JOIN fund_posting_types type ON type.id = allowed.posting_type_id
      WHERE source.code = 'SALES_RECEIPT'`)
    expect(sources.rows).toEqual([{ code: 'ORDER_SETTLEMENT' }])
  })

  it('requires final transaction consistency for receipts and formal payments', async () => {
    const guards = await client.query(`SELECT tgname, tgdeferrable, tginitdeferred FROM pg_trigger
      WHERE tgname IN ('sales_receipt_requests_consistency_trigger', 'sales_order_payments_receipt_consistency_trigger') ORDER BY tgname`)
    expect(guards.rows).toEqual([
      { tgname: 'sales_order_payments_receipt_consistency_trigger', tgdeferrable: true, tginitdeferred: true },
      { tgname: 'sales_receipt_requests_consistency_trigger', tgdeferrable: true, tginitdeferred: true },
    ])
  })
  it('preserves rejected evidence and refuses deletion, mutation, incomplete approval, and legacy bypass', async () => {
    await client.query('BEGIN')
    try {
      const fixture = await insertFixture(client)
      const id = await insertRequest(client, fixture)
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('SET CONSTRAINTS ALL DEFERRED')
      await rejectsConstraint(client, () => client.query('DELETE FROM sales_receipt_requests WHERE id=$1', [id]), 'sales_receipt_requests_immutable_check')
      await rejectsConstraint(client, () => client.query('UPDATE sales_receipt_requests SET amount=200 WHERE id=$1', [id]), 'sales_receipt_requests_immutable_check')
      await rejectsConstraint(client, () => client.query(`UPDATE sales_receipt_requests SET status='APPROVED',version=2,reviewed_at=clock_timestamp(),reviewed_by_user_id=$2 WHERE id=$1`, [id, fixture.userId]), 'sales_receipt_requests_state_check')
      await rejectsConstraint(client, () => client.query(`INSERT INTO sales_order_payments (sales_order_id,payment_type,amount,received_at,created_by_user_id,origin) VALUES ($1,'DEPOSIT',100,CURRENT_TIMESTAMP,$2,'LEGACY')`, [fixture.salesOrderId,fixture.userId]), 'sales_order_payments_review_required_check')
      await rejectsConstraint(client, () => client.query(`UPDATE sales_receipt_requests SET status='REJECTED',version=2,reviewed_at=clock_timestamp(),reviewed_by_user_id=$2,review_remark=NULL WHERE id=$1`, [id,fixture.userId]), 'sales_receipt_requests_state_check')
      await client.query(`UPDATE sales_receipt_requests SET status='REJECTED',version=2,reviewed_at=clock_timestamp(),reviewed_by_user_id=$2,review_remark='凭证信息需核对' WHERE id=$1`, [id,fixture.userId])
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      const media = await client.query<{ status: string }>('SELECT status FROM media_assets WHERE id=$1',[fixture.assetId])
      expect(media.rows[0].status).toBe('READY')
      await rejectsConstraint(client, () => client.query(`UPDATE media_assets SET status='TRASHED', deleted_at=clock_timestamp(), retention_until=clock_timestamp()+interval '30 days' WHERE id=$1`, [fixture.assetId]), 'sales_receipt_requests_voucher_ready_check')
    } finally { await client.query('ROLLBACK') }
  })

  it('rejects a pending reservation beyond receivable without creating a formal payment', async () => {
    await client.query('BEGIN')
    try {
      const fixture = await insertFixture(client)
      await rejectsConstraint(client, () => insertRequest(client,fixture,'1001'), 'sales_receipt_requests_reserved_amount_check')
      const result = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM sales_order_payments WHERE sales_order_id=$1',[fixture.salesOrderId])
      expect(result.rows[0].count).toBe(0)
    } finally { await client.query('ROLLBACK') }
  })

})
