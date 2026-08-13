import { randomUUID } from 'node:crypto'

import { Client } from 'pg'

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
  constraint: string | undefined,
  expectedCode: '22P02' | '23505' | '23514',
  savepointIndex: number,
): Promise<void> {
  const savepoint = `expected_product_rejection_${savepointIndex}`
  await client.query(`SAVEPOINT ${savepoint}`)
  try {
    await action()
  }
  catch (error) {
    const databaseError = readDatabaseError(error)
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await client.query(`RELEASE SAVEPOINT ${savepoint}`)
    expect(databaseError.code).toBe(expectedCode)
    if (constraint !== undefined) {
      expect(databaseError.constraint).toBe(constraint)
    }
    return
  }

  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
  await client.query(`RELEASE SAVEPOINT ${savepoint}`)
  throw new Error(`Expected database constraint ${constraint ?? expectedCode} to reject input`)
}

describe('Product schema constraints with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: requireDatabaseUrl() })
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  it('enforces status, money, attributes, active supplier and immutable identity', async () => {
    await client.query('BEGIN')
    try {
      const productNo = `PRODUCT-SCHEMA-${randomUUID()}`
      const inserted = await client.query<{ id: string }>(`
        INSERT INTO "products" ("name", "product_no")
        VALUES ('Schema E2E Product', $1)
        RETURNING "id"
      `, [productNo])
      const productId = inserted.rows[0]?.id
      if (productId === undefined) throw new Error('Expected inserted Product id')

      const cases: ReadonlyArray<{
        readonly action: () => Promise<unknown>
        readonly code: '22P02' | '23505' | '23514'
        readonly constraint?: string
      }> = [
        {
          action: () => client.query(`
            INSERT INTO "products" ("name", "product_no", "status")
            VALUES ('Invalid Status', $1, 'ARCHIVED')
          `, [`PRODUCT-SCHEMA-${randomUUID()}`]),
          code: '22P02',
        },
        {
          action: () => client.query(`
            INSERT INTO "products" ("name", "product_no", "status")
            VALUES ('Active Without Supplier', $1, 'ACTIVE')
          `, [`PRODUCT-SCHEMA-${randomUUID()}`]),
          code: '23514',
          constraint: 'products_active_supplier_required_check',
        },
        {
          action: () => client.query(`
            INSERT INTO "products" ("name", "product_no", "twd_sale_price_amount")
            VALUES ('Negative TWD', $1, -0.0001)
          `, [`PRODUCT-SCHEMA-${randomUUID()}`]),
          code: '23514',
          constraint: 'products_twd_sale_price_amount_nonnegative_check',
        },
        {
          action: () => client.query(`
            INSERT INTO "products" ("name", "product_no", "myr_sale_price_amount")
            VALUES ('Negative MYR', $1, -1)
          `, [`PRODUCT-SCHEMA-${randomUUID()}`]),
          code: '23514',
          constraint: 'products_myr_sale_price_amount_nonnegative_check',
        },
        {
          action: () => client.query(`
            INSERT INTO "products" ("name", "product_no", "purchase_cost_amount")
            VALUES ('Negative Cost', $1, -1)
          `, [`PRODUCT-SCHEMA-${randomUUID()}`]),
          code: '23514',
          constraint: 'products_purchase_cost_amount_nonnegative_check',
        },
        {
          action: () => client.query(`
            INSERT INTO "products" ("name", "product_no", "twd_sale_price_currency")
            VALUES ('Wrong TWD', $1, 'USD')
          `, [`PRODUCT-SCHEMA-${randomUUID()}`]),
          code: '23514',
          constraint: 'products_twd_currency_check',
        },
        {
          action: () => client.query(`
            INSERT INTO "products" ("name", "product_no", "myr_sale_price_currency")
            VALUES ('Wrong MYR', $1, 'USD')
          `, [`PRODUCT-SCHEMA-${randomUUID()}`]),
          code: '23514',
          constraint: 'products_myr_currency_check',
        },
        {
          action: () => client.query(`
            INSERT INTO "products" ("name", "product_no", "purchase_cost_currency")
            VALUES ('Wrong Cost Currency', $1, 'cnY')
          `, [`PRODUCT-SCHEMA-${randomUUID()}`]),
          code: '23514',
          constraint: 'products_purchase_currency_format_check',
        },
        {
          action: () => client.query(`
            INSERT INTO "products" ("name", "product_no", "attributes")
            VALUES ('Wrong Attributes', $1, '{"title":"颜色"}'::jsonb)
          `, [`PRODUCT-SCHEMA-${randomUUID()}`]),
          code: '23514',
          constraint: 'products_attributes_array_check',
        },
        {
          action: () => client.query(`
            INSERT INTO "products" ("name", "product_no")
            VALUES ('Duplicate Number', $1)
          `, [productNo]),
          code: '23505',
          constraint: 'products_product_no_key',
        },
        {
          action: () => client.query(`
            UPDATE "products" SET "product_no" = $1 WHERE "id" = $2::uuid
          `, [`PRODUCT-SCHEMA-${randomUUID()}`, productId]),
          code: '23514',
          constraint: 'products_identity_immutable_check',
        },
        {
          action: () => client.query(`
            UPDATE "products" SET "id" = $1::uuid WHERE "id" = $2::uuid
          `, [randomUUID(), productId]),
          code: '23514',
          constraint: 'products_identity_immutable_check',
        },
      ]

      for (const [index, testCase] of cases.entries()) {
        await expectConstraintRejection(
          client,
          testCase.action,
          testCase.constraint,
          testCase.code,
          index,
        )
      }

      const persisted = await client.query<{
        id: string
        productNo: string
        status: string
      }>(`
        SELECT "id", "product_no" AS "productNo", "status"::text AS "status"
        FROM "products"
        WHERE "id" = $1::uuid
      `, [productId])
      expect(persisted.rows).toEqual([{
        id: productId,
        productNo,
        status: 'DRAFT',
      }])
    }
    finally {
      await client.query('ROLLBACK')
    }
  })
})
