import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const serverRoot = resolve(__dirname, '..')
const authMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260717090000_user_auth_rbac/migration.sql',
)
const dictionaryMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260803090000_dictionary_management_schema_and_permissions/migration.sql',
)
const SYSTEM_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000001'

const DICTIONARY_CONSTRAINTS = [
  'dictionary_items_description_nonblank_check',
  'dictionary_items_dictionary_type_id_fkey',
  'dictionary_items_label_nonblank_check',
  'dictionary_items_pkey',
  'dictionary_items_sort_order_nonnegative_check',
  'dictionary_items_value_format_check',
  'dictionary_items_version_positive_check',
  'dictionary_types_code_format_check',
  'dictionary_types_description_nonblank_check',
  'dictionary_types_name_nonblank_check',
  'dictionary_types_pkey',
  'dictionary_types_sort_order_nonnegative_check',
  'dictionary_types_version_positive_check',
] as const

const DICTIONARY_INDEXES = [
  'dictionary_items_dictionary_type_id_value_key',
  'dictionary_items_type_id_enabled_sort_order_value_id_idx',
  'dictionary_items_type_id_sort_order_value_id_idx',
  'dictionary_types_code_key',
  'dictionary_types_enabled_sort_order_code_id_idx',
  'dictionary_types_sort_order_code_id_idx',
] as const

const DICTIONARY_PERMISSION_ROWS = [
  {
    id: '00000000-0000-4000-8000-000000000134',
    code: 'dictionaries:create',
    name: '创建系统字典',
    systemOnly: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000137',
    code: 'dictionaries:disable',
    name: '停用系统字典',
    systemOnly: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000136',
    code: 'dictionaries:enable',
    name: '启用系统字典',
    systemOnly: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000133',
    code: 'dictionaries:read',
    name: '查询系统字典',
    systemOnly: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000135',
    code: 'dictionaries:update',
    name: '编辑系统字典',
    systemOnly: false,
  },
] as const

const DICTIONARY_AUDIT_EVENT_TYPES = [
  'DICTIONARY_ITEM_CREATED',
  'DICTIONARY_ITEM_DISABLED',
  'DICTIONARY_ITEM_ENABLED',
  'DICTIONARY_ITEM_UPDATED',
  'DICTIONARY_TYPE_CREATED',
  'DICTIONARY_TYPE_DISABLED',
  'DICTIONARY_TYPE_ENABLED',
  'DICTIONARY_TYPE_UPDATED',
] as const

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) {
    throw new Error('DATABASE_URL is required for Dictionary Schema E2E tests')
  }
  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^dictionary_schema_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Dictionary Schema E2E schema name is invalid')
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
  const savepoint = `expected_dictionary_rejection_${savepointIndex}`
  await client.query(`SAVEPOINT ${savepoint}`)

  try {
    await action()
  }
  catch (error) {
    // 只读取 PostgreSQL 稳定字段，避免把 SQL 参数或驱动消息写入失败输出。
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

describe('dictionary schema migration replay against PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('enforces the empty catalog, governance and immutable identities', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `dictionary_schema_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    const primaryTypeId = randomUUID()
    const secondaryTypeId = randomUUID()
    const primaryItemId = randomUUID()
    const secondaryItemId = randomUUID()
    let schemaCreated = false
    let transactionOpen = false

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      schemaCreated = true
      await client.query(`SET search_path TO ${quotedSchema}, public`)
      await client.query(readFileSync(authMigrationPath, 'utf8'))
      await client.query(readFileSync(dictionaryMigrationPath, 'utf8'))

      await expect(
        client.query<{ typeCount: number; itemCount: number }>(`
          SELECT
            (SELECT count(*)::integer FROM "dictionary_types")
              AS "typeCount",
            (SELECT count(*)::integer FROM "dictionary_items")
              AS "itemCount"
        `),
      ).resolves.toMatchObject({
        rows: [{ typeCount: 0, itemCount: 0 }],
      })

      const toneValues = await client.query<{ value: string }>(`
        SELECT enum_entry.enumlabel::text AS "value"
        FROM pg_enum AS enum_entry
        JOIN pg_type AS type_entry
          ON type_entry.oid = enum_entry.enumtypid
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = type_entry.typnamespace
        WHERE namespace_entry.nspname = current_schema()
          AND type_entry.typname = 'dictionary_tone'
        ORDER BY enum_entry.enumsortorder
      `)
      expect(toneValues.rows.map(row => row.value)).toEqual([
        'DEFAULT',
        'PRIMARY',
        'SUCCESS',
        'WARNING',
        'DANGER',
        'INFO',
      ])

      const constraints = await client.query<{ name: string }>(`
        SELECT constraint_entry.conname AS "name"
        FROM pg_constraint AS constraint_entry
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = constraint_entry.connamespace
        WHERE namespace_entry.nspname = current_schema()
          AND constraint_entry.conname LIKE 'dictionary_%'
        ORDER BY constraint_entry.conname
      `)
      expect(constraints.rows.map(row => row.name)).toEqual(
        DICTIONARY_CONSTRAINTS,
      )

      const indexes = await client.query<{ name: string }>(`
        SELECT index_entry.relname AS "name"
        FROM pg_class AS index_entry
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = index_entry.relnamespace
        WHERE namespace_entry.nspname = current_schema()
          AND index_entry.relkind = 'i'
          AND index_entry.relname = ANY($1::text[])
        ORDER BY index_entry.relname
      `, [DICTIONARY_INDEXES])
      expect(indexes.rows.map(row => row.name)).toEqual(DICTIONARY_INDEXES)

      const functions = await client.query<{ name: string }>(`
        SELECT procedure_entry.proname AS "name"
        FROM pg_proc AS procedure_entry
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = procedure_entry.pronamespace
        WHERE namespace_entry.nspname = current_schema()
          AND procedure_entry.proname LIKE 'enforce_dictionary_%'
        ORDER BY procedure_entry.proname
      `)
      expect(functions.rows.map(row => row.name)).toEqual([
        'enforce_dictionary_item_invariants',
        'enforce_dictionary_type_invariants',
      ])

      const triggers = await client.query<{ name: string }>(`
        SELECT trigger_entry.tgname AS "name"
        FROM pg_trigger AS trigger_entry
        JOIN pg_class AS table_entry
          ON table_entry.oid = trigger_entry.tgrelid
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = table_entry.relnamespace
        WHERE namespace_entry.nspname = current_schema()
          AND NOT trigger_entry.tgisinternal
          AND trigger_entry.tgname LIKE 'dictionary_%'
        ORDER BY trigger_entry.tgname
      `)
      expect(triggers.rows.map(row => row.name)).toEqual([
        'dictionary_items_invariants_trigger',
        'dictionary_types_invariants_trigger',
      ])

      const permissions = await client.query<{
        id: string
        code: string
        name: string
        systemOnly: boolean
      }>(`
        SELECT
          "id"::text,
          "code",
          "name",
          "system_only" AS "systemOnly"
        FROM "permissions"
        WHERE "code" LIKE 'dictionaries:%'
        ORDER BY "code"
      `)
      expect(permissions.rows).toEqual(DICTIONARY_PERMISSION_ROWS)

      const grants = await client.query<{
        roleId: string
        roleCode: string
        permissionCodes: string[]
      }>(`
        SELECT
          role."id"::text AS "roleId",
          role."code" AS "roleCode",
          array_agg(permission."code" ORDER BY permission."code")
            AS "permissionCodes"
        FROM "roles" AS role
        JOIN "role_permissions" AS grant_row
          ON grant_row."role_id" = role."id"
        JOIN "permissions" AS permission
          ON permission."id" = grant_row."permission_id"
        WHERE role."id" = $1
          AND role."code" = 'system_admin'
          AND permission."code" LIKE 'dictionaries:%'
        GROUP BY role."id", role."code"
      `, [SYSTEM_ADMIN_ROLE_ID])
      expect(grants.rows).toEqual([{
        roleId: SYSTEM_ADMIN_ROLE_ID,
        roleCode: 'system_admin',
        permissionCodes: DICTIONARY_PERMISSION_ROWS.map(row => row.code),
      }])

      const auditTypes = await client.query<{ value: string }>(`
        SELECT enum_entry.enumlabel::text AS "value"
        FROM pg_enum AS enum_entry
        JOIN pg_type AS type_entry
          ON type_entry.oid = enum_entry.enumtypid
        JOIN pg_namespace AS namespace_entry
          ON namespace_entry.oid = type_entry.typnamespace
        WHERE namespace_entry.nspname = current_schema()
          AND type_entry.typname = 'audit_event_type'
          AND enum_entry.enumlabel LIKE 'DICTIONARY_%'
        ORDER BY enum_entry.enumlabel
      `)
      expect(auditTypes.rows.map(row => row.value)).toEqual(
        DICTIONARY_AUDIT_EVENT_TYPES,
      )

      await client.query('BEGIN')
      transactionOpen = true
      await client.query(
        `
          INSERT INTO "dictionary_types" ("id", "code", "name")
          VALUES ($1, 'sales.channel', '销售渠道')
        `,
        [primaryTypeId],
      )
      const typeDefaults = await client.query<{
        enabled: boolean
        sortOrder: number
        version: number
      }>(`
        SELECT
          "enabled",
          "sort_order" AS "sortOrder",
          "version"
        FROM "dictionary_types"
        WHERE "id" = $1
      `, [primaryTypeId])
      expect(typeDefaults.rows).toEqual([{
        enabled: false,
        sortOrder: 0,
        version: 1,
      }])

      await client.query(
        `
          INSERT INTO "dictionary_items" (
            "id", "dictionary_type_id", "value", "label"
          )
          VALUES ($1, $2, 'ONLINE', '线上')
        `,
        [primaryItemId, primaryTypeId],
      )
      const itemDefaults = await client.query<{
        tone: string
        enabled: boolean
        sortOrder: number
        version: number
      }>(`
        SELECT
          "tone"::text,
          "enabled",
          "sort_order" AS "sortOrder",
          "version"
        FROM "dictionary_items"
        WHERE "id" = $1
      `, [primaryItemId])
      expect(itemDefaults.rows).toEqual([{
        tone: 'DEFAULT',
        enabled: false,
        sortOrder: 0,
        version: 1,
      }])

      let rejection = 0
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "dictionary_types" SET "enabled" = true WHERE "id" = $1',
          [primaryTypeId],
        ),
        'dictionary_types_enabled_item_required_check',
        '23514',
        ++rejection,
      )
      await client.query(
        'UPDATE "dictionary_items" SET "enabled" = true WHERE "id" = $1',
        [primaryItemId],
      )
      await client.query(
        'UPDATE "dictionary_types" SET "enabled" = true WHERE "id" = $1',
        [primaryTypeId],
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "dictionary_items" SET "enabled" = false WHERE "id" = $1',
          [primaryItemId],
        ),
        'dictionary_items_last_enabled_check',
        '23514',
        ++rejection,
      )

      await client.query(
        `
          INSERT INTO "dictionary_items" (
            "id", "dictionary_type_id", "value", "label", "enabled"
          )
          VALUES ($1, $2, 'OFFLINE', '线下', true)
        `,
        [secondaryItemId, primaryTypeId],
      )
      await client.query(
        'UPDATE "dictionary_items" SET "enabled" = false WHERE "id" = $1',
        [primaryItemId],
      )

      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "dictionary_types" ("code", "name")
            VALUES ('sales.channel', '重复类型')
          `,
        ),
        'dictionary_types_code_key',
        '23505',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "dictionary_items" (
              "dictionary_type_id", "value", "label"
            )
            VALUES ($1, 'ONLINE', '重复条目')
          `,
          [primaryTypeId],
        ),
        'dictionary_items_dictionary_type_id_value_key',
        '23505',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "dictionary_types" ("code", "name")
            VALUES ('INVALID', '非法类型')
          `,
        ),
        'dictionary_types_code_format_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "dictionary_items" (
              "dictionary_type_id", "value", "label"
            )
            VALUES ($1, 'invalid', '非法条目')
          `,
          [primaryTypeId],
        ),
        'dictionary_items_value_format_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            INSERT INTO "dictionary_items" (
              "dictionary_type_id", "value", "label"
            )
            VALUES ($1, 'UNKNOWN', '无父类型')
          `,
          [randomUUID()],
        ),
        'dictionary_items_dictionary_type_id_fkey',
        '23503',
        ++rejection,
      )

      await client.query(
        `
          INSERT INTO "dictionary_types" ("id", "code", "name")
          VALUES ($1, 'sales.source', '销售来源')
        `,
        [secondaryTypeId],
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "dictionary_types" SET "id" = $1 WHERE "id" = $2',
          [randomUUID(), primaryTypeId],
        ),
        'dictionary_types_identity_immutable_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "dictionary_types" SET "code" = $1 WHERE "id" = $2',
          ['sales.changed', primaryTypeId],
        ),
        'dictionary_types_identity_immutable_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "dictionary_items" SET "id" = $1 WHERE "id" = $2',
          [randomUUID(), primaryItemId],
        ),
        'dictionary_items_identity_immutable_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "dictionary_items" SET "value" = $1 WHERE "id" = $2',
          ['CHANGED', primaryItemId],
        ),
        'dictionary_items_identity_immutable_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `
            UPDATE "dictionary_items"
            SET "dictionary_type_id" = $1
            WHERE "id" = $2
          `,
          [secondaryTypeId, primaryItemId],
        ),
        'dictionary_items_identity_immutable_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'DELETE FROM "dictionary_items" WHERE "id" = $1',
          [primaryItemId],
        ),
        'dictionary_items_delete_check',
        '23514',
        ++rejection,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'DELETE FROM "dictionary_types" WHERE "id" = $1',
          [secondaryTypeId],
        ),
        'dictionary_types_delete_check',
        '23514',
        ++rejection,
      )

      await client.query(
        'UPDATE "dictionary_types" SET "enabled" = false WHERE "id" = $1',
        [primaryTypeId],
      )
      await client.query(
        'UPDATE "dictionary_items" SET "enabled" = false WHERE "id" = $1',
        [secondaryItemId],
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          'UPDATE "dictionary_types" SET "enabled" = true WHERE "id" = $1',
          [primaryTypeId],
        ),
        'dictionary_types_enabled_item_required_check',
        '23514',
        ++rejection,
      )

      await client.query('ROLLBACK')
      transactionOpen = false
      await expect(
        client.query<{ typeCount: number; itemCount: number }>(`
          SELECT
            (SELECT count(*)::integer FROM "dictionary_types")
              AS "typeCount",
            (SELECT count(*)::integer FROM "dictionary_items")
              AS "itemCount"
        `),
      ).resolves.toMatchObject({
        rows: [{ typeCount: 0, itemCount: 0 }],
      })
    }
    finally {
      if (transactionOpen) {
        await client.query('ROLLBACK').catch(() => undefined)
      }
      if (schemaCreated) {
        await client.query('RESET search_path').catch(() => undefined)
        await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`)
          .catch(() => undefined)
      }
      await client.end()
    }
  })
})
