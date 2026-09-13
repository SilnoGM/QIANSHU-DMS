import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { insertFixture, insertRequest } from './fixtures/sales-receipt-schema.fixture'

/** 直接 SQL 故意绕过应用服务，验证资金事实在事务提交前仍受数据库守卫保护。 */
describe('sales receipt fund invariants against direct PostgreSQL writes', () => {
  let client: Client
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
  })
  afterAll(async () => { await client.end() })
  beforeEach(async () => { await client.query('BEGIN') })
  afterEach(async () => { await client.query('ROLLBACK') })

  async function batch(userId: string, requestId: string) {
    const id = randomUUID()
    await client.query(`INSERT INTO fund_posting_batches (
      id,batch_no,kind,posting_type_id,posting_type_code_snapshot,posting_type_name_snapshot,
      business_category_snapshot,business_source_id,business_source_code_snapshot,business_source_name_snapshot,
      rule_version_id,rule_revision_snapshot,user_id,business_amount,user_share_rate_snapshot,company_share_rate_snapshot,
      business_id,summary,business_occurred_at,consumer_code,idempotency_key_hash,request_fingerprint_hash,actor_user_id,request_id)
      SELECT $1,$2,'BUSINESS',type.id,type.code,type.name,'REVENUE',source.id,source.code,source.name,
      rule.id,rule.revision,$3,100,100,0,$4,'Receipt guard fixture',CURRENT_TIMESTAMP,'SALES_RECEIPT.APPROVE',$5,$6,$3,$7
      FROM fund_posting_types type JOIN fund_posting_rule_versions rule ON rule.id=type.current_rule_version_id
      CROSS JOIN fund_business_sources source WHERE type.code='ORDER_SETTLEMENT' AND source.code='SALES_RECEIPT'`,
    [id, `GUARD_${id.replaceAll('-', '').toUpperCase()}`, userId, requestId, randomBytes(32), randomBytes(32), randomUUID()])
    return id
  }

  async function approvedFixture() {
    const fixture = await insertFixture(client)
    const requestId = await insertRequest(client, fixture)
    const account = await client.query<{ id: string }>(`INSERT INTO fund_accounts (owner_type,user_id,user_share_rate,balance,next_sequence,share_rate_updated_at)
      VALUES ('USER',$1,100,100,2,CURRENT_TIMESTAMP) RETURNING id`, [fixture.userId])
    const accountId = account.rows[0].id
    const rate = await client.query<{ id: string; version: number }>(`INSERT INTO exchange_rates (currency_id,foreign_units_per_cny)
      SELECT id,1 FROM currencies WHERE code='TWD'
      ON CONFLICT (currency_id) DO UPDATE SET foreign_units_per_cny=1,version=exchange_rates.version+1 RETURNING id,version`)
    const batchId = await batch(fixture.userId, requestId)
    await client.query(`INSERT INTO fund_ledger_entries (batch_id,line_no,account_id,direction,account_target,amount_strategy,amount,balance_before,balance_after,account_sequence)
      VALUES ($1,1,$2,'CREDIT','USER','USER_SHARE',100,0,100,1)`, [batchId, accountId])
    const paymentId = randomUUID()
    await client.query(`INSERT INTO sales_order_payments (id,sales_order_id,payment_type,amount,received_at,payment_method,created_by_user_id,
      origin,fund_posting_batch_id,exchange_rate_id,exchange_rate_version_snapshot,foreign_units_per_cny_snapshot,exchange_rate_captured_at)
      SELECT $1,sales_order_id,payment_type,amount,received_at,payment_method,$2,'REVIEWED',$3,$4,$5,1,CURRENT_TIMESTAMP FROM sales_receipt_requests WHERE id=$6`,
    [paymentId, fixture.userId, batchId, rate.rows[0].id, rate.rows[0].version, requestId])
    await client.query(`INSERT INTO sales_order_documents (sales_order_id,media_asset_id,document_type,title,payment_id,created_by_user_id)
      SELECT sales_order_id,voucher_media_asset_id,'PAYMENT_VOUCHER',voucher_title,$1,$2 FROM sales_receipt_requests WHERE id=$3`, [paymentId, fixture.userId, requestId])
    await client.query(`UPDATE sales_receipt_requests SET status='APPROVED',version=2,reviewed_by_user_id=$2,reviewed_at=clock_timestamp(),approved_payment_id=$3 WHERE id=$1`, [requestId, fixture.userId, paymentId])
    await client.query(`UPDATE sales_orders SET payment_status='PARTIALLY_PAID' WHERE id=$1`, [fixture.salesOrderId])
    // 先证明基线本身能通过全部延期约束，后续失败才能归因于攻击操作。
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    await client.query('SET CONSTRAINTS ALL DEFERRED')
    return { ...fixture, requestId, accountId, batchId, paymentId }
  }

  async function reversal(fixture: Awaited<ReturnType<typeof approvedFixture>>) {
    const id = randomUUID()
    await client.query(`INSERT INTO fund_posting_batches (
      id,batch_no,kind,posting_type_id,posting_type_code_snapshot,posting_type_name_snapshot,
      business_category_snapshot,business_source_id,business_source_code_snapshot,business_source_name_snapshot,
      rule_version_id,rule_revision_snapshot,user_id,business_amount,currency,user_share_rate_snapshot,company_share_rate_snapshot,
      business_id,summary,business_occurred_at,consumer_code,idempotency_key_hash,request_fingerprint_hash,actor_user_id,request_id,reversal_of_batch_id,reversal_reason)
      SELECT $1,$2,'REVERSAL',posting_type_id,posting_type_code_snapshot,posting_type_name_snapshot,
      business_category_snapshot,business_source_id,business_source_code_snapshot,business_source_name_snapshot,
      rule_version_id,rule_revision_snapshot,user_id,-business_amount,currency,user_share_rate_snapshot,company_share_rate_snapshot,
      business_id,summary,business_occurred_at,'SALES_RECEIPT.VOID',$3,$4,actor_user_id,$5,id,'Guard reversal'
      FROM fund_posting_batches WHERE id=$6`, [id, `GUARD_${id.replaceAll('-', '').toUpperCase()}`, randomBytes(32), randomBytes(32), randomUUID(), fixture.batchId])
    await client.query(`INSERT INTO fund_ledger_entries (batch_id,line_no,account_id,direction,account_target,amount_strategy,amount,balance_before,balance_after,account_sequence)
      VALUES ($1,1,$2,'DEBIT','USER','USER_SHARE',100,100,0,2)`, [id, fixture.accountId])
    return id
  }

  async function voidPayment(fixture: Awaited<ReturnType<typeof approvedFixture>>, reversalId: string) {
    await client.query(`UPDATE sales_order_payments SET voided_at=clock_timestamp(),voided_by_user_id=$2,void_reason='Guard reversal',fund_reversal_batch_id=$3 WHERE id=$1`, [fixture.paymentId, fixture.userId, reversalId])
    await client.query(`UPDATE sales_orders SET payment_status='UNPAID' WHERE id=$1`, [fixture.salesOrderId])
  }

  it('refuses an isolated receipt posting without an approved payment', async () => {
    const fixture = await insertFixture(client)
    await insertRequest(client, fixture)
    await batch(fixture.userId, randomUUID())
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toMatchObject({ code: '23514', constraint: 'sales_receipt_requests_posting_consistency_check' })
  })

  it('refuses a direct reversal while the approved receipt is still active', async () => {
    const fixture = await approvedFixture()
    await reversal(fixture)
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toMatchObject({ code: '23514', constraint: 'sales_receipt_requests_posting_consistency_check' })
  })

  it('refuses ledger facts appended to an already validated receipt posting', async () => {
    const fixture = await approvedFixture()
    await client.query(`INSERT INTO fund_ledger_entries (batch_id,line_no,account_id,direction,account_target,amount_strategy,amount,balance_before,balance_after,account_sequence)
      VALUES ($1,2,$2,'CREDIT','USER','USER_SHARE',1,100,101,2)`, [fixture.batchId, fixture.accountId])
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toMatchObject({ code: '23514', constraint: 'sales_receipt_requests_posting_consistency_check' })
  })

  it('refuses an extra inverse ledger entry even when every original entry has a match', async () => {
    const fixture = await approvedFixture()
    const reversalId = await reversal(fixture)
    await voidPayment(fixture, reversalId)
    await client.query(`INSERT INTO fund_ledger_entries (batch_id,line_no,account_id,direction,account_target,amount_strategy,amount,balance_before,balance_after,account_sequence)
      VALUES ($1,2,$2,'DEBIT','USER','USER_SHARE',1,0,-1,3)`, [reversalId, fixture.accountId])
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toMatchObject({ code: '23514', constraint: 'sales_receipt_requests_reversal_consistency_check' })
  })

  it('accepts an exact full inverse with the receipt voided in the same transaction', async () => {
    const fixture = await approvedFixture()
    const reversalId = await reversal(fixture)
    await voidPayment(fixture, reversalId)
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).resolves.toBeDefined()
  })
})
