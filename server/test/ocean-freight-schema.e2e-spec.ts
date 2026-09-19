import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for ocean freight schema tests')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username !== 'qianshu_ci' || url.pathname !== '/qianshu_ci') {
    throw new Error('Ocean freight schema tests require the isolated CI database')
  }
  return value
}

const migration = resolve(__dirname, '../prisma/migrations/20260919090000_ocean_freight_foundation/migration.sql')

describe('ocean freight constraints with isolated PostgreSQL', () => {
  const client = new Client({ connectionString: requireDatabaseUrl() })
  const schema = `ocean_${randomUUID().replaceAll('-', '')}`
  const actor = randomUUID()
  const shipment = randomUUID()
  const hash = 'a'.repeat(64)
  let batch: string
  let secondBatch: string
  let bill: string
  let item: string

  async function createBatch(name: string, sequence: number): Promise<string> {
    const issuance = randomUUID()
    await client.query(`INSERT INTO numbering_issuances (id,rule_id,generated_number,consumer_code)
      SELECT $1,id,$2,'CONTAINER_BATCH.CREATE' FROM numbering_rules WHERE rule_code='CONTAINER_BATCH_NO'`, [issuance, name])
    const result = await client.query<{ id: string }>(`INSERT INTO container_batches
      (container_batch_no,numbering_issuance_id,container_batch_name,loading_date,sequence_in_day,warehouse_value,
      creation_request_key,creation_payload_hash,created_by_id,updated_by_id)
      VALUES ($1,$2,$1,'2026-09-19',$3,'WAREHOUSE',$1,$4,$5,$5) RETURNING id`, [name, issuance, sequence, hash, actor])
    return result.rows[0].id
  }
  async function createItem(container = batch, requestKey = randomUUID(), line = 1, shipmentId: string | null = shipment): Promise<string> {
    const result = await client.query<{ id: string }>(`INSERT INTO container_loading_items
      (container_batch_id,shipment_id,line_number,goods_name,package_count,creation_request_key,creation_payload_hash,created_by_id,updated_by_id)
      VALUES ($1,$2,$3,'Goods',10,$4,$5,$6,$6) RETURNING id`, [container, shipmentId, line, requestKey, hash, actor])
    return result.rows[0].id
  }
  async function createLine(type = 'NORMAL', key = randomUUID(), line = 1): Promise<string> {
    const result = await client.query<{ id: string }>(`INSERT INTO ocean_freight_bill_lines
      (bill_id,line_number,loading_item_id,line_type,creation_request_key,creation_payload_hash,goods_name)
      VALUES ($1,$2,$3,$4,$5,$6,'Goods') RETURNING id`, [bill, line, item, type, key, hash])
    return result.rows[0].id
  }
  beforeAll(async () => {
    await client.connect()
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    // 约束测试只隔离本次新增表，外部领域用最小主键表避免修改现有订单不可变事实。
    await client.query(`CREATE TYPE audit_event_type AS ENUM ('SYSTEM_BOOTSTRAP');
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE media_assets (id uuid PRIMARY KEY);
      CREATE TABLE numbering_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_code text, purpose text);
      CREATE TABLE numbering_issuances (id uuid PRIMARY KEY,rule_id uuid,generated_number text,consumer_code text);
      INSERT INTO numbering_rules (rule_code,purpose) VALUES ('CONTAINER_BATCH_NO','BUSINESS'),('CTN_BILL_NO','BUSINESS');
      CREATE TABLE purchase_order_parts (id uuid PRIMARY KEY);`)
    await client.query(readFileSync(migration, 'utf8'))
    await client.query('INSERT INTO users VALUES ($1)', [actor])
    await client.query('INSERT INTO purchase_order_parts VALUES ($1)', [shipment])
    batch = await createBatch('0919柜', 1)
    secondBatch = await createBatch('0919-02柜', 2)
    const issuance = randomUUID()
    await client.query(`INSERT INTO numbering_issuances (id,rule_id,generated_number,consumer_code)
      SELECT $1,id,'BILL-1','OCEAN_FREIGHT_BILL.CREATE' FROM numbering_rules WHERE rule_code='CTN_BILL_NO'`, [issuance])
    bill = (await client.query<{ id: string }>(`INSERT INTO ocean_freight_bills
      (bill_no,numbering_issuance_id,bill_name,twd_per_cny,creation_request_key,creation_payload_hash,created_by_id,updated_by_id)
      VALUES ('BILL-1',$1,'Bill',4.8,'bill',$2,$3,$3) RETURNING id`, [issuance, hash, actor])).rows[0].id
    item = await createItem()
  })
  afterAll(async () => {
    await client.query('ROLLBACK')
    await client.query('SET search_path TO public')
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await client.end()
  })

  it('keeps multiple packaging rows in one batch and rejects cross-batch shipment allocation', async () => {
    await expect(createItem(batch, randomUUID(), 2)).resolves.toEqual(expect.any(String))
    await expect(createItem(secondBatch)).rejects.toMatchObject({ code: '23514', constraint: 'container_loading_items_shipment_same_batch_check' })
    await expect(client.query('UPDATE container_loading_items SET container_batch_id=$1 WHERE id=$2', [secondBatch, item]))
      .rejects.toMatchObject({ code: '23514', constraint: 'container_loading_items_shipment_same_batch_check' })
  })
  it('rejects invalid amounts, counts, versions, and zero FX while allowing signed net returns', async () => {
    for (const [table, field, value, id] of [
      ['container_loading_items', 'package_count', 0, item],
      ['container_loading_items', 'length_cm', -1, item],
      ['container_loading_items', 'version', 0, item],
      ['ocean_freight_bills', 'twd_per_cny', 0, bill],
      ['ocean_freight_bills', 'twd_per_cny', 'NaN', bill],
      ['ocean_freight_bills', 'net_return_amount_cny', 'NaN', bill],
      ['container_batches', 'sequence_in_day', 0, batch],
    ]) {
      await expect(client.query(`UPDATE ${table} SET ${field}=$1 WHERE id=$2`, [value, id])).rejects.toMatchObject({ code: '23514' })
    }
    await client.query('UPDATE ocean_freight_bills SET net_return_amount_cny=-104.17 WHERE id=$1', [bill])
    expect((await client.query('SELECT net_return_amount_cny FROM ocean_freight_bills WHERE id=$1', [bill])).rows[0]).toEqual({ net_return_amount_cny: '-104.17' })
  })
  it('enforces normal billing uniqueness, allows repeated adjustments, and rejects replay keys', async () => {
    await createLine()
    await expect(createLine('NORMAL', randomUUID(), 2)).rejects.toMatchObject({ code: '23505', constraint: 'ocean_freight_bill_lines_normal_loading_item_key' })
    const key = randomUUID()
    await createLine('ADJUSTMENT', key, 2)
    await createLine('ADJUSTMENT', randomUUID(), 3)
    await expect(createLine('ADJUSTMENT', key, 4)).rejects.toMatchObject({ code: '23505', constraint: 'ocean_freight_bill_lines_bill_request_key' })
  })
  it('uses nonnegative absolute charge amounts and explicit deduction nature', async () => {
    const line = await createLine('ADJUSTMENT', randomUUID(), 5)
    const insert = (amount: number, nature: string) => client.query(`INSERT INTO ocean_freight_bill_charges
      (bill_line_id,charge_type,currency_code,amount,charge_nature,pricing_basis,remark,created_by_id,updated_by_id)
      VALUES ($1,'DELIVERY','TWD',$2,$3,'FIXED','Delivery adjustment',$4,$4)`, [line, amount, nature, actor])
    await expect(insert(-500, 'DEDUCTION')).rejects.toMatchObject({ code: '23514' })
    await expect(insert(500, 'DEDUCTION')).resolves.toBeDefined()
    await expect(client.query(`INSERT INTO ocean_freight_bill_charges
      (bill_line_id,charge_type,currency_code,amount,charge_nature,pricing_basis,created_by_id,updated_by_id)
      VALUES ($1,'OTHER','CNY',1,'NORMAL','FIXED',$2,$2)`, [line, actor])).rejects.toMatchObject({ code: '23514' })
  })
  it('requires the matching numbering rule, business purpose, and scoped issuance', async () => {
    await expect(client.query("UPDATE container_batches SET container_batch_no='FORGED' WHERE id=$1", [batch]))
      .rejects.toMatchObject({ code: '23514', constraint: 'ocean_freight_numbering_identity_check' })
    await expect(client.query('UPDATE ocean_freight_bills SET numbering_issuance_id=(SELECT numbering_issuance_id FROM container_batches WHERE id=$1) WHERE id=$2', [batch, bill]))
      .rejects.toMatchObject({ code: '23514', constraint: 'ocean_freight_numbering_identity_check' })
  })
  it('prevents adjustment cycles, changed target cargo, and confirmation without an actor', async () => {
    const a = await createLine('ADJUSTMENT', randomUUID(), 6)
    const b = await createLine('ADJUSTMENT', randomUUID(), 7)
    await client.query('UPDATE ocean_freight_bill_lines SET adjusts_bill_line_id=$1 WHERE id=$2', [a, b])
    await expect(client.query('UPDATE ocean_freight_bill_lines SET adjusts_bill_line_id=$1 WHERE id=$2', [b, a]))
      .rejects.toMatchObject({ code: '23514', constraint: 'ocean_freight_bill_lines_adjustment_cycle_check' })
    await expect(client.query('UPDATE ocean_freight_bill_lines SET loading_item_id=NULL WHERE id=$1', [a]))
      .rejects.toMatchObject({ code: '23514', constraint: 'ocean_freight_bill_lines_adjustment_target_check' })
    await expect(client.query("UPDATE ocean_freight_bill_lines SET reconciliation_status='CONFIRMED' WHERE id=$1", [a]))
      .rejects.toMatchObject({ code: '23514', constraint: 'ocean_freight_bill_lines_confirmation_check' })
  })
  it.each(['READ COMMITTED', 'SERIALIZABLE'])('serializes concurrent cross-batch allocation at %s', async (isolation) => {
    const first = new Client({ connectionString: requireDatabaseUrl() })
    const second = new Client({ connectionString: requireDatabaseUrl() })
    const concurrentShipment = randomUUID()
    await client.query('INSERT INTO purchase_order_parts VALUES ($1)', [concurrentShipment])
    const insert = (connection: Client, container: string) => connection.query(`INSERT INTO container_loading_items
      (container_batch_id,shipment_id,line_number,goods_name,package_count,creation_request_key,creation_payload_hash,created_by_id,updated_by_id)
      VALUES ($1,$2,$3,'Concurrent goods',1,$4,$5,$6,$6)`, [container, concurrentShipment, isolation === 'SERIALIZABLE' ? 101 : 100, randomUUID(), hash, actor])
    try {
      await first.connect()
      await second.connect()
      await first.query(`SET search_path TO "${schema}", public`)
      await second.query(`SET search_path TO "${schema}", public`)
      await first.query(`BEGIN ISOLATION LEVEL ${isolation}`)
      await second.query(`BEGIN ISOLATION LEVEL ${isolation}`)
      await insert(first, batch)
      const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid
      // 先捕获异步拒绝，避免锁释放后未处理的 Promise rejection。
      const blocked = insert(second, secondBatch).then(() => ({ code: 'UNEXPECTED_SUCCESS' }), (error: { code: string }) => ({ code: error.code }))
      let waiting = false
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await client.query<{ waiting: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') AS waiting`, [secondPid])
        if (state.rows[0]?.waiting) { waiting = true; break }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(waiting).toBe(true)
      await first.query('COMMIT')
      expect(['23514', '40001']).toContain((await blocked).code)
      await second.query('ROLLBACK')
      expect((await client.query('SELECT count(DISTINCT container_batch_id)::int AS count FROM container_loading_items WHERE shipment_id=$1', [concurrentShipment])).rows[0]).toEqual({ count: 1 })
    } finally {
      await first.query('ROLLBACK')
      await second.query('ROLLBACK')
      await first.end()
      await second.end()
    }
  })
  it('rejects repeatable-read allocations whose stale snapshots cannot enforce cross-batch integrity', async () => {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    try {
      await expect(createItem(batch, randomUUID(), 102)).rejects.toMatchObject({ code: '23514', constraint: 'container_loading_items_isolation_check' })
    } finally {
      await client.query('ROLLBACK')
    }
  })

})
