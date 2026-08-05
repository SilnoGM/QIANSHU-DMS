import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const serverRoot = resolve(__dirname, '..')
const migrationPaths = [
  '20260717090000_user_auth_rbac',
  '20260727090000_regions_schema_and_permissions',
  '20260802090000_numbering_management_schema_and_permissions',
  '20260805090000_supplier_management_schema_and_permissions',
].map(directory => resolve(
  serverRoot,
  `prisma/migrations/${directory}/migration.sql`,
))

const SYSTEM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001'
const SUPPLIER_PERMISSION_CODES = [
  'suppliers:create',
  'suppliers:disable',
  'suppliers:enable',
  'suppliers:read',
  'suppliers:update',
] as const
const SUPPLIER_AUDIT_EVENT_TYPES = [
  'SUPPLIER_CREATED',
  'SUPPLIER_DISABLED',
  'SUPPLIER_ENABLED',
  'SUPPLIER_UPDATED',
] as const

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) {
    throw new Error('DATABASE_URL is required for Supplier Schema E2E tests')
  }
  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^supplier_schema_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Supplier Schema E2E schema name is invalid')
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
  index: number,
): Promise<void> {
  const savepoint = `expected_supplier_rejection_${index}`
  await client.query(`SAVEPOINT ${savepoint}`)
  try {
    await action()
  }
  catch (error) {
    // 只读取 PostgreSQL 稳定诊断字段，避免输出业务资料或幂等 Hash。
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

async function insertIssuance(
  client: Client,
  consumerCode = 'SUPPLIER.CREATE',
  ruleCode = 'SUPPLIER',
): Promise<{ issuanceId: string; generatedNumber: string }> {
  const ruleId = randomUUID()
  const versionId = randomUUID()
  const issuanceId = randomUUID()
  const generatedNumber = `SUP-${randomUUID().slice(0, 8).toUpperCase()}`

  await client.query(
    `
      INSERT INTO "numbering_rules" ("id", "rule_code", "name")
      VALUES ($1, $2, 'E2E 编号规则')
    `,
    [ruleId, ruleCode],
  )
  await client.query(
    `
      INSERT INTO "numbering_rule_versions" (
        "id", "rule_id", "revision", "reset_policy", "config_fingerprint"
      )
      VALUES ($1, $2, 1, 'NEVER', repeat('a', 64))
    `,
    [versionId, ruleId],
  )
  await client.query(
    `
      INSERT INTO "numbering_period_states" (
        "rule_id", "period_key", "next_sequence_value", "used_count"
      )
      VALUES ($1, 'ALL', 2, 1)
    `,
    [ruleId],
  )
  await client.query(
    `
      INSERT INTO "numbering_issuances" (
        "id", "rule_id", "rule_version_id", "period_key",
        "generated_number", "sequence_value", "consumer_code",
        "idempotency_key_hash", "request_fingerprint_hash"
      )
      VALUES ($1, $2, $3, 'ALL', $4, 1, $5, $6, $7)
    `,
    [
      issuanceId,
      ruleId,
      versionId,
      generatedNumber,
      consumerCode,
      Buffer.from(randomUUID().replaceAll('-', '').padEnd(64, '0'), 'hex'),
      Buffer.from(randomUUID().replaceAll('-', '').padEnd(64, '1'), 'hex'),
    ],
  )
  return { issuanceId, generatedNumber }
}

describe('supplier schema migration replay against PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('replays from dependencies and enforces supplier governance', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `supplier_schema_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    let schemaCreated = false
    let transactionOpen = false

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      schemaCreated = true
      await client.query(`SET search_path TO ${quotedSchema}, public`)
      for (const migrationPath of migrationPaths) {
        await client.query(readFileSync(migrationPath, 'utf8'))
      }

      const catalog = await client.query<{
        auditTypes: string[]
        createRequestCount: number
        permissionCodes: string[]
        supplierCount: number
      }>(`
        SELECT
          ARRAY(
            SELECT enum_entry.enumlabel::text
            FROM pg_enum AS enum_entry
            JOIN pg_type AS type_entry
              ON type_entry.oid = enum_entry.enumtypid
            JOIN pg_namespace AS namespace_entry
              ON namespace_entry.oid = type_entry.typnamespace
            WHERE type_entry.typname = 'audit_event_type'
              AND namespace_entry.nspname = current_schema()
              AND enum_entry.enumlabel LIKE 'SUPPLIER_%'
            ORDER BY enum_entry.enumlabel
          ) AS "auditTypes",
          (SELECT count(*)::integer FROM "supplier_create_requests")
            AS "createRequestCount",
          ARRAY(
            SELECT permission."code"
            FROM "role_permissions" AS grant_entry
            JOIN "permissions" AS permission
              ON permission."id" = grant_entry."permission_id"
            WHERE grant_entry."role_id" = $1
              AND permission."code" LIKE 'suppliers:%'
            ORDER BY permission."code"
          ) AS "permissionCodes",
          (SELECT count(*)::integer FROM "suppliers") AS "supplierCount"
      `, [SYSTEM_ADMIN_ROLE_ID])
      expect(catalog.rows).toEqual([{
        auditTypes: SUPPLIER_AUDIT_EVENT_TYPES,
        createRequestCount: 0,
        permissionCodes: SUPPLIER_PERMISSION_CODES,
        supplierCount: 0,
      }])

      await client.query('BEGIN')
      transactionOpen = true
      let rejection = 0
      const validIssuance = await insertIssuance(client)
      const invalidIssuance = await insertIssuance(
        client,
        'ORDER.CREATE',
        'ORDER_NO',
      )
      const supplierId = randomUUID()

      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "suppliers" (
              "code", "numbering_issuance_id", "legal_name",
              "normalized_legal_name", "entity_type"
            )
            VALUES ($1, $2, '错误来源', '错误来源', 'ORGANIZATION')
          `,
          [invalidIssuance.generatedNumber, invalidIssuance.issuanceId],
        ),
        'suppliers_numbering_provenance_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "suppliers" (
              "code", "numbering_issuance_id", "legal_name",
              "normalized_legal_name", "entity_type", "enabled"
            )
            VALUES ($1, $2, '无联系人', '无联系人', 'ORGANIZATION', true)
          `,
          [validIssuance.generatedNumber, validIssuance.issuanceId],
        ),
        'suppliers_enable_requirements_check',
        '23514',
        ++rejection,
      )
      await client.query(
        `
          INSERT INTO "suppliers" (
            "id", "code", "numbering_issuance_id", "legal_name",
            "normalized_legal_name", "entity_type"
          )
          VALUES ($1, $2, $3, '千树供方', '千树供方', 'ORGANIZATION')
        `,
        [supplierId, validIssuance.generatedNumber, validIssuance.issuanceId],
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'DELETE FROM "suppliers" WHERE "id" = $1',
          [supplierId],
        ),
        'suppliers_delete_check',
        '23514',
        ++rejection,
      )

      const createRequestId = randomUUID()
      await client.query(
        `
          INSERT INTO "supplier_create_requests" (
            "id", "idempotency_scope_hash", "request_fingerprint_hash"
          )
          VALUES ($1, $2, $3)
        `,
        [createRequestId, Buffer.alloc(32, 1), Buffer.alloc(32, 2)],
      )
      await client.query(
        'UPDATE "supplier_create_requests" SET "supplier_id" = $1 WHERE "id" = $2',
        [supplierId, createRequestId],
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "supplier_create_requests" SET "supplier_id" = NULL WHERE "id" = $1',
          [createRequestId],
        ),
        'supplier_create_requests_immutable_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "supplier_create_requests" (
              "idempotency_scope_hash", "request_fingerprint_hash"
            )
            VALUES ($1, $2)
          `,
          [Buffer.alloc(31, 3), Buffer.alloc(32, 4)],
        ),
        'supplier_create_requests_idempotency_scope_hash_32_bytes_check',
        '23514',
        ++rejection,
      )

      await client.query('ROLLBACK')
      transactionOpen = false
    }
    finally {
      if (transactionOpen) {
        await client.query('ROLLBACK').catch(() => undefined)
      }
      if (schemaCreated) {
        await client.query('SET search_path TO public').catch(() => undefined)
        await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`)
          .catch(() => undefined)
      }
      await client.end()
    }
  })
})
