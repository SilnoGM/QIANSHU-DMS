import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const serverRoot = resolve(__dirname, '..')
const authMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260717090000_user_auth_rbac/migration.sql',
)
const numberingMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260802090000_numbering_management_schema_and_permissions/migration.sql',
)
const SYSTEM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001'
const NUMBERING_PERMISSION_CODES = [
  'numbering-rules:create',
  'numbering-rules:disable',
  'numbering-rules:enable',
  'numbering-rules:publish',
  'numbering-rules:read',
  'numbering-rules:read-issuances',
  'numbering-rules:update',
] as const

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }
  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^numbering_schema_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Numbering Schema E2E schema name is invalid')
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
  expectedCode: '23503' | '23505' | '23514',
  savepointIndex: number,
): Promise<void> {
  const savepoint = `expected_numbering_rejection_${savepointIndex}`
  await client.query(`SAVEPOINT ${savepoint}`)

  try {
    await action()
  }
  catch (error) {
    // 只读取 PostgreSQL 稳定字段，避免把 SQL 参数或原始幂等数据写进失败输出。
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

interface RuleFixture {
  ruleId: string
  versionId: string
}

async function insertRuleFixture(
  client: Client,
  code: string,
  versionStatus: 'ACTIVE' | 'DRAFT' = 'DRAFT',
): Promise<RuleFixture> {
  const ruleId = randomUUID()
  const versionId = randomUUID()

  await client.query(
    `
      INSERT INTO "numbering_rules" (
        "id", "rule_code", "name", "status", "version"
      )
      VALUES ($1, $2, 'E2E 编号规则', 'DRAFT', 1)
    `,
    [ruleId, code],
  )
  await client.query(
    `
      INSERT INTO "numbering_rule_versions" (
        "id",
        "rule_id",
        "revision",
        "status",
        "reset_policy",
        "timezone",
        "config_fingerprint",
        "published_at"
      )
      VALUES (
        $1,
        $2,
        1,
        $3::"numbering_rule_version_status",
        'NEVER',
        'Asia/Shanghai',
        repeat('a', 64),
        CASE WHEN $3 = 'DRAFT' THEN NULL ELSE clock_timestamp() END
      )
    `,
    [versionId, ruleId, versionStatus],
  )

  return { ruleId, versionId }
}

describe('numbering schema migration replay against PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('enforces the confirmed catalog, relational boundaries and immutable ledger', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `numbering_schema_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    let schemaCreated = false

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      schemaCreated = true
      await client.query(`SET search_path TO ${quotedSchema}, public`)
      await client.query(readFileSync(authMigrationPath, 'utf8'))
      await client.query(readFileSync(numberingMigrationPath, 'utf8'))

      const permissionCatalog = await client.query<{ code: string }>(
        `
          SELECT "code"
          FROM "permissions"
          WHERE "code" LIKE 'numbering-rules:%'
          ORDER BY "code"
        `,
      )
      expect(permissionCatalog.rows.map(row => row.code)).toEqual(
        NUMBERING_PERMISSION_CODES,
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
          [SYSTEM_ADMIN_ROLE_ID, NUMBERING_PERMISSION_CODES],
        ),
      ).resolves.toMatchObject({ rows: [{ count: 7 }] })

      const auditTypes = await client.query<{ value: string }>(`
        SELECT enum_value::text AS "value"
        FROM unnest(enum_range(NULL::"audit_event_type")) AS enum_value
        WHERE enum_value::text LIKE 'NUMBERING_RULE_%'
        ORDER BY enum_value::text
      `)
      expect(auditTypes.rows.map(row => row.value)).toEqual([
        'NUMBERING_RULE_CREATED',
        'NUMBERING_RULE_DISABLED',
        'NUMBERING_RULE_ENABLED',
        'NUMBERING_RULE_UPDATED',
        'NUMBERING_RULE_VERSION_PUBLISHED',
      ])

      const numberingEnums = await client.query<{
        type: string
        values: string[]
      }>(`
        SELECT
          type_entry.typname AS "type",
          array_agg(
            enum_entry.enumlabel::text
            ORDER BY enum_entry.enumsortorder
          )
            AS "values"
        FROM pg_enum AS enum_entry
        JOIN pg_type AS type_entry
          ON type_entry.oid = enum_entry.enumtypid
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = type_entry.typnamespace
        WHERE namespace_entry.nspname = current_schema()
          AND type_entry.typname = ANY(ARRAY[
          'numbering_rule_status',
          'numbering_rule_version_status',
          'numbering_segment_type',
          'numbering_reset_policy',
          'numbering_date_format',
          'numbering_random_mode'
        ]::text[])
        GROUP BY type_entry.typname
        ORDER BY type_entry.typname
      `)
      expect(numberingEnums.rows).toEqual([
        {
          type: 'numbering_date_format',
          values: ['YYYY', 'YY', 'MM', 'DD', 'YYYYMM', 'YYYYMMDD', 'YYMMDD'],
        },
        {
          type: 'numbering_random_mode',
          values: ['LETTERS_THEN_DIGITS', 'SHUFFLED'],
        },
        {
          type: 'numbering_reset_policy',
          values: ['NEVER', 'YEARLY', 'MONTHLY', 'DAILY'],
        },
        {
          type: 'numbering_rule_status',
          values: ['DRAFT', 'ENABLED', 'DISABLED'],
        },
        {
          type: 'numbering_rule_version_status',
          values: ['DRAFT', 'ACTIVE', 'RETIRED'],
        },
        {
          type: 'numbering_segment_type',
          values: ['FIXED', 'DATE', 'SEPARATOR', 'SEQUENCE', 'RANDOM'],
        },
      ])

      await client.query('BEGIN')
      const primary = await insertRuleFixture(client, 'ORDER_NO')
      const secondary = await insertRuleFixture(client, 'RETURN_NO')
      let rejection = 0

      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_rules" (
              "rule_code", "name", "status", "version"
            )
            VALUES ('ORDER_NO', '重复规则', 'DRAFT', 1)
          `,
        ),
        'numbering_rules_rule_code_key',
        '23505',
        ++rejection,
      )

      await client.query(
        `
          INSERT INTO "numbering_rule_segments" (
            "version_id",
            "position",
            "type",
            "fixed_value"
          )
          VALUES ($1, 0, 'FIXED', 'ORD')
        `,
        [primary.versionId],
      )
      await client.query(
        `
          INSERT INTO "numbering_rule_segments" (
            "version_id", "position", "type",
            "random_letter_length", "random_digit_length", "random_mode"
          )
          VALUES ($1, 2, 'RANDOM', 2, 2, 'SHUFFLED')
        `,
        [primary.versionId],
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_rule_segments" (
              "version_id", "position", "type",
              "random_letter_length", "random_digit_length", "random_mode"
            )
            VALUES ($1, 3, 'RANDOM', 1, 1, 'LETTERS_THEN_DIGITS')
          `,
          [primary.versionId],
        ),
        'numbering_rule_segments_one_random_key',
        '23505',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_rule_segments" (
              "version_id", "position", "type", "fixed_value"
            )
            VALUES ($1, 0, 'FIXED', 'DUPLICATE')
          `,
          [primary.versionId],
        ),
        'numbering_rule_segments_version_id_position_key',
        '23505',
        ++rejection,
      )
      await client.query(
        `
          INSERT INTO "numbering_rule_segments" (
            "version_id",
            "position",
            "type",
            "sequence_width",
            "sequence_start_value",
            "sequence_step"
          )
          VALUES ($1, 1, 'SEQUENCE', 6, 1, 1)
        `,
        [primary.versionId],
      )
      await client.query(
        `
          INSERT INTO "numbering_period_states" (
            "rule_id", "period_key", "next_sequence_value", "used_count"
          )
          VALUES ($1, 'ALL', 2, 1)
        `,
        [primary.ruleId],
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_period_states" (
              "rule_id", "period_key", "next_sequence_value", "used_count"
            )
            VALUES ($1, 'ALL', 3, 2)
          `,
          [primary.ruleId],
        ),
        'numbering_period_states_rule_id_period_key_key',
        '23505',
        ++rejection,
      )
      await client.query(
        `
          INSERT INTO "numbering_period_states" (
            "rule_id", "period_key", "next_sequence_value", "used_count"
          )
          VALUES ($1, 'ALL', 1, 0)
        `,
        [secondary.ruleId],
      )
      await client.query(
        `
          INSERT INTO "numbering_issuances" (
            "rule_id",
            "rule_version_id",
            "period_key",
            "generated_number",
            "sequence_value",
            "consumer_code",
            "idempotency_key_hash",
            "request_fingerprint_hash"
          )
          VALUES ($1, $2, 'ALL', 'ORD000001', 1, 'ORDER.SERVICE', $3, $4)
        `,
        [primary.ruleId, primary.versionId, Buffer.alloc(32, 1), Buffer.alloc(32, 2)],
      )

      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_issuances" (
              "rule_id", "rule_version_id", "period_key", "generated_number",
              "consumer_code", "idempotency_key_hash", "request_fingerprint_hash"
            )
            VALUES ($1, $2, 'ALL', 'ORD000001', 'ORDER.SERVICE', $3, $4)
          `,
          [primary.ruleId, primary.versionId, Buffer.alloc(32, 9), Buffer.alloc(32, 10)],
        ),
        'numbering_issuances_rule_id_generated_number_key',
        '23505',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_issuances" (
              "rule_id", "rule_version_id", "period_key", "generated_number",
              "consumer_code", "idempotency_key_hash", "request_fingerprint_hash"
            )
            VALUES ($1, $2, 'ALL', 'RET000001', 'ORDER.SERVICE', $3, $4)
          `,
          [secondary.ruleId, secondary.versionId, Buffer.alloc(32, 1), Buffer.alloc(32, 11)],
        ),
        'numbering_issuances_consumer_code_idempotency_key_hash_key',
        '23505',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_issuances" (
              "rule_id", "rule_version_id", "period_key", "generated_number",
              "consumer_code", "idempotency_key_hash", "request_fingerprint_hash"
            )
            VALUES ($1, $2, 'ALL', 'ORD000003', 'ORDER.SERVICE', $3, $4)
          `,
          [primary.ruleId, primary.versionId, Buffer.alloc(32, 12), Buffer.alloc(31, 13)],
        ),
        'numbering_issuances_request_fingerprint_hash_32_bytes_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "numbering_rules" SET "rule_code" = \'CHANGED\' WHERE "id" = $1',
          [primary.ruleId],
        ),
        'numbering_rules_identity_immutable_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_rule_versions" (
              "rule_id", "revision", "status", "reset_policy",
              "timezone", "config_fingerprint", "published_at"
            )
            VALUES ($1, 2, 'DRAFT', 'NEVER', 'Asia/Shanghai', repeat('b', 64), NULL)
          `,
          [primary.ruleId],
        ),
        'numbering_rule_versions_one_draft_key',
        '23505',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_rule_segments" (
              "version_id", "position", "type", "fixed_value", "date_format"
            )
            VALUES ($1, 4, 'FIXED', 'BAD', 'YYYY')
          `,
          [primary.versionId],
        ),
        'numbering_rule_segments_shape_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_rule_segments" (
              "version_id", "position", "type",
              "sequence_width", "sequence_start_value", "sequence_step"
            )
            VALUES ($1, 5, 'SEQUENCE', 4, 1, 1)
          `,
          [primary.versionId],
        ),
        'numbering_rule_segments_one_sequence_key',
        '23505',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_issuances" (
              "rule_id", "rule_version_id", "period_key", "generated_number",
              "consumer_code", "idempotency_key_hash", "request_fingerprint_hash"
            )
            VALUES ($1, $2, 'ALL', 'RET000001', 'RETURN.SERVICE', $3, $4)
          `,
          [secondary.ruleId, primary.versionId, Buffer.alloc(32, 3), Buffer.alloc(32, 4)],
        ),
        'numbering_issuances_rule_version_id_rule_id_fkey',
        '23503',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_issuances" (
              "rule_id", "rule_version_id", "period_key", "generated_number",
              "consumer_code", "idempotency_key_hash", "request_fingerprint_hash"
            )
            VALUES ($1, $2, '202608', 'ORD000002', 'ORDER.SERVICE', $3, $4)
          `,
          [primary.ruleId, primary.versionId, Buffer.alloc(32, 5), Buffer.alloc(32, 6)],
        ),
        'numbering_issuances_rule_id_period_key_fkey',
        '23503',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_issuances" (
              "rule_id", "rule_version_id", "period_key", "generated_number",
              "consumer_code", "idempotency_key_hash", "request_fingerprint_hash"
            )
            VALUES ($1, $2, 'ALL', 'ORD000002', 'ORDER.SERVICE', $3, $4)
          `,
          [primary.ruleId, primary.versionId, Buffer.alloc(31, 7), Buffer.alloc(32, 8)],
        ),
        'numbering_issuances_idempotency_key_hash_32_bytes_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "numbering_issuances" SET "generated_number" = \'ORD999999\' WHERE "rule_id" = $1',
          [primary.ruleId],
        ),
        'numbering_issuances_immutable_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'DELETE FROM "numbering_issuances" WHERE "rule_id" = $1',
          [primary.ruleId],
        ),
        'numbering_issuances_immutable_check',
        '23514',
        ++rejection,
      )

      await client.query(
        `
          UPDATE "numbering_rule_versions"
          SET "status" = 'ACTIVE', "published_at" = clock_timestamp()
          WHERE "id" = $1
        `,
        [primary.versionId],
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_rule_versions" (
              "rule_id", "revision", "status", "reset_policy",
              "timezone", "config_fingerprint", "published_at"
            )
            VALUES (
              $1, 2, 'ACTIVE', 'NEVER', 'Asia/Shanghai',
              repeat('c', 64), clock_timestamp()
            )
          `,
          [primary.ruleId],
        ),
        'numbering_rule_versions_one_active_key',
        '23505',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            UPDATE "numbering_rule_versions"
            SET "reset_policy" = 'YEARLY'
            WHERE "id" = $1
          `,
          [primary.versionId],
        ),
        'numbering_rule_versions_config_immutable_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            UPDATE "numbering_rule_segments"
            SET "fixed_value" = 'UPDATED'
            WHERE "version_id" = $1 AND "position" = 0
          `,
          [primary.versionId],
        ),
        'numbering_rule_segments_parent_draft_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            DELETE FROM "numbering_rule_segments"
            WHERE "version_id" = $1 AND "position" = 0
          `,
          [primary.versionId],
        ),
        'numbering_rule_segments_parent_draft_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "numbering_rule_segments" (
              "version_id", "position", "type", "separator_value"
            )
            VALUES ($1, 2, 'SEPARATOR', '-')
          `,
          [primary.versionId],
        ),
        'numbering_rule_segments_parent_draft_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "numbering_rule_versions" SET "status" = \'DRAFT\' WHERE "id" = $1',
          [primary.versionId],
        ),
        'numbering_rule_versions_status_transition_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'DELETE FROM "numbering_rule_versions" WHERE "id" = $1',
          [primary.versionId],
        ),
        'numbering_rule_versions_delete_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'DELETE FROM "numbering_rules" WHERE "id" = $1',
          [primary.ruleId],
        ),
        'numbering_rules_delete_check',
        '23514',
        ++rejection,
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
