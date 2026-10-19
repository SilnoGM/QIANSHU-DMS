import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { MANAGEMENT_PERMISSION_CODES } from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260729090000_currency_exchange_rate_schema_and_permissions/migration.sql',
)
const seedMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260729100000_currency_seed/migration.sql',
)
const CNY_CURRENCY_ID = '00000000-0000-4000-8000-000000001001'

function readSchema(): string {
  return readFileSync(schemaPath, 'utf8')
}

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8')
}

function readSeedMigration(): string {
  return readFileSync(seedMigrationPath, 'utf8')
}

function extractModel(schema: string, modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`),
  )

  if (!match?.[1]) {
    throw new Error(`Missing Prisma model ${modelName}`)
  }

  return match[1]
}

describe('currency and current exchange-rate database schema', () => {
  it('defines the confirmed Currency and one-current-rate Prisma models', () => {
    const schema = readSchema()
    const currency = extractModel(schema, 'Currency')
    const exchangeRate = extractModel(schema, 'ExchangeRate')

    for (const field of [
      'id',
      'code',
      'name',
      'englishName',
      'symbol',
      'minorUnit',
      'enabled',
      'sortOrder',
      'version',
      'createdAt',
      'updatedAt',
      'exchangeRate',
    ]) {
      expect(currency).toMatch(new RegExp(`\\n\\s*${field}\\s`, 'u'))
    }
    expect(currency).toContain('@unique(map: "currencies_code_key")')
    expect(currency).toContain('@map("minor_unit") @db.SmallInt')
    expect(currency).toContain(
      '@@index([enabled, sortOrder, code, id], map: "currencies_enabled_sort_order_code_id_idx")',
    )
    expect(currency).toContain('@@map("currencies")')
    expect(currency).not.toContain('isBase')

    for (const field of [
      'id',
      'currencyId',
      'foreignUnitsPerCny',
      'version',
      'createdAt',
      'updatedAt',
      'currency',
    ]) {
      expect(exchangeRate).toMatch(new RegExp(`\\n\\s*${field}\\s`, 'u'))
    }
    expect(exchangeRate).toContain(
      '@map("foreign_units_per_cny") @db.Decimal(30, 4)',
    )
    expect(exchangeRate).toContain(
      '@unique(map: "exchange_rates_currency_id_key")',
    )
    expect(exchangeRate).toContain(
      '@relation(fields: [currencyId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
    )
    expect(exchangeRate).toContain(
      '@@index([updatedAt(sort: Desc), id(sort: Desc)], map: "exchange_rates_updated_at_id_idx")',
    )
    expect(exchangeRate).toContain('@@map("exchange_rates")')

    for (const rejectedField of [
      'effectiveFrom',
      'effectiveTo',
      'baseCurrencyId',
      'quoteCurrencyId',
      'deletedAt',
    ]) {
      expect(exchangeRate).not.toContain(rejectedField)
    }
  })

  it('creates every named scalar, identity and restrictive relation boundary', () => {
    const migration = readMigration()

    for (const constraintName of [
      'currencies_pkey',
      'currencies_code_format_check',
      'currencies_name_nonblank_check',
      'currencies_english_name_nonblank_check',
      'currencies_symbol_nonblank_check',
      'currencies_minor_unit_range_check',
      'currencies_sort_order_nonnegative_check',
      'currencies_version_positive_check',
      'currencies_cny_shape_check',
      'exchange_rates_pkey',
      'exchange_rates_positive_check',
      'exchange_rates_version_positive_check',
      'exchange_rates_currency_not_cny_check',
      'exchange_rates_currency_id_fkey',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraintName}"`)
    }

    for (const indexName of [
      'currencies_code_key',
      'currencies_enabled_sort_order_code_id_idx',
      'exchange_rates_currency_id_key',
      'exchange_rates_updated_at_id_idx',
    ]) {
      expect(migration).toContain(`INDEX "${indexName}"`)
    }

    expect(migration).toContain('NUMERIC(30, 12)')
    expect(migration).toMatch(
      new RegExp(
        `CHECK \\(\\s*"currency_id"\\s*<> '${CNY_CURRENCY_ID}'::uuid\\s*\\)`,
        'u',
      ),
    )
    expect(migration).toMatch(
      /CONSTRAINT "exchange_rates_currency_id_fkey"[\s\S]*?ON DELETE RESTRICT ON UPDATE RESTRICT;/u,
    )
  })

  it('uses database triggers for immutable identity, fixed CNY and activation dependency', () => {
    const migration = readMigration()

    expect(migration).toContain(
      'CREATE FUNCTION "enforce_currency_invariants"()',
    )
    for (const column of ['id', 'code', 'minor_unit']) {
      expect(migration).toMatch(
        new RegExp(
          `NEW\\."${column}" IS DISTINCT FROM OLD\\."${column}"`,
          'u',
        ),
      )
    }
    expect(migration).toContain(
      "CONSTRAINT = 'currencies_identity_immutable_check'",
    )
    expect(migration).toContain(
      "CONSTRAINT = 'currencies_cny_delete_check'",
    )
    expect(migration).toContain(
      "CONSTRAINT = 'currencies_exchange_rate_required_check'",
    )
    expect(migration).toMatch(
      /NEW\."enabled"[\s\S]*?NEW\."code" <> 'CNY'[\s\S]*?FROM "exchange_rates"[\s\S]*?FOR KEY SHARE/u,
    )
    expect(migration).toMatch(
      /CREATE TRIGGER "currencies_invariants_trigger"[\s\S]*?BEFORE INSERT OR UPDATE OF "id", "code", "minor_unit", "enabled" OR DELETE[\s\S]*?EXECUTE FUNCTION "enforce_currency_invariants"\(\);/u,
    )

    expect(migration).toContain(
      'CREATE FUNCTION "enforce_exchange_rate_invariants"()',
    )
    expect(migration).toContain(
      "CONSTRAINT = 'exchange_rates_identity_immutable_check'",
    )
    expect(migration).toContain(
      "CONSTRAINT = 'exchange_rates_enabled_currency_guard_check'",
    )
    expect(migration).toMatch(
      /CREATE TRIGGER "exchange_rates_invariants_trigger"[\s\S]*?BEFORE UPDATE OF "id", "currency_id" OR DELETE[\s\S]*?EXECUTE FUNCTION "enforce_exchange_rate_invariants"\(\);/u,
    )
  })

  it('adds eight assignable permissions, system-admin grants and six audit events atomically', () => {
    const migration = readMigration()
    const permissionSeeds = [
      ['00000000-0000-4000-8000-000000000118', 'currencies:read'],
      ['00000000-0000-4000-8000-000000000119', 'currencies:create'],
      ['00000000-0000-4000-8000-000000000120', 'currencies:update'],
      ['00000000-0000-4000-8000-000000000121', 'currencies:enable'],
      ['00000000-0000-4000-8000-000000000122', 'currencies:disable'],
      ['00000000-0000-4000-8000-000000000123', 'exchange-rates:read'],
      ['00000000-0000-4000-8000-000000000124', 'exchange-rates:create'],
      ['00000000-0000-4000-8000-000000000125', 'exchange-rates:update'],
    ] as const

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)

    for (const eventType of [
      'CURRENCY_CREATED',
      'CURRENCY_UPDATED',
      'CURRENCY_ENABLED',
      'CURRENCY_DISABLED',
      'EXCHANGE_RATE_CREATED',
      'EXCHANGE_RATE_UPDATED',
    ]) {
      expect(readSchema()).toContain(`  ${eventType}`)
      expect(migration).toContain(
        `ALTER TYPE "audit_event_type" ADD VALUE '${eventType}'`,
      )
    }

    for (const [id, code] of permissionSeeds) {
      expect(migration).toMatch(
        new RegExp(`'${id}',\\s*'${code}'[\\s\\S]*?false`, 'u'),
      )
      expect(MANAGEMENT_PERMISSION_CODES).toContain(code)
    }

    expect(migration).toMatch(
      /INSERT INTO "role_permissions"[\s\S]*?'00000000-0000-4000-8000-000000000001'[\s\S]*?WHERE "code" IN \([\s\S]*?'currencies:read'[\s\S]*?'exchange-rates:update'[\s\S]*?\);/u,
    )
  })

  it('keeps schema and the four-currency seed in two immutable offline migrations', () => {
    const migrationDirectories = readdirSync(
      resolve(serverRoot, 'prisma/migrations'),
      { withFileTypes: true },
    )
      .filter(entry => entry.isDirectory() && entry.name.includes('currency_'))
      .map(entry => entry.name)
      .sort()
    const schemaMigration = readMigration()
    const seedMigration = readSeedMigration()

    expect(migrationDirectories).toEqual([
      '20260729090000_currency_exchange_rate_schema_and_permissions',
      '20260729100000_currency_seed',
    ])
    expect(schemaMigration).not.toContain('INSERT INTO "currencies"')
    expect(seedMigration).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE|FUNCTION|TRIGGER)\b/iu,
    )
    expect(seedMigration).not.toContain('ON CONFLICT DO NOTHING')
    expect(seedMigration).not.toMatch(/\b(?:curl|fetch|https?):/iu)
    expect(seedMigration.trimStart()).toMatch(/^BEGIN;/u)
    expect(seedMigration.trimEnd()).toMatch(/COMMIT;$/u)
  })

  it('seeds stable CNY, TWD, MYR and USD identities with only CNY enabled and zero rates', () => {
    const seedMigration = readSeedMigration()
    const currencySeeds = [
      [CNY_CURRENCY_ID, 'CNY', 10, true],
      ['00000000-0000-4000-8000-000000001002', 'TWD', 20, false],
      ['00000000-0000-4000-8000-000000001003', 'MYR', 30, false],
      ['00000000-0000-4000-8000-000000001004', 'USD', 40, false],
    ] as const

    expect(seedMigration.match(/INSERT INTO "currencies"/gu)).toHaveLength(1)
    for (const [id, code, sortOrder, enabled] of currencySeeds) {
      expect(seedMigration).toMatch(
        new RegExp(
          `'${id}',\\s*'${code}'[\\s\\S]*?2,\\s*${enabled},\\s*${sortOrder},\\s*1`,
          'u',
        ),
      )
    }
    expect(seedMigration).not.toContain('INSERT INTO "exchange_rates"')

    for (const assertion of [
      'currency seed total count mismatch',
      'currency seed code count mismatch',
      'currency seed enabled state mismatch',
      'currency seed minor unit mismatch',
      'currency seed identity mismatch',
      'currency seed exchange rate count mismatch',
    ]) {
      expect(seedMigration).toContain(assertion)
    }
  })
})
