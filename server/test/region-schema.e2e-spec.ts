import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const serverRoot = resolve(__dirname, '..')
const authMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260717090000_user_auth_rbac/migration.sql',
)
const regionMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260727090000_regions_schema_and_permissions/migration.sql',
)
const systemAdminRoleId = '00000000-0000-4000-8000-000000000001'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL

  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }

  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^region_schema_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Region Schema E2E schema name is invalid')
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
  const savepoint = `expected_region_rejection_${savepointIndex}`
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

interface RegionInput {
  administrativeType: string
  code: string
  id?: string
  level: 'CITY' | 'COUNTRY_REGION' | 'PROVINCE_STATE'
  name: string
  normalizedName: string
  parentId?: string | null
  sortOrder?: number
}

async function insertRegion(
  client: Client,
  input: RegionInput,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO "regions" (
        "id",
        "code",
        "name",
        "normalized_name",
        "administrative_type",
        "level",
        "parent_id",
        "sort_order"
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::"region_level",
        $7,
        $8
      )
      RETURNING "id"
    `,
    [
      input.id ?? randomUUID(),
      input.code,
      input.name,
      input.normalizedName,
      input.administrativeType,
      input.level,
      input.parentId ?? null,
      input.sortOrder ?? 0,
    ],
  )
  const id = result.rows[0]?.id

  if (!id) {
    throw new Error('Region Schema E2E region was not created')
  }

  return id
}

describe('region schema migration replay against PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('accepts exactly three levels and enforces every database invariant', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `region_schema_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    let schemaCreated = false

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      schemaCreated = true
      await client.query(`SET search_path TO ${quotedSchema}, public`)
      await client.query(readFileSync(authMigrationPath, 'utf8'))
      await client.query(readFileSync(regionMigrationPath, 'utf8'))
      await client.query('BEGIN')

      const countryId = await insertRegion(client, {
        administrativeType: 'COUNTRY_REGION',
        code: 'E2E-COUNTRY',
        level: 'COUNTRY_REGION',
        name: '测试国家',
        normalizedName: '测试国家',
      })
      const provinceId = await insertRegion(client, {
        administrativeType: 'PROVINCE_STATE',
        code: 'E2E-PROVINCE',
        level: 'PROVINCE_STATE',
        name: '测试省',
        normalizedName: '测试省',
        parentId: countryId,
      })
      const cityId = await insertRegion(client, {
        administrativeType: 'CITY',
        code: 'E2E-CITY',
        level: 'CITY',
        name: '测试市',
        normalizedName: '测试市',
        parentId: provinceId,
      })

      const path = await client.query<{
        city: string
        country: string
        province: string
      }>(
        `
          SELECT
            country."name" AS "country",
            province."name" AS "province",
            city."name" AS "city"
          FROM "regions" AS city
          JOIN "regions" AS province ON province."id" = city."parent_id"
          JOIN "regions" AS country ON country."id" = province."parent_id"
          WHERE city."id" = $1
        `,
        [cityId],
      )
      expect(path.rows).toEqual([
        {
          city: '测试市',
          country: '测试国家',
          province: '测试省',
        },
      ])

      await expectConstraintRejection(
        client,
        () => insertRegion(client, {
          administrativeType: 'PROVINCE_STATE',
          code: 'E2E-WRONG-PROVINCE',
          level: 'PROVINCE_STATE',
          name: '错误省',
          normalizedName: '错误省',
          parentId: provinceId,
        }),
        'regions_hierarchy_check',
        '23514',
        1,
      )
      await expectConstraintRejection(
        client,
        () => insertRegion(client, {
          administrativeType: 'CITY',
          code: 'E2E-WRONG-CITY',
          level: 'CITY',
          name: '错误市',
          normalizedName: '错误市',
          parentId: countryId,
        }),
        'regions_hierarchy_check',
        '23514',
        2,
      )
      await expectConstraintRejection(
        client,
        () => insertRegion(client, {
          administrativeType: 'CITY',
          code: 'E2E-ORPHAN',
          level: 'CITY',
          name: '孤儿市',
          normalizedName: '孤儿市',
          parentId: randomUUID(),
        }),
        'regions_parent_id_fkey',
        '23503',
        3,
      )

      const selfId = randomUUID()
      await expectConstraintRejection(
        client,
        () => insertRegion(client, {
          administrativeType: 'PROVINCE_STATE',
          code: 'E2E-SELF',
          id: selfId,
          level: 'PROVINCE_STATE',
          name: '自引用省',
          normalizedName: '自引用省',
          parentId: selfId,
        }),
        'regions_no_self_parent_check',
        '23514',
        4,
      )
      await expectConstraintRejection(
        client,
        () => insertRegion(client, {
          administrativeType: 'CITY',
          code: 'E2E-NEGATIVE-SORT',
          level: 'CITY',
          name: '负排序市',
          normalizedName: '负排序市',
          parentId: provinceId,
          sortOrder: -1,
        }),
        'regions_sort_order_nonnegative_check',
        '23514',
        5,
      )
      await expectConstraintRejection(
        client,
        () => insertRegion(client, {
          administrativeType: 'CITY',
          code: 'E2E-CITY',
          level: 'CITY',
          name: '重复编码市',
          normalizedName: '重复编码市',
          parentId: provinceId,
        }),
        'regions_code_key',
        '23505',
        6,
      )
      await expectConstraintRejection(
        client,
        () => insertRegion(client, {
          administrativeType: 'COUNTRY_REGION',
          code: 'E2E-DUPLICATE-ROOT',
          level: 'COUNTRY_REGION',
          name: '重复根',
          normalizedName: '测试国家',
        }),
        'regions_root_normalized_name_key',
        '23505',
        7,
      )
      await expectConstraintRejection(
        client,
        () => insertRegion(client, {
          administrativeType: 'CITY',
          code: 'E2E-DUPLICATE-SIBLING',
          level: 'CITY',
          name: '重复同级',
          normalizedName: '测试市',
          parentId: provinceId,
        }),
        'regions_parent_id_normalized_name_key',
        '23505',
        8,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `UPDATE "regions" SET "code" = 'E2E-CHANGED' WHERE "id" = $1`,
          [cityId],
        ),
        'regions_identity_immutable_check',
        '23514',
        9,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `DELETE FROM "regions" WHERE "id" = $1`,
          [provinceId],
        ),
        'regions_parent_id_fkey',
        '23503',
        10,
      )

      const grants = await client.query<{
        code: string
        systemOnly: boolean
      }>(
        `
          SELECT
            permission."code",
            permission."system_only" AS "systemOnly"
          FROM "role_permissions" AS grant_record
          JOIN "permissions" AS permission
            ON permission."id" = grant_record."permission_id"
          WHERE
            grant_record."role_id" = $1
            AND permission."code" LIKE 'regions:%'
          ORDER BY permission."code"
        `,
        [systemAdminRoleId],
      )
      expect(grants.rows).toEqual([
        { code: 'regions:create', systemOnly: false },
        { code: 'regions:disable', systemOnly: false },
        { code: 'regions:enable', systemOnly: false },
        { code: 'regions:read', systemOnly: false },
        { code: 'regions:update', systemOnly: false },
      ])

      const testRegionCount = await client.query<{ count: string }>(
        `
          SELECT count(*)::text AS "count"
          FROM "regions"
          WHERE "code" LIKE 'E2E-%'
        `,
      )
      expect(testRegionCount.rows[0]?.count).toBe('3')
      await client.query('ROLLBACK')
    }
    finally {
      await client.query('ROLLBACK').catch(() => undefined)
      if (schemaCreated) {
        await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`)
      }
      await client.end()
    }
  })
})
