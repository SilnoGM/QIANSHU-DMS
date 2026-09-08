import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001'
const REVIEW_PERMISSION_ID = '00000000-0000-4000-8000-000000000165'
const migrationPaths = [
  resolve(__dirname, '../prisma/migrations/20260907053824_purchase_order_review/migration.sql'),
  resolve(__dirname, '../prisma/migrations/20260907053825_purchase_order_review_default_and_permission/migration.sql'),
]

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for E2E tests')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username !== 'qianshu_ci' || url.pathname !== '/qianshu_ci') {
    throw new Error('Purchase review migration requires the isolated CI database')
  }
  return value
}

async function createLegacyTables(client: Client): Promise<void> {
  // 本测试只建立审核迁移需要的旧结构，并保留历史、审计和角色关系作为不变性证据。
  await client.query(`
    CREATE TYPE purchase_order_status AS ENUM ('CONFIRMED', 'COMPLETED', 'CANCELLED');
    CREATE TABLE purchase_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_status purchase_order_status NOT NULL DEFAULT 'CONFIRMED',
      fulfillment_status TEXT NOT NULL DEFAULT 'ORDERED',
      payment_status TEXT NOT NULL DEFAULT 'UNPAID',
      version INTEGER NOT NULL DEFAULT 1,
      shipping_mark_text TEXT
    );
    CREATE TABLE purchase_order_status_history (id UUID PRIMARY KEY, from_status TEXT, to_status TEXT);
    CREATE TABLE audit_events (id UUID PRIMARY KEY, metadata JSONB NOT NULL);
    CREATE TABLE roles (id UUID PRIMARY KEY, code TEXT UNIQUE NOT NULL);
    CREATE TABLE permissions (
      id UUID PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL, system_only BOOLEAN NOT NULL
    );
    CREATE TABLE role_permissions (
      role_id UUID REFERENCES roles(id), permission_id UUID REFERENCES permissions(id),
      PRIMARY KEY (role_id, permission_id)
    );
    INSERT INTO purchase_orders (order_status, fulfillment_status, payment_status, version, shipping_mark_text)
    VALUES ('CONFIRMED', 'ORDERED', 'UNPAID', 1, 'LEGACY-1'),
      ('CONFIRMED', 'PREPARING', 'PARTIALLY_PAID', 3, 'LEGACY-2'),
      ('COMPLETED', 'SIGNED', 'PAID', 8, 'LEGACY-3'),
      ('CANCELLED', 'ORDERED', 'UNPAID', 2, 'LEGACY-4');
    INSERT INTO purchase_order_status_history VALUES (gen_random_uuid(), 'CONFIRMED', 'CANCELLED');
    INSERT INTO audit_events VALUES (gen_random_uuid(), '{"historical":true}');
    INSERT INTO permissions VALUES (
      '00000000-0000-4000-8000-000000000162', 'purchase-orders:update', '更新采购订单', '旧权限', false
    );
  `)
  await client.query('INSERT INTO roles (id, code) VALUES ($1, $2), ($3, $4)',
    [ADMIN_ROLE_ID, 'system_admin', randomUUID(), 'purchase_operator'])
  await client.query(`INSERT INTO role_permissions
    SELECT id, '00000000-0000-4000-8000-000000000162'::uuid FROM roles`)
}

async function withIsolatedSchema(action: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: requireDatabaseUrl() })
  const schemaName = `purchase_review_${randomUUID().replaceAll('-', '')}`
  if (!/^purchase_review_[a-f0-9]{32}$/u.test(schemaName)) {
    throw new Error('Purchase review schema name is invalid')
  }
  const quotedSchema = `"${schemaName}"`
  await client.connect()
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`)
    await client.query(`SET search_path TO ${quotedSchema}, public`)
    await createLegacyTables(client)
    await action(client)
  }
  finally {
    await client.query('ROLLBACK')
    await client.query('RESET search_path')
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
    await client.end()
  }
}

describe('purchase review migration with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('preserves every legacy order and grant while defaulting new purchases to review', async () => {
    await withIsolatedSchema(async client => {
      const before = await client.query('SELECT * FROM purchase_orders ORDER BY id')
      const historyBefore = await client.query('SELECT * FROM purchase_order_status_history ORDER BY id')
      const auditBefore = await client.query('SELECT * FROM audit_events ORDER BY id')
      const grantsBefore = await client.query('SELECT * FROM role_permissions ORDER BY role_id, permission_id')

      // 两份迁移分别执行，新增 PostgreSQL enum value 在后续默认值引用前已提交。
      for (const migrationPath of migrationPaths) {
        await client.query(readFileSync(migrationPath, 'utf8'))
      }

      expect((await client.query('SELECT * FROM purchase_orders ORDER BY id')).rows).toEqual(before.rows)
      expect((await client.query('SELECT * FROM purchase_order_status_history ORDER BY id')).rows).toEqual(historyBefore.rows)
      expect((await client.query('SELECT * FROM audit_events ORDER BY id')).rows).toEqual(auditBefore.rows)
      const oldGrants = await client.query('SELECT * FROM role_permissions WHERE permission_id <> $1 ORDER BY role_id, permission_id', [REVIEW_PERMISSION_ID])
      expect(oldGrants.rows).toEqual(grantsBefore.rows)

      const created = await client.query<{ order_status: string, fulfillment_status: string }>(
        'INSERT INTO purchase_orders DEFAULT VALUES RETURNING order_status, fulfillment_status',
      )
      expect(created.rows).toEqual([{ order_status: 'PENDING_REVIEW', fulfillment_status: 'ORDERED' }])
      const reviewPermission = await client.query<{ code: string, system_only: boolean }>(
        'SELECT code, system_only FROM permissions WHERE id = $1', [REVIEW_PERMISSION_ID],
      )
      expect(reviewPermission.rows).toEqual([{ code: 'purchase-orders:review', system_only: false }])
      const reviewGrants = await client.query<{ role_id: string }>(
        'SELECT role_id FROM role_permissions WHERE permission_id = $1', [REVIEW_PERMISSION_ID],
      )
      expect(reviewGrants.rows).toEqual([{ role_id: ADMIN_ROLE_ID }])
    })
  })
})
