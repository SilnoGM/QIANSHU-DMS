import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const migrationsRoot = resolve(__dirname, '../prisma/migrations')
const HASH = Buffer.alloc(32, 0x11)
const FINGERPRINT = Buffer.alloc(32, 0x22)
const MARK_TEXT = 'MARK-001'

function migrationSql(): string {
  const directories = readdirSync(migrationsRoot)
    .filter(name => name.endsWith('_purchase_order_shipping_mark_issuance'))
  if (directories.length !== 1) throw new Error('Expected one shipping mark migration')
  return readFileSync(resolve(migrationsRoot, directories[0], 'migration.sql'), 'utf8')
}

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for E2E tests')
  const url = new URL(value)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username !== 'qianshu_ci'
    || url.pathname !== '/qianshu_ci'
  ) throw new Error('Shipping mark migration requires the isolated CI database')
  return value
}

interface IssuanceInput {
  purpose?: string
  consumerCode?: string
  generatedNumber?: string
  idempotencyKeyHash?: Buffer
  requestFingerprintHash?: Buffer
}

async function insertIssuance(client: Client, input: IssuanceInput = {}): Promise<string> {
  const ruleId = randomUUID()
  const issuanceId = randomUUID()
  await client.query(`
    INSERT INTO numbering_rules (id, purpose) VALUES ($1, $2)
  `, [ruleId, input.purpose ?? 'SHIPPING_MARK'])
  await client.query(`
    INSERT INTO numbering_issuances (
      id, rule_id, generated_number, consumer_code,
      idempotency_key_hash, request_fingerprint_hash
    ) VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    issuanceId, ruleId, input.generatedNumber ?? MARK_TEXT,
    input.consumerCode ?? 'PURCHASE_ORDER.SHIPPING_MARK',
    input.idempotencyKeyHash ?? HASH, input.requestFingerprintHash ?? FINGERPRINT,
  ])
  return issuanceId
}

async function insertOrder(client: Client, input: {
  issuanceId?: string | null
  text?: string | null
  hash?: Buffer
  fingerprint?: Buffer
} = {}): Promise<string> {
  const id = randomUUID()
  await client.query(`
    INSERT INTO purchase_orders (
      id, shipping_mark_issuance_id, shipping_mark_text,
      create_idempotency_key_hash, create_request_fingerprint_hash
    ) VALUES ($1, $2, $3, $4, $5)
  `, [
    id, input.issuanceId ?? null, input.text === undefined ? MARK_TEXT : input.text,
    input.hash ?? HASH, input.fingerprint ?? FINGERPRINT,
  ])
  return id
}

async function createLegacyTables(client: Client): Promise<void> {
  // 专用迁移夹具只保留迁移依赖的旧列；编号历史表同时保留内容快照，以检测意外回填或发号。
  await client.query(`
    CREATE TABLE numbering_rules (id UUID PRIMARY KEY, purpose TEXT NOT NULL);
    CREATE TABLE numbering_rule_versions (id UUID PRIMARY KEY, revision INTEGER NOT NULL);
    CREATE TABLE numbering_period_states (id UUID PRIMARY KEY, used_count BIGINT NOT NULL);
    CREATE TABLE numbering_issuances (
      id UUID PRIMARY KEY, rule_id UUID NOT NULL REFERENCES numbering_rules(id),
      generated_number VARCHAR(64) NOT NULL, consumer_code VARCHAR(64) NOT NULL,
      idempotency_key_hash BYTEA NOT NULL, request_fingerprint_hash BYTEA NOT NULL
    );
    CREATE TABLE purchase_orders (
      id UUID PRIMARY KEY, shipping_mark_text VARCHAR(2000),
      create_idempotency_key_hash BYTEA NOT NULL,
      create_request_fingerprint_hash BYTEA NOT NULL,
      remark TEXT, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE purchase_order_lines (id UUID PRIMARY KEY, quantity INTEGER NOT NULL);
    CREATE TABLE audit_events (id UUID PRIMARY KEY, metadata JSONB NOT NULL);
    INSERT INTO numbering_rule_versions VALUES (gen_random_uuid(), 3);
    INSERT INTO numbering_period_states VALUES (gen_random_uuid(), 7);
    INSERT INTO purchase_order_lines VALUES (gen_random_uuid(), 5);
    INSERT INTO audit_events VALUES (gen_random_uuid(), '{"legacy":true}');
  `)
  await client.query(`
    INSERT INTO purchase_orders (
      id, shipping_mark_text, create_idempotency_key_hash, create_request_fingerprint_hash
    ) VALUES
      (gen_random_uuid(), 'Historical handwritten mark', $1, $2),
      (gen_random_uuid(), NULL, $1, $2);
  `, [HASH, FINGERPRINT])
  await insertIssuance(client)
}

async function withIsolatedSchema(
  action: (client: Client) => Promise<void>,
  migrate = true,
): Promise<void> {
  const client = new Client({ connectionString: requireDatabaseUrl() })
  const name = `purchase_mark_migration_${randomUUID().replaceAll('-', '')}`
  if (!/^purchase_mark_migration_[a-f0-9]{32}$/u.test(name)) {
    throw new Error('Shipping mark migration schema name is invalid')
  }
  const quotedSchema = `"${name}"`
  await client.connect()
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`)
    await client.query(`SET search_path TO ${quotedSchema}, public`)
    await createLegacyTables(client)
    if (migrate) await client.query(migrationSql())
    await action(client)
  }
  finally {
    await client.query('ROLLBACK')
    await client.query('RESET search_path')
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
    await client.end()
  }
}

async function snapshot(client: Client): Promise<unknown[]> {
  const result: unknown[] = []
  for (const table of [
    'purchase_orders', 'purchase_order_lines', 'audit_events', 'numbering_rules',
    'numbering_rule_versions', 'numbering_period_states', 'numbering_issuances',
  ]) {
    const rows = await client.query(`
      SELECT to_jsonb(fact) - 'shipping_mark_issuance_id' AS fact
      FROM "${table}" fact ORDER BY id
    `)
    result.push(rows.rows)
  }
  return result
}

describe('purchase shipping mark issuance migration with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('preserves every historical purchase, line, audit and numbering fact without backfill', async () => {
    await withIsolatedSchema(async (client) => {
      const before = await snapshot(client)
      await client.query(migrationSql())
      expect(await snapshot(client)).toEqual(before)
      const links = await client.query('SELECT shipping_mark_issuance_id FROM purchase_orders')
      expect(links.rows).toEqual([
        { shipping_mark_issuance_id: null }, { shipping_mark_issuance_id: null },
      ])
    }, false)
  })

  it('rejects a new purchase without an issuance', async () => {
    await withIsolatedSchema(async (client) => {
      await expect(insertOrder(client)).rejects.toMatchObject({
        code: '23514', constraint: 'purchase_orders_shipping_mark_required_check',
      })
    })
  })

  it('rejects an unknown issuance', async () => {
    await withIsolatedSchema(async (client) => {
      await expect(insertOrder(client, { issuanceId: randomUUID() }))
        .rejects.toMatchObject({
          code: '23514', constraint: 'purchase_orders_shipping_mark_issuance_check',
        })
    })
  })

  it.each([
    ['wrong purpose', { purpose: 'BUSINESS_NO' }],
    ['wrong consumer', { consumerCode: 'PURCHASE_ORDER.CREATE' }],
    ['different idempotency hash', { idempotencyKeyHash: randomBytes(32) }],
    ['different fingerprint', { requestFingerprintHash: randomBytes(32) }],
    ['different text', { generatedNumber: 'OTHER-001' }],
  ] as const)('rejects an issuance with %s', async (_label, input) => {
    await withIsolatedSchema(async (client) => {
      const issuanceId = await insertIssuance(client, input)
      await expect(insertOrder(client, { issuanceId })).rejects.toMatchObject({
        code: '23514', constraint: 'purchase_orders_shipping_mark_issuance_check',
      })
    })
  })

  it('rejects null text even when an issuance is present', async () => {
    await withIsolatedSchema(async (client) => {
      const issuanceId = await insertIssuance(client)
      await expect(insertOrder(client, { issuanceId, text: null })).rejects.toMatchObject({
        code: '23514', constraint: 'purchase_orders_shipping_mark_issuance_check',
      })
    })
  })

  it('allows a matching association once and keeps the foreign key restrictive', async () => {
    await withIsolatedSchema(async (client) => {
      const issuanceId = await insertIssuance(client)
      await insertOrder(client, { issuanceId })
      await expect(insertOrder(client, { issuanceId })).rejects.toMatchObject({
        code: '23505', constraint: 'purchase_orders_shipping_mark_issuance_id_key',
      })
      await expect(client.query('DELETE FROM numbering_issuances WHERE id = $1', [issuanceId]))
        .rejects.toMatchObject({ code: '23503' })
      await expect(client.query('UPDATE numbering_issuances SET id = $1 WHERE id = $2', [
        randomUUID(), issuanceId,
      ])).rejects.toMatchObject({ code: '23503' })
    })
  })

  it('allows the same text from different rule issuances', async () => {
    await withIsolatedSchema(async (client) => {
      for (const hash of [HASH, randomBytes(32)]) {
        const issuanceId = await insertIssuance(client, { idempotencyKeyHash: hash })
        await insertOrder(client, { issuanceId, hash })
      }
      const count = await client.query('SELECT count(*) FROM purchase_orders WHERE shipping_mark_text = $1', [MARK_TEXT])
      expect(count.rows).toEqual([{ count: '2' }])
    })
  })

  it('keeps historical text and null association immutable while allowing unrelated updates', async () => {
    await withIsolatedSchema(async (client) => {
      await client.query('UPDATE purchase_orders SET remark = $1, version = version + 1', ['updated'])
      await expect(client.query('UPDATE purchase_orders SET shipping_mark_text = $1', ['changed']))
        .rejects.toMatchObject({
          code: '23514', constraint: 'purchase_orders_shipping_mark_immutable_check',
        })
      const issuanceId = await insertIssuance(client)
      await expect(client.query('UPDATE purchase_orders SET shipping_mark_issuance_id = $1', [issuanceId]))
        .rejects.toMatchObject({
          code: '23514', constraint: 'purchase_orders_shipping_mark_immutable_check',
        })
    })
  })

  it('keeps new text and association immutable and prevents request hash drift', async () => {
    await withIsolatedSchema(async (client) => {
      const issuanceId = await insertIssuance(client)
      const orderId = await insertOrder(client, { issuanceId })
      await client.query('UPDATE purchase_orders SET remark = $1 WHERE id = $2', ['updated', orderId])
      for (const assignment of ['shipping_mark_text = NULL', 'shipping_mark_issuance_id = NULL']) {
        await expect(client.query(`UPDATE purchase_orders SET ${assignment} WHERE id = $1`, [orderId]))
          .rejects.toMatchObject({
            code: '23514', constraint: 'purchase_orders_shipping_mark_immutable_check',
          })
      }
      await expect(client.query('UPDATE purchase_orders SET create_request_fingerprint_hash = $1 WHERE id = $2', [
        randomBytes(32), orderId,
      ])).rejects.toMatchObject({
        code: '23514', constraint: 'purchase_orders_shipping_mark_issuance_check',
      })
    })
  })
})
