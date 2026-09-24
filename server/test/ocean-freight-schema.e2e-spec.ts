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
      INSERT INTO numbering_rules (rule_code,purpose) VALUES ('CONTAINER_BATCH_NO','BUSINESS');
      CREATE TABLE purchase_order_parts (id uuid PRIMARY KEY);`)
    await client.query(readFileSync(migration, 'utf8'))
    await client.query('INSERT INTO users VALUES ($1)', [actor])
    await client.query('INSERT INTO purchase_order_parts VALUES ($1)', [shipment])
    batch = await createBatch('0919柜', 1)
    secondBatch = await createBatch('0919-02柜', 2)
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
  it('rejects invalid amounts, counts and versions', async () => {
    for (const [table, field, value, id] of [
      ['container_loading_items', 'package_count', 0, item],
      ['container_loading_items', 'length_cm', -1, item],
      ['container_loading_items', 'version', 0, item],
      ['container_batches', 'sequence_in_day', 0, batch],
    ]) {
      await expect(client.query(`UPDATE ${table} SET ${field}=$1 WHERE id=$2`, [value, id])).rejects.toMatchObject({ code: '23514' })
    }
  })
  it('requires the matching numbering rule, business purpose, and scoped issuance', async () => {
    await expect(client.query("UPDATE container_batches SET container_batch_no='FORGED' WHERE id=$1", [batch]))
      .rejects.toMatchObject({ code: '23514', constraint: 'ocean_freight_numbering_identity_check' })
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
