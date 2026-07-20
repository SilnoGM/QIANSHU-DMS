import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const serverRoot = resolve(__dirname, '..')
const authMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260717090000_user_auth_rbac/migration.sql',
)
const profileMigrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260720090000_user_profiles/migration.sql',
)

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL

  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }

  return value
}

function quoteTestSchema(identifier: string): string {
  if (!/^user_profile_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('User Profile E2E schema name is invalid')
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
  const savepoint = `expected_rejection_${savepointIndex}`
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

async function createUser(client: Client, label: string): Promise<string> {
  const username = `profile-${label}-${randomUUID()}`
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO "users" (
        "username",
        "username_normalized",
        "display_name",
        "password_hash",
        "password_changed_at",
        "updated_at"
      )
      VALUES ($1, $1, 'Profile Migration E2E', 'test-only-hash', clock_timestamp(), clock_timestamp())
      RETURNING "id"
    `,
    [username],
  )
  const userId = result.rows[0]?.id

  if (!userId) {
    throw new Error('User Profile E2E user was not created')
  }

  return userId
}

describe('user profile migration replay against PostgreSQL', () => {
  jest.setTimeout(30_000)

  it('backfills historical users and enforces every database invariant', async () => {
    const client = new Client({ connectionString: requireDatabaseUrl() })
    const schemaName = `user_profile_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    let transactionStarted = false

    await client.connect()
    try {
      await client.query('BEGIN')
      transactionStarted = true
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      await client.query(`SET LOCAL search_path TO ${quotedSchema}, public`)

      await client.query(readFileSync(authMigrationPath, 'utf8'))
      const historicalUserId = await createUser(client, 'historical')
      await client.query(readFileSync(profileMigrationPath, 'utf8'))

      const historicalProfile = await client.query<{
        avatarUrl: string | null
        createdAt: Date
        email: string | null
        emailNormalized: string | null
        mobileE164: string | null
        remark: string | null
        updatedAt: Date
        userId: string
      }>(
        `
          SELECT
            "user_id" AS "userId",
            "email",
            "email_normalized" AS "emailNormalized",
            "mobile_e164" AS "mobileE164",
            "avatar_url" AS "avatarUrl",
            "remark",
            "created_at" AS "createdAt",
            "updated_at" AS "updatedAt"
          FROM "user_profiles"
          WHERE "user_id" = $1
        `,
        [historicalUserId],
      )
      expect(historicalProfile.rows).toHaveLength(1)
      expect(historicalProfile.rows[0]).toMatchObject({
        avatarUrl: null,
        email: null,
        emailNormalized: null,
        mobileE164: null,
        remark: null,
        userId: historicalUserId,
      })
      expect(historicalProfile.rows[0]?.createdAt).toBeInstanceOf(Date)
      expect(historicalProfile.rows[0]?.updatedAt).toBeInstanceOf(Date)

      const firstUserId = await createUser(client, 'first-null')
      const secondUserId = await createUser(client, 'second-null')
      await client.query(
        `INSERT INTO "user_profiles" ("user_id") VALUES ($1), ($2)`,
        [firstUserId, secondUserId],
      )
      const nullCounts = await client.query<{ count: string }>(`
        SELECT count(*)::text AS "count"
        FROM "user_profiles"
        WHERE "email_normalized" IS NULL AND "mobile_e164" IS NULL
      `)
      expect(Number(nullCounts.rows[0]?.count)).toBeGreaterThanOrEqual(3)

      await client.query(
        `
          UPDATE "user_profiles"
          SET
            "email" = 'Alice@Example.com',
            "email_normalized" = 'alice@example.com',
            "mobile_e164" = '+8613800138000'
          WHERE "user_id" = $1
        `,
        [firstUserId],
      )

      await expectConstraintRejection(
        client,
        () => client.query(
          `
            UPDATE "user_profiles"
            SET "email" = 'alice@example.com', "email_normalized" = 'alice@example.com'
            WHERE "user_id" = $1
          `,
          [secondUserId],
        ),
        'user_profiles_email_normalized_key',
        '23505',
        1,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `UPDATE "user_profiles" SET "mobile_e164" = '+8613800138000' WHERE "user_id" = $1`,
          [secondUserId],
        ),
        'user_profiles_mobile_e164_key',
        '23505',
        2,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `UPDATE "user_profiles" SET "mobile_e164" = '+01234567' WHERE "user_id" = $1`,
          [secondUserId],
        ),
        'user_profiles_mobile_e164_check',
        '23514',
        3,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `UPDATE "user_profiles" SET "email" = 'orphan@example.com' WHERE "user_id" = $1`,
          [secondUserId],
        ),
        'user_profiles_email_pair_check',
        '23514',
        4,
      )
      await expectConstraintRejection(
        client,
        () => client.query(
          `INSERT INTO "user_profiles" ("user_id") VALUES ($1)`,
          [secondUserId],
        ),
        'user_profiles_pkey',
        '23505',
        5,
      )

      await client.query(`DELETE FROM "users" WHERE "id" = $1`, [firstUserId])
      const cascadedProfile = await client.query<{ count: string }>(
        `SELECT count(*)::text AS "count" FROM "user_profiles" WHERE "user_id" = $1`,
        [firstUserId],
      )
      expect(cascadedProfile.rows[0]?.count).toBe('0')
    }
    finally {
      if (transactionStarted) {
        await client.query('ROLLBACK')
      }

      const schemaAfterRollback = await client.query<{ name: string | null }>(
        `SELECT to_regnamespace($1)::text AS "name"`,
        [schemaName],
      )
      expect(schemaAfterRollback.rows[0]?.name).toBeNull()
      await client.end()
    }
  })
})
