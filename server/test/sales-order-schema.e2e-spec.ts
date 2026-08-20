import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const serverRoot = resolve(__dirname, '..')
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260820120000_sales_order_domain/migration.sql',
)

const SALES_ORDER_TABLES = [
  'sales_order_amount_revisions',
  'sales_order_documents',
  'sales_order_lines',
  'sales_order_payments',
  'sales_order_status_history',
  'sales_orders',
] as const

const SALES_ORDER_PERMISSION_CODES = [
  'sales-orders:create',
  'sales-orders:document',
  'sales-orders:payment',
  'sales-orders:read',
  'sales-orders:update',
] as const

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for E2E tests')
  return value
}

function readDatabaseError(error: unknown): {
  readonly code?: unknown
  readonly constraint?: unknown
} {
  if (typeof error !== 'object' || error === null) return {}
  return {
    code: Reflect.get(error, 'code'),
    constraint: Reflect.get(error, 'constraint'),
  }
}

async function expectConstraintRejection(
  client: Client,
  action: () => Promise<unknown>,
  constraint: string,
  savepointIndex: number,
): Promise<void> {
  const savepoint = `expected_sales_order_rejection_${savepointIndex}`
  await client.query(`SAVEPOINT ${savepoint}`)
  try {
    await action()
  }
  catch (error) {
    const databaseError = readDatabaseError(error)
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await client.query(`RELEASE SAVEPOINT ${savepoint}`)
    expect(databaseError.code).toBe('23514')
    expect(databaseError.constraint).toBe(constraint)
    return
  }

  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
  await client.query(`RELEASE SAVEPOINT ${savepoint}`)
  throw new Error(`Expected database constraint ${constraint} to reject input`)
}

describe('sales order schema with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: requireDatabaseUrl() })
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  it('tracks the complete append-only migration and permission contract', async () => {
    const migration = readFileSync(migrationPath, 'utf8')
    for (const table of SALES_ORDER_TABLES) {
      expect(migration).toContain(`CREATE TABLE "${table}"`)
    }
    for (const permission of SALES_ORDER_PERMISSION_CODES) {
      expect(migration).toContain(`'${permission}'`)
    }
    expect(migration).toContain('FROM "sales_order_documents" AS reference')

    const tables = await client.query<{ tableName: string }>(`
      SELECT "table_name" AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND "table_name" = ANY($1::text[])
      ORDER BY "table_name"
    `, [SALES_ORDER_TABLES])
    expect(tables.rows.map(row => row.tableName)).toEqual(SALES_ORDER_TABLES)

    const permissions = await client.query<{ code: string }>(`
      SELECT "code"
      FROM "permissions"
      WHERE "code" = ANY($1::text[])
      ORDER BY "code"
    `, [SALES_ORDER_PERMISSION_CODES])
    expect(permissions.rows.map(row => row.code)).toEqual(
      SALES_ORDER_PERMISSION_CODES,
    )
  })

  it('enforces order, line, payment and address invariants', async () => {
    const userId = randomUUID()
    const countryId = randomUUID()
    const provinceId = randomUUID()
    const cityId = randomUUID()
    const salesOrderId = randomUUID()

    await client.query('BEGIN')
    try {
      await client.query(`
        INSERT INTO "users" (
          "id", "username", "username_normalized", "display_name",
          "password_hash", "password_changed_at", "updated_at"
        )
        VALUES (
          $1, $2, $2, '销售订单测试用户', 'hash',
          clock_timestamp(), clock_timestamp()
        )
      `, [userId, `sales-order-${randomUUID()}`])
      await client.query(`
        INSERT INTO "regions" (
          "id", "code", "name", "normalized_name",
          "administrative_type", "level", "parent_id"
        )
        VALUES
          ($1, $4, $7, $7, 'COUNTRY', 'COUNTRY_REGION', NULL),
          ($2, $5, $8, $8, 'PROVINCE', 'PROVINCE_STATE', $1),
          ($3, $6, $9, $9, 'CITY', 'CITY', $2)
      `, [
        countryId,
        provinceId,
        cityId,
        `C-${randomUUID().toUpperCase()}`,
        `P-${randomUUID().toUpperCase()}`,
        `CITY-${randomUUID().toUpperCase()}`,
        `测试国家-${randomUUID()}`,
        `测试省州-${randomUUID()}`,
        `测试城市-${randomUUID()}`,
      ])

      await client.query(`
        INSERT INTO "sales_orders" (
          "id", "order_no", "create_idempotency_key_hash",
          "create_request_fingerprint_hash", "order_date", "issuer_user_id",
          "currency_code", "customer_name", "customer_phone",
          "customer_country_region_id", "customer_province_state_id",
          "customer_city_id", "customer_country_region_code_snapshot",
          "customer_province_state_code_snapshot", "customer_city_code_snapshot",
          "customer_country_region_name_snapshot",
          "customer_province_state_name_snapshot", "customer_city_name_snapshot",
          "customer_address_detail", "customer_full_address_snapshot",
          "line_subtotal_amount", "agreed_total_amount",
          "deposit_due_amount", "balance_due_amount"
        )
        VALUES (
          $1, $2, $3, $4, CURRENT_DATE, $5,
          'TWD', '测试客户', '0912345678',
          $6, $7, $8, 'TW', 'TW-TPE', 'TW-KHH',
          '中国台湾', '台湾', '高雄市',
          '苓雅区中正一路100号3楼',
          '中国台湾台湾高雄市苓雅区中正一路100号3楼',
          1000, 1000, 300, 700
        )
      `, [
        salesOrderId,
        `SO-${randomUUID()}`,
        randomBytes(32),
        randomBytes(32),
        userId,
        countryId,
        provinceId,
        cityId,
      ])
      await client.query(`
        INSERT INTO "sales_order_lines" (
          "sales_order_id", "line_number", "line_type",
          "product_name_snapshot", "quantity", "actual_unit_price_amount",
          "line_total_amount"
        )
        VALUES ($1, 1, 'CUSTOM', '临时产品', 2, 500, 1000)
      `, [salesOrderId])

      await expectConstraintRejection(
        client,
        () => client.query(`
          UPDATE "sales_orders"
          SET "agreed_total_amount" = 999
          WHERE "id" = $1
        `, [salesOrderId]),
        'sales_orders_agreed_total_matches_lines_check',
        1,
      )
      await expectConstraintRejection(
        client,
        () => client.query(`
          UPDATE "sales_orders"
          SET "deposit_due_amount" = 301
          WHERE "id" = $1
        `, [salesOrderId]),
        'sales_orders_payment_terms_sum_check',
        2,
      )
      await expectConstraintRejection(
        client,
        () => client.query(`
          UPDATE "sales_orders"
          SET "customer_address_detail" = '苓雅区 中正一路100号'
          WHERE "id" = $1
        `, [salesOrderId]),
        'sales_orders_address_no_whitespace_check',
        3,
      )
      await expectConstraintRejection(
        client,
        () => client.query(`
          INSERT INTO "sales_order_lines" (
            "sales_order_id", "line_number", "line_type",
            "product_name_snapshot", "quantity", "actual_unit_price_amount",
            "line_total_amount"
          )
          VALUES ($1, 2, 'CUSTOM', '错误数量', 0, 1, 0)
        `, [salesOrderId]),
        'sales_order_lines_quantity_positive_check',
        4,
      )
      await expectConstraintRejection(
        client,
        () => client.query(`
          INSERT INTO "sales_order_lines" (
            "sales_order_id", "line_number", "line_type",
            "product_name_snapshot", "quantity", "actual_unit_price_amount",
            "line_total_amount"
          )
          VALUES ($1, 2, 'CUSTOM', '错误金额', 2, 10, 19)
        `, [salesOrderId]),
        'sales_order_lines_total_check',
        5,
      )
      await expectConstraintRejection(
        client,
        () => client.query(`
          INSERT INTO "sales_order_payments" (
            "sales_order_id", "payment_type", "amount", "received_at",
            "created_by_user_id"
          )
          VALUES ($1, 'DEPOSIT', 0, clock_timestamp(), $2)
        `, [salesOrderId, userId]),
        'sales_order_payments_amount_positive_check',
        6,
      )
    }
    finally {
      await client.query('ROLLBACK')
    }
  })
})
