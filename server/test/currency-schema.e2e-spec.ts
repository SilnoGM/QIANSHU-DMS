import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const serverRoot = resolve(__dirname, '..')
const authMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260717090000_user_auth_rbac/migration.sql',
)
const currencyMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260729090000_currency_exchange_rate_schema_and_permissions/migration.sql',
)
const currencySeedMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260729100000_currency_seed/migration.sql',
)
const SYSTEM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001'
const CNY_CURRENCY_ID = '00000000-0000-4000-8000-000000001001'
const CURRENCY_PERMISSION_CODES = [
  'currencies:create',
  'currencies:disable',
  'currencies:enable',
  'currencies:read',
  'currencies:update',
  'exchange-rates:create',
  'exchange-rates:read',
  'exchange-rates:update',
] as const

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }
  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^currency_schema_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Currency Schema E2E schema name is invalid')
  }
  return `"${identifier}"`
}

function readDatabaseError(error: unknown): {
  code?: unknown
  constraint?: unknown
} {
  if (typeof error !== 'object' || error === null) {
    return {}
  }

  return {
    code: Reflect.get(error, 'code'),
    constraint: Reflect.get(error, 'constraint'),
  }
}

async function expectConstraintRejection(
  client: Client,
  action: () => Promise<unknown>,
  constraint: string,
  expectedCode: '23505' | '23514',
  savepointIndex: number,
): Promise<void> {
  const savepoint = `expected_currency_rejection_${savepointIndex}`
  await client.query(`SAVEPOINT ${savepoint}`)

  try {
    await action()
  }
  catch (error) {
    const databaseError = readDatabaseError(error)
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await client.query(`RELEASE SAVEPOINT ${savepoint}`)
    expect(databaseError.code).toBe(expectedCode)
    expect(databaseError.constraint).toBe(constraint)
    return
  }

  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
  await client.query(`RELEASE SAVEPOINT ${savepoint}`)
  throw new Error(`Expected database constraint ${constraint} to reject input`)
}

describe('currency schema migration replay against PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('seeds the fixed catalog and enforces activation/current-rate invariants', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `currency_schema_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    const foreignCurrencyId = randomUUID()
    let schemaCreated = false

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      schemaCreated = true
      await client.query(`SET search_path TO ${quotedSchema}, public`)
      await client.query(readFileSync(authMigrationPath, 'utf8'))
      await client.query(readFileSync(currencyMigrationPath, 'utf8'))
      await client.query(readFileSync(currencySeedMigrationPath, 'utf8'))

      const seededCurrencies = await client.query<{
        code: string
        enabled: boolean
        minorUnit: number
        sortOrder: number
      }>(
        `
          SELECT
            "code",
            "enabled",
            "minor_unit" AS "minorUnit",
            "sort_order" AS "sortOrder"
          FROM "currencies"
          ORDER BY "sort_order", "code"
        `,
      )
      expect(seededCurrencies.rows).toEqual([
        { code: 'CNY', enabled: true, minorUnit: 2, sortOrder: 10 },
        { code: 'TWD', enabled: false, minorUnit: 2, sortOrder: 20 },
        { code: 'MYR', enabled: false, minorUnit: 2, sortOrder: 30 },
        { code: 'USD', enabled: false, minorUnit: 2, sortOrder: 40 },
      ])
      await expect(
        client.query<{ count: number }>(
          'SELECT count(*)::integer AS "count" FROM "exchange_rates"',
        ),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] })

      const permissionCatalog = await client.query<{ code: string }>(
        `
          SELECT "code"
          FROM "permissions"
          WHERE "code" LIKE 'currencies:%'
             OR "code" LIKE 'exchange-rates:%'
          ORDER BY "code"
        `,
      )
      expect(permissionCatalog.rows.map(row => row.code)).toEqual(
        CURRENCY_PERMISSION_CODES,
      )
      await expect(
        client.query<{ count: number }>(
          `
            SELECT count(*)::integer AS "count"
            FROM "role_permissions" AS grant_row
            JOIN "permissions" AS permission
              ON permission."id" = grant_row."permission_id"
            WHERE grant_row."role_id" = $1
              AND permission."code" = ANY($2::text[])
          `,
          [SYSTEM_ADMIN_ROLE_ID, CURRENCY_PERMISSION_CODES],
        ),
      ).resolves.toMatchObject({ rows: [{ count: 8 }] })

      const auditTypes = await client.query<{ value: string }>(
        `
          SELECT enum_value::text AS "value"
          FROM unnest(enum_range(NULL::"audit_event_type")) AS enum_value
          WHERE enum_value::text LIKE 'CURRENCY_%'
             OR enum_value::text LIKE 'EXCHANGE_RATE_%'
          ORDER BY enum_value::text
        `,
      )
      expect(auditTypes.rows.map(row => row.value)).toEqual([
        'CURRENCY_CREATED',
        'CURRENCY_DISABLED',
        'CURRENCY_ENABLED',
        'CURRENCY_UPDATED',
        'EXCHANGE_RATE_CREATED',
        'EXCHANGE_RATE_UPDATED',
      ])

      await client.query('BEGIN')
      await client.query(
        `
          INSERT INTO "currencies" (
            "id",
            "code",
            "name",
            "minor_unit",
            "enabled",
            "sort_order"
          )
          VALUES ($1, 'EUR', '欧元', 2, false, 50)
        `,
        [foreignCurrencyId],
      )

      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "currencies" SET "enabled" = true WHERE "id" = $1',
          [foreignCurrencyId],
        ),
        'currencies_exchange_rate_required_check',
        '23514',
        1,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "exchange_rates" (
              "currency_id",
              "foreign_units_per_cny"
            )
            VALUES ($1, 0)
          `,
          [foreignCurrencyId],
        ),
        'exchange_rates_positive_check',
        '23514',
        2,
      )

      await client.query(
        `
          INSERT INTO "exchange_rates" (
            "currency_id",
            "foreign_units_per_cny"
          )
          VALUES ($1, 7.250000000000)
        `,
        [foreignCurrencyId],
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "exchange_rates" (
              "currency_id",
              "foreign_units_per_cny"
            )
            VALUES ($1, 7.3)
          `,
          [foreignCurrencyId],
        ),
        'exchange_rates_currency_id_key',
        '23505',
        3,
      )

      await client.query(
        'UPDATE "currencies" SET "enabled" = true WHERE "id" = $1',
        [foreignCurrencyId],
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'DELETE FROM "exchange_rates" WHERE "currency_id" = $1',
          [foreignCurrencyId],
        ),
        'exchange_rates_enabled_currency_guard_check',
        '23514',
        4,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "currencies" SET "minor_unit" = 3 WHERE "id" = $1',
          [foreignCurrencyId],
        ),
        'currencies_identity_immutable_check',
        '23514',
        5,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "currencies" SET "enabled" = false WHERE "id" = $1',
          [CNY_CURRENCY_ID],
        ),
        'currencies_cny_shape_check',
        '23514',
        6,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "exchange_rates" (
              "currency_id",
              "foreign_units_per_cny"
            )
            VALUES ($1, 1)
          `,
          [CNY_CURRENCY_ID],
        ),
        'exchange_rates_currency_not_cny_check',
        '23514',
        7,
      )

      await client.query('ROLLBACK')
    }
    finally {
      if (schemaCreated) {
        await client.query('RESET search_path')
        await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`)
      }
      await client.end()
    }
  })
})
