import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { insertFixture, insertRequest } from './fixtures/sales-receipt-schema.fixture'
import { insertCollectionIssuance } from './fixtures/sales-receipt-numbering.fixture'
import { insertFundPostingBatchIssuance } from './fixtures/fund-posting-numbering.fixture'

const migrationsPath = resolve(__dirname, '../prisma/migrations')
const collectionMigration = '20260909090000_sales_receipt_collection_number'

describe('sales receipt collection number migration', () => {
  jest.setTimeout(60_000)
  let client: Client
  let schema: string
  let historicalId: string
  let historicalUserId: string
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    schema = `receipt_numbering_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    const directories = readdirSync(migrationsPath).filter(name => /^\d/u.test(name)).sort()
    for (const directory of directories.filter(name => name < collectionMigration)) {
      await client.query(readFileSync(resolve(migrationsPath, directory, 'migration.sql'), 'utf8'))
    }
    await client.query('BEGIN')
    const fixture = await insertFixture(client)
    historicalUserId = fixture.userId
    historicalId = await insertUnnumbered(fixture)
    await client.query('COMMIT')
    for (const directory of directories.filter(name => name >= collectionMigration)) {
      await client.query(readFileSync(resolve(migrationsPath, directory, 'migration.sql'), 'utf8'))
    }
  })
  afterAll(async () => {
    if (!client) return
    await client.query('ROLLBACK')
    await client.query('RESET search_path')
    if (schema) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await client.end()
  })
  beforeEach(async () => { await client.query('BEGIN') })
  afterEach(async () => { await client.query('ROLLBACK') })

  async function insertUnnumbered(fixture: Awaited<ReturnType<typeof insertFixture>>) {
    const result = await client.query<{ id: string }>(`INSERT INTO sales_receipt_requests
      (sales_order_id,account_owner_user_id,payment_type,amount,currency_code,received_at,payment_method,payment_method_name_snapshot,
      voucher_media_asset_id,voucher_title,submitted_by_user_id,idempotency_key_hash,request_fingerprint_hash)
      VALUES ($1,$2,'DEPOSIT',100,'TWD',CURRENT_TIMESTAMP,'bank_transfer','银行转账',$3,'测试凭证',$2,$4,$5) RETURNING id`,
    [fixture.salesOrderId, fixture.userId, fixture.assetId, randomBytes(32), randomBytes(32)])
    return result.rows[0].id
  }

  async function insertNumbered(fixture: Awaited<ReturnType<typeof insertFixture>>, numbering: { collectionNo: string; numberingIssuanceId: string }, fingerprint: Buffer) {
    return client.query(`INSERT INTO sales_receipt_requests
      (sales_order_id,account_owner_user_id,payment_type,amount,currency_code,received_at,payment_method,payment_method_name_snapshot,
      voucher_media_asset_id,voucher_title,submitted_by_user_id,idempotency_key_hash,request_fingerprint_hash,collection_no,numbering_issuance_id)
      VALUES ($1,$2,'DEPOSIT',100,'TWD',CURRENT_TIMESTAMP,'bank_transfer','银行转账',$3,'测试凭证',$2,$4,$5,$6,$7) RETURNING id`,
    [fixture.salesOrderId, fixture.userId, fixture.assetId, randomBytes(32), fingerprint, numbering.collectionNo, numbering.numberingIssuanceId])
  }

  it.each(['number', 'fingerprint', 'consumer', 'rule'] as const)('rejects a forged %s association', async (forged) => {
    const fixture = await insertFixture(client)
    const fingerprint = randomBytes(32)
    const numbering = await insertCollectionIssuance(client, fingerprint, {
      ...(forged === 'consumer' ? { consumerCode: 'UNRELATED.CREATE' } : {}),
      ...(forged === 'rule' ? { ruleCode: 'UNRELATED_COLLECTION' } : {}),
    })
    await expect(insertNumbered(fixture,
      forged === 'number' ? { ...numbering, collectionNo: 'FORGED' } : numbering,
      forged === 'fingerprint' ? randomBytes(32) : fingerprint,
    )).rejects.toMatchObject({ code: '23514', constraint: 'sales_receipt_requests_numbering_identity_check' })
  })

  it('accepts a scoped issuance and preserves its number through review', async () => {
    const fixture = await insertFixture(client)
    const id = await insertRequest(client, fixture)
    const before = await client.query<{ collection_no: string; numbering_issuance_id: string }>('SELECT collection_no,numbering_issuance_id FROM sales_receipt_requests WHERE id=$1', [id])
    expect(before.rows[0].collection_no).toMatch(/^SC-\d{12}$/u)
    expect(before.rows[0].numbering_issuance_id).toBeTruthy()
    await client.query(`UPDATE sales_receipt_requests SET status='REJECTED',version=2,reviewed_by_user_id=$2,reviewed_at=clock_timestamp(),review_remark='核对凭证' WHERE id=$1`, [id, fixture.userId])
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    const after = await client.query('SELECT collection_no,numbering_issuance_id FROM sales_receipt_requests WHERE id=$1', [id])
    expect(after.rows).toEqual(before.rows)
  })

  it('forbids changing the frozen collection number while reviewing', async () => {
    const fixture = await insertFixture(client)
    const id = await insertRequest(client, fixture)
    await expect(client.query(`UPDATE sales_receipt_requests SET collection_no='FORGED',status='REJECTED',version=2,
      reviewed_by_user_id=$2,reviewed_at=clock_timestamp(),review_remark='核对凭证' WHERE id=$1`, [id, fixture.userId]))
      .rejects.toMatchObject({ code: '23514', constraint: 'sales_receipt_requests_immutable_check' })
  })

  it('does not allow another request to consume the same issuance', async () => {
    const fingerprint = randomBytes(32)
    const numbering = await insertCollectionIssuance(client, fingerprint)
    await insertNumbered(await insertFixture(client), numbering, fingerprint)
    await expect(insertNumbered(await insertFixture(client), numbering, fingerprint)).rejects.toMatchObject({ code: '23505' })
  })

  it('does not create or enable a collection rule during migration', async () => {
    const rules = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM numbering_rules WHERE rule_code='SALES_COLLECTION'")
    expect(rules.rows).toEqual([{ count: 0 }])
  })

  it('rejects a new request without collection numbering', async () => {
    const fixture = await insertFixture(client)
    await expect(insertUnnumbered(fixture)).rejects.toMatchObject({ code: '23514', constraint: 'sales_receipt_requests_numbering_required_check' })
  })

  it('keeps historical numbers null and permits financial rejection without backfill', async () => {
    const row = await client.query('SELECT collection_no,numbering_issuance_id FROM sales_receipt_requests WHERE id=$1', [historicalId])
    expect(row.rows).toEqual([{ collection_no: null, numbering_issuance_id: null }])
    await client.query(`UPDATE sales_receipt_requests SET status='REJECTED',version=2,reviewed_by_user_id=$2,reviewed_at=clock_timestamp(),review_remark='历史凭证核对驳回' WHERE id=$1`, [historicalId, historicalUserId])
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).resolves.toBeDefined()
  })
  it('allows an unnumbered historical request to be approved and posted without consuming a number', async () => {
    const request = await client.query<{ sales_order_id: string; voucher_media_asset_id: string }>('SELECT sales_order_id,voucher_media_asset_id FROM sales_receipt_requests WHERE id=$1', [historicalId])
    const orderId = request.rows[0].sales_order_id
    const account = await client.query<{ id: string }>(`INSERT INTO fund_accounts (owner_type,user_id,user_share_rate,share_rate_updated_at,balance,next_sequence)
      VALUES ('USER',$1,100,CURRENT_TIMESTAMP,100,2) RETURNING id`, [historicalUserId])
    const rate = await client.query<{ id: string; version: number }>(`INSERT INTO exchange_rates (currency_id,foreign_units_per_cny)
      SELECT id,1 FROM currencies WHERE code='TWD' ON CONFLICT(currency_id) DO UPDATE SET foreign_units_per_cny=1 RETURNING id,version`)
    const batchId = randomUUID()
    const batchNo = `HISTORY_${batchId.replaceAll('-', '').toUpperCase()}`
    const numberingIssuanceId = await insertFundPostingBatchIssuance(
      client,
      batchNo,
    )
    await client.query(`INSERT INTO fund_posting_batches (id,batch_no,numbering_issuance_id,kind,posting_type_id,posting_type_code_snapshot,posting_type_name_snapshot,
      business_category_snapshot,business_source_id,business_source_code_snapshot,business_source_name_snapshot,rule_version_id,rule_revision_snapshot,
      user_id,business_amount,user_share_rate_snapshot,company_share_rate_snapshot,business_id,summary,business_occurred_at,
      consumer_code,idempotency_key_hash,request_fingerprint_hash,actor_user_id,request_id)
      SELECT $1,$2,$8,'BUSINESS',type.id,type.code,type.name,'REVENUE',source.id,source.code,source.name,rule.id,rule.revision,
      $3,100,100,0,$4,'Historical receipt approval',CURRENT_TIMESTAMP,'SALES_RECEIPT.APPROVE',$5,$6,$3,$7
      FROM fund_posting_types type JOIN fund_posting_rule_versions rule ON rule.id=type.current_rule_version_id
      CROSS JOIN fund_business_sources source WHERE type.code='ORDER_SETTLEMENT' AND source.code='SALES_RECEIPT'`,
    [batchId, batchNo, historicalUserId, historicalId, randomBytes(32), randomBytes(32), randomUUID(), numberingIssuanceId])
    await client.query(`INSERT INTO fund_ledger_entries (batch_id,line_no,account_id,direction,account_target,amount_strategy,amount,balance_before,balance_after,account_sequence)
      VALUES ($1,1,$2,'CREDIT','USER','USER_SHARE',100,0,100,1)`, [batchId, account.rows[0].id])
    const paymentId = randomUUID()
    await client.query(`INSERT INTO sales_order_payments (id,sales_order_id,payment_type,amount,received_at,payment_method,created_by_user_id,
      origin,fund_posting_batch_id,exchange_rate_id,exchange_rate_version_snapshot,foreign_units_per_cny_snapshot,exchange_rate_captured_at)
      SELECT $1,sales_order_id,payment_type,amount,received_at,payment_method,$2,'REVIEWED',$3,$4,$5,1,CURRENT_TIMESTAMP FROM sales_receipt_requests WHERE id=$6`,
    [paymentId, historicalUserId, batchId, rate.rows[0].id, rate.rows[0].version, historicalId])
    await client.query(`INSERT INTO sales_order_documents (sales_order_id,media_asset_id,document_type,title,payment_id,created_by_user_id)
      SELECT sales_order_id,voucher_media_asset_id,'PAYMENT_VOUCHER',voucher_title,$1,$2 FROM sales_receipt_requests WHERE id=$3`, [paymentId, historicalUserId, historicalId])
    await client.query(`UPDATE sales_receipt_requests SET status='APPROVED',version=2,reviewed_by_user_id=$2,reviewed_at=clock_timestamp(),approved_payment_id=$3 WHERE id=$1`, [historicalId, historicalUserId, paymentId])
    await client.query(`UPDATE sales_orders SET payment_status='PARTIALLY_PAID' WHERE id=$1`, [orderId])
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    const after = await client.query('SELECT status,collection_no,numbering_issuance_id FROM sales_receipt_requests WHERE id=$1', [historicalId])
    expect(after.rows).toEqual([{ status: 'APPROVED', collection_no: null, numbering_issuance_id: null }])
    const issuances = await client.query(`SELECT count(*)::int AS count
      FROM numbering_issuances issuance
      JOIN numbering_rules rule ON rule.id = issuance.rule_id
      WHERE rule.rule_code = 'SALES_COLLECTION'`)
    expect(issuances.rows).toEqual([{ count: 0 }])
  })

})
