import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const serverRoot = resolve(__dirname, '..')
const authMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260717090000_user_auth_rbac/migration.sql',
)
const readPermissionMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260817090000_fund_account_read_permission/migration.sql',
)
const fundMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260818090000_fund_account_domain_foundation/migration.sql',
)
const precisionMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260819090000_fund_account_two_decimal_precision/migration.sql',
)
const SYSTEM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001'
const COMPANY_ACCOUNT_ID = '00000000-0000-4000-8000-000000002001'
const ADMIN_SOURCE_ID = '00000000-0000-4000-8000-000000002101'
const ADMIN_POSTING_TYPE_ID = '00000000-0000-4000-8000-000000002209'
const ADMIN_RULE_VERSION_ID = '00000000-0000-4000-8000-000000002309'

const FUND_PERMISSION_CODES = [
  'fund-accounts:create',
  'fund-accounts:manual-adjust',
  'fund-accounts:read',
  'fund-accounts:update-share-rate',
  'fund-business-sources:manage',
  'fund-posting-types:manage',
  'fund-transactions:reverse',
] as const

const FUND_AUDIT_EVENT_TYPES = [
  'FUND_ACCOUNT_CREATED',
  'FUND_ACCOUNT_SHARE_RATE_UPDATED',
  'FUND_POSTING_TYPE_CREATED',
  'FUND_POSTING_TYPE_UPDATED',
  'FUND_POSTING_TYPE_ENABLED',
  'FUND_POSTING_TYPE_DISABLED',
  'FUND_POSTING_RULE_PUBLISHED',
  'FUND_BUSINESS_SOURCE_CREATED',
  'FUND_BUSINESS_SOURCE_UPDATED',
  'FUND_BUSINESS_SOURCE_ENABLED',
  'FUND_BUSINESS_SOURCE_DISABLED',
  'FUND_MANUAL_ADJUSTMENT_POSTED',
  'FUND_BUSINESS_POSTED',
  'FUND_POSTING_REVERSED',
] as const

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for E2E tests')
  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^fund_schema_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Fund Schema E2E schema name is invalid')
  }
  return `"${identifier}"`
}

function readDatabaseError(error: unknown): {
  code?: unknown
  constraint?: unknown
} {
  if (typeof error !== 'object' || error === null) return {}
  return {
    code: Reflect.get(error, 'code'),
    constraint: Reflect.get(error, 'constraint'),
  }
}

async function expectDatabaseRejection(
  client: Client,
  action: () => Promise<unknown>,
  constraint: string,
  expectedCode: '23505' | '23514',
  savepointIndex: number,
): Promise<void> {
  const savepoint = `expected_fund_rejection_${savepointIndex}`
  await client.query(`SAVEPOINT ${savepoint}`)
  try {
    await action()
  }
  catch (error) {
    // 仅检查 PostgreSQL 稳定字段，避免把业务金额或幂等输入写入测试日志。
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

describe('fund account domain migration replay against PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('seeds the confirmed catalog and enforces immutable accounting facts', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `fund_schema_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    const userId = randomUUID()
    const userAccountId = randomUUID()
    const batchId = randomUUID()
    let schemaCreated = false

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      schemaCreated = true
      await client.query(`SET search_path TO ${quotedSchema}, public`)
      await client.query(readFileSync(authMigrationPath, 'utf8'))
      await client.query(readFileSync(readPermissionMigrationPath, 'utf8'))
      await client.query(readFileSync(fundMigrationPath, 'utf8'))
      await client.query(readFileSync(precisionMigrationPath, 'utf8'))

      const tableCount = await client.query<{ count: number }>(`
        SELECT count(*)::integer AS "count"
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name LIKE 'fund_%'
      `)
      expect(tableCount.rows).toEqual([{ count: 8 }])

      const seedCounts = await client.query<{
        accounts: number
        sources: number
        postingTypes: number
        ruleVersions: number
        ruleLegs: number
        sourceLinks: number
        batches: number
        entries: number
      }>(`
        SELECT
          (SELECT count(*)::integer FROM "fund_accounts") AS "accounts",
          (SELECT count(*)::integer FROM "fund_business_sources") AS "sources",
          (SELECT count(*)::integer FROM "fund_posting_types") AS "postingTypes",
          (SELECT count(*)::integer FROM "fund_posting_rule_versions") AS "ruleVersions",
          (SELECT count(*)::integer FROM "fund_posting_rule_legs") AS "ruleLegs",
          (SELECT count(*)::integer FROM "fund_business_source_posting_types") AS "sourceLinks",
          (SELECT count(*)::integer FROM "fund_posting_batches") AS "batches",
          (SELECT count(*)::integer FROM "fund_ledger_entries") AS "entries"
      `)
      expect(seedCounts.rows).toEqual([{
        accounts: 1,
        sources: 1,
        postingTypes: 9,
        ruleVersions: 9,
        ruleLegs: 17,
        sourceLinks: 1,
        batches: 0,
        entries: 0,
      }])

      const companyAccount = await client.query<{
        id: string
        ownerType: string
        currency: string
        balance: string
        userId: string | null
        userShareRate: string | null
      }>(`
        SELECT
          "id",
          "owner_type"::text AS "ownerType",
          "currency",
          "balance"::text AS "balance",
          "user_id" AS "userId",
          "user_share_rate"::text AS "userShareRate"
        FROM "fund_accounts"
      `)
      expect(companyAccount.rows).toEqual([{
        id: COMPANY_ACCOUNT_ID,
        ownerType: 'COMPANY',
        currency: 'CNY',
        balance: '0.00',
        userId: null,
        userShareRate: null,
      }])

      const permissionCatalog = await client.query<{
        code: string
        systemOnly: boolean
      }>(`
        SELECT "code", "system_only" AS "systemOnly"
        FROM "permissions"
        WHERE "code" LIKE 'fund-%'
        ORDER BY "code"
      `)
      expect(permissionCatalog.rows).toEqual(
        FUND_PERMISSION_CODES.map(code => ({ code, systemOnly: true })),
      )
      await expect(client.query<{ count: number }>(`
        SELECT count(*)::integer AS "count"
        FROM "role_permissions" AS grant_row
        JOIN "permissions" AS permission
          ON permission."id" = grant_row."permission_id"
        WHERE grant_row."role_id" = $1
          AND permission."code" = ANY($2::text[])
      `, [SYSTEM_ADMIN_ROLE_ID, FUND_PERMISSION_CODES])).resolves.toMatchObject({
        rows: [{ count: FUND_PERMISSION_CODES.length }],
      })
      await expect(client.query<{ count: number }>(`
        SELECT count(*)::integer AS "count"
        FROM "role_permissions" AS grant_row
        JOIN "permissions" AS permission
          ON permission."id" = grant_row."permission_id"
        WHERE grant_row."role_id" <> $1
          AND permission."code" = ANY($2::text[])
      `, [SYSTEM_ADMIN_ROLE_ID, FUND_PERMISSION_CODES])).resolves.toMatchObject({
        rows: [{ count: 0 }],
      })

      const auditTypes = await client.query<{ value: string }>(`
        SELECT enum_entry.enumlabel::text AS "value"
        FROM pg_enum AS enum_entry
        JOIN pg_type AS type_entry ON type_entry.oid = enum_entry.enumtypid
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = type_entry.typnamespace
        WHERE namespace_entry.nspname = current_schema()
          AND type_entry.typname = 'audit_event_type'
          AND enum_entry.enumlabel LIKE 'FUND_%'
        ORDER BY enum_entry.enumsortorder
      `)
      expect(auditTypes.rows.map(row => row.value)).toEqual(
        FUND_AUDIT_EVENT_TYPES,
      )

      await client.query('BEGIN')
      await expectDatabaseRejection(
        client,
        () => client.query(`
          INSERT INTO "fund_accounts" ("owner_type") VALUES ('COMPANY')
        `),
        'fund_accounts_one_company_key',
        '23505',
        1,
      )

      await client.query(`
        INSERT INTO "users" (
          "id", "username", "username_normalized", "display_name",
          "password_hash", "password_changed_at", "updated_at"
        )
        VALUES (
          $1,
          'fund-e2e',
          'fund-e2e',
          '资金测试用户',
          'hash',
          clock_timestamp(),
          clock_timestamp()
        )
      `, [userId])
      await client.query(`
        INSERT INTO "fund_accounts" (
          "id", "owner_type", "user_id", "user_share_rate",
          "share_rate_updated_at"
        )
        VALUES ($1, 'USER', $2, 30, clock_timestamp())
      `, [userAccountId, userId])
      await expectDatabaseRejection(
        client,
        () => client.query(`
          INSERT INTO "fund_accounts" (
            "owner_type", "user_id", "user_share_rate", "share_rate_updated_at"
          )
          VALUES ('USER', $1, 50, clock_timestamp())
        `, [userId]),
        'fund_accounts_user_id_key',
        '23505',
        2,
      )
      await expectDatabaseRejection(
        client,
        () => client.query(`
          UPDATE "fund_accounts" SET "user_share_rate" = 100.01
          WHERE "id" = $1
        `, [userAccountId]),
        'fund_accounts_user_share_rate_range_check',
        '23514',
        3,
      )

      await expectDatabaseRejection(
        client,
        () => client.query(`
          INSERT INTO "fund_posting_rule_versions" (
            "posting_type_id", "revision", "status", "published_at"
          )
          VALUES ($1, 2, 'ACTIVE', clock_timestamp())
        `, [ADMIN_POSTING_TYPE_ID]),
        'fund_posting_rule_versions_one_active_key',
        '23505',
        4,
      )
      await expectDatabaseRejection(
        client,
        () => client.query(`
          UPDATE "fund_posting_rule_versions" SET "revision" = 2
          WHERE "id" = $1
        `, [ADMIN_RULE_VERSION_ID]),
        'fund_posting_rule_versions_immutable_check',
        '23514',
        5,
      )
      await expectDatabaseRejection(
        client,
        () => client.query(`
          INSERT INTO "fund_posting_rule_legs" (
            "rule_version_id", "position", "account_target",
            "direction_policy", "amount_strategy", "adjustment_mode"
          )
          VALUES ($1, 8, 'USER', 'CREDIT', 'FULL_AMOUNT', 'USER_ONLY')
        `, [ADMIN_RULE_VERSION_ID]),
        'fund_posting_rule_legs_parent_guard_check',
        '23514',
        6,
      )

      await client.query(`
        INSERT INTO "fund_posting_batches" (
          "id", "batch_no", "kind", "posting_type_id",
          "posting_type_code_snapshot", "posting_type_name_snapshot",
          "business_category_snapshot", "business_source_id",
          "business_source_code_snapshot", "business_source_name_snapshot",
          "rule_version_id", "rule_revision_snapshot", "user_id",
          "business_amount", "user_share_rate_snapshot",
          "company_share_rate_snapshot", "business_id", "business_no",
          "summary", "business_occurred_at", "consumer_code",
          "idempotency_key_hash", "request_fingerprint_hash",
          "adjustment_mode", "actor_user_id", "request_id"
        )
        VALUES (
          $1, 'FUND-E2E-0001', 'MANUAL_ADJUSTMENT', $2,
          'ADMIN_MANUAL_ADJUSTMENT', '管理员手动调账', 'ADJUSTMENT', $3,
          'ADMIN_CONSOLE', '管理员工作台', $4, 1, $5,
          100, 30, 70, 'e2e-adjustment', 'E2E-ADJUST-0001',
          '资金 Schema E2E', clock_timestamp(), 'ADMIN_CONSOLE',
          decode(repeat('ab', 32), 'hex'), decode(repeat('cd', 32), 'hex'),
          'USER_AND_COMPANY_BY_SHARE', $5, 'req_fund_schema_e2e'
        )
      `, [
        batchId,
        ADMIN_POSTING_TYPE_ID,
        ADMIN_SOURCE_ID,
        ADMIN_RULE_VERSION_ID,
        userId,
      ])
      await client.query(`
        INSERT INTO "fund_ledger_entries" (
          "batch_id", "line_no", "account_id", "direction",
          "account_target", "amount_strategy", "amount",
          "balance_before", "balance_after", "account_sequence"
        )
        VALUES ($1, 1, $2, 'CREDIT', 'USER', 'USER_SHARE', 30, 0, 30, 1)
      `, [batchId, userAccountId])

      await expectDatabaseRejection(
        client,
        () => client.query(`
          INSERT INTO "fund_ledger_entries" (
            "batch_id", "line_no", "account_id", "direction",
            "account_target", "amount_strategy", "amount",
            "balance_before", "balance_after", "account_sequence"
          )
          VALUES ($1, 2, $2, 'DEBIT', 'USER', 'FULL_AMOUNT', -1, 30, 31, 2)
        `, [batchId, userAccountId]),
        'fund_ledger_entries_amount_positive_check',
        '23514',
        7,
      )
      await expectDatabaseRejection(
        client,
        () => client.query(`
          UPDATE "fund_posting_batches" SET "summary" = '篡改'
          WHERE "id" = $1
        `, [batchId]),
        'fund_posting_batches_immutable_check',
        '23514',
        8,
      )
      await expectDatabaseRejection(
        client,
        () => client.query(`
          DELETE FROM "fund_ledger_entries" WHERE "batch_id" = $1
        `, [batchId]),
        'fund_ledger_entries_immutable_check',
        '23514',
        9,
      )
      await expectDatabaseRejection(
        client,
        () => client.query(`
          UPDATE "fund_business_sources" SET "code" = 'CHANGED'
          WHERE "id" = $1
        `, [ADMIN_SOURCE_ID]),
        'fund_business_sources_code_immutable_check',
        '23514',
        10,
      )
      await expectDatabaseRejection(
        client,
        () => client.query(`
          UPDATE "fund_posting_types" SET "code" = 'CHANGED'
          WHERE "id" = $1
        `, [ADMIN_POSTING_TYPE_ID]),
        'fund_posting_types_code_immutable_check',
        '23514',
        11,
      )

      await client.query('ROLLBACK')
    }
    finally {
      if (schemaCreated) {
        await client.query('RESET search_path').catch(() => undefined)
        await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`)
          .catch(() => undefined)
      }
      await client.end()
    }
  })

  it('rejects non-lossless historical decimals before narrowing the schema', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `fund_schema_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    const userId = randomUUID()
    let schemaCreated = false

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      schemaCreated = true
      await client.query(`SET search_path TO ${quotedSchema}, public`)
      await client.query(readFileSync(authMigrationPath, 'utf8'))
      await client.query(readFileSync(readPermissionMigrationPath, 'utf8'))
      await client.query(readFileSync(fundMigrationPath, 'utf8'))
      await client.query(`
        INSERT INTO "users" (
          "id", "username", "username_normalized", "display_name",
          "password_hash", "password_changed_at", "updated_at"
        )
        VALUES (
          $1, 'fund-precision-e2e', 'fund-precision-e2e',
          '资金精度迁移测试用户', 'hash', clock_timestamp(), clock_timestamp()
        )
      `, [userId])
      await client.query(`
        INSERT INTO "fund_accounts" (
          "owner_type", "user_id", "balance", "user_share_rate",
          "share_rate_updated_at"
        )
        VALUES ('USER', $1, 0.001, 30.00, clock_timestamp())
      `, [userId])

      try {
        await client.query(readFileSync(precisionMigrationPath, 'utf8'))
      }
      catch (error) {
        // 迁移只允许稳定错误码暴露给门禁；历史金额本身不得进入测试日志。
        expect(readDatabaseError(error).code).toBe('23514')
        await client.query('ROLLBACK')

        const precision = await client.query<{ numericScale: number }>(`
          SELECT numeric_scale::integer AS "numericScale"
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'fund_accounts'
            AND column_name = 'balance'
        `)
        expect(precision.rows).toEqual([{ numericScale: 4 }])
        return
      }

      throw new Error('Expected fund precision migration to reject historical data')
    }
    finally {
      await client.query('ROLLBACK').catch(() => undefined)
      if (schemaCreated) {
        await client.query('RESET search_path').catch(() => undefined)
        await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`)
          .catch(() => undefined)
      }
      await client.end()
    }
  })
})
