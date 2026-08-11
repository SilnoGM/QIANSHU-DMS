import { randomUUID } from 'node:crypto'

import { Client } from 'pg'

const MANAGEMENT_PERMISSION_CODES = [
  'audit:read',
  'currencies:create',
  'currencies:disable',
  'currencies:enable',
  'currencies:read',
  'currencies:update',
  'dictionaries:create',
  'dictionaries:disable',
  'dictionaries:enable',
  'dictionaries:read',
  'dictionaries:update',
  'exchange-rates:create',
  'exchange-rates:read',
  'exchange-rates:update',
  'numbering-rules:create',
  'numbering-rules:disable',
  'numbering-rules:enable',
  'numbering-rules:publish',
  'numbering-rules:read',
  'numbering-rules:read-issuances',
  'numbering-rules:update',
  'products:create',
  'products:read',
  'regions:create',
  'regions:disable',
  'regions:enable',
  'regions:read',
  'regions:update',
  'roles:assign-permissions',
  'roles:create',
  'roles:read',
  'roles:update',
  'users:assign-roles',
  'users:create',
  'users:disable',
  'users:enable',
  'users:read',
  'users:reset-password',
  'users:update',
] as const

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL

  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }

  return value
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
  action: () => Promise<unknown>,
  constraint: string,
  expectedCode = '23514',
): Promise<void> {
  try {
    await action()
  }
  catch (error) {
    // 只断言 PostgreSQL 的稳定错误码和约束名，不把可能包含 SQL 参数的驱动消息写入测试输出。
    const databaseError = readDatabaseError(error)
    expect(databaseError.code).toBe(expectedCode)
    expect(databaseError.constraint).toBe(constraint)
    return
  }

  throw new Error(`Expected database constraint ${constraint} to reject input`)
}

describe('authentication schema migration against PostgreSQL', () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: requireDatabaseUrl() })
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  async function createActiveUser(): Promise<string> {
    const username = `schema-e2e-${randomUUID()}`
    const result = await client.query<{ id: string }>(
      `
        WITH created_user AS (
          INSERT INTO users (
            username,
            username_normalized,
            display_name,
            password_hash,
            password_changed_at,
            updated_at
          )
          VALUES ($1, $1, 'Schema E2E', 'test-only-hash', clock_timestamp(), clock_timestamp())
          RETURNING id
        )
        INSERT INTO user_profiles (user_id)
        SELECT id FROM created_user
        RETURNING user_id AS id
      `,
      [username],
    )

    const id = result.rows[0]?.id
    if (!id) {
      throw new Error('Schema E2E user was not created')
    }

    return id
  }

  it('seeds one system_admin with exactly the confirmed management permissions', async () => {
    const result = await client.query<{
      code: string
      is_system: boolean
      permission_codes: string[]
    }>(`
      SELECT
        role.code,
        role.is_system,
        array_agg(permission.code ORDER BY permission.code) AS permission_codes
      FROM roles AS role
      JOIN role_permissions AS role_permission
        ON role_permission.role_id = role.id
      JOIN permissions AS permission
        ON permission.id = role_permission.permission_id
      WHERE role.code = 'system_admin'
      GROUP BY role.id
    `)

    expect(result.rows).toEqual([
      {
        code: 'system_admin',
        is_system: true,
        permission_codes: [...MANAGEMENT_PERMISSION_CODES],
      },
    ])

    const demoPermissionCount = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM permissions
      WHERE code LIKE 'pages.%:browse'
    `)
    expect(demoPermissionCount.rows[0]?.count).toBe('0')
  })

  it('enforces the only-system-role and User state invariants', async () => {
    await expectConstraintRejection(
      () => client.query(
        `
          INSERT INTO roles (code, name, is_system)
          VALUES ($1, 'Invalid second system role', true)
        `,
        [`invalid-system-role-${randomUUID()}`],
      ),
      'roles_single_system_role_key',
      '23505',
    )

    const actorId = await createActiveUser()
    await expectConstraintRejection(
      () => client.query(
        `
          INSERT INTO users (
            username,
            username_normalized,
            display_name,
            password_hash,
            password_changed_at,
            disabled_at,
            disabled_by_user_id,
            updated_at
          )
          VALUES ($1, $1, 'Invalid active user', 'test-only-hash', clock_timestamp(), clock_timestamp(), $2, clock_timestamp())
        `,
        [`invalid-active-${randomUUID()}`, actorId],
      ),
      'users_disabled_state_check',
    )
  })

  it('enforces Session hash, expiry and revocation invariants', async () => {
    const userId = await createActiveUser()
    const validHash = Buffer.alloc(32, 1)

    await expectConstraintRejection(
      () => client.query(
        `
          INSERT INTO auth_sessions (
            user_id,
            token_hash,
            auth_version,
            last_activity_at,
            idle_expires_at,
            absolute_expires_at
          )
          VALUES ($1, $2, 0, clock_timestamp(), clock_timestamp() + interval '1 day', clock_timestamp() + interval '2 days')
        `,
        [userId, Buffer.alloc(31, 1)],
      ),
      'auth_sessions_token_hash_32_bytes_check',
    )

    await expectConstraintRejection(
      () => client.query(
        `
          INSERT INTO auth_sessions (
            user_id,
            token_hash,
            auth_version,
            last_activity_at,
            idle_expires_at,
            absolute_expires_at
          )
          VALUES ($1, $2, 0, clock_timestamp(), clock_timestamp() + interval '3 days', clock_timestamp() + interval '2 days')
        `,
        [userId, validHash],
      ),
      'auth_sessions_expiry_order_check',
    )

    await expectConstraintRejection(
      () => client.query(
        `
          INSERT INTO auth_sessions (
            user_id,
            token_hash,
            auth_version,
            last_activity_at,
            idle_expires_at,
            absolute_expires_at,
            revoked_at
          )
          VALUES ($1, $2, 0, clock_timestamp(), clock_timestamp() + interval '1 day', clock_timestamp() + interval '2 days', clock_timestamp())
        `,
        [userId, Buffer.alloc(32, 2)],
      ),
      'auth_sessions_revocation_pair_check',
    )
  })

  it('enforces RateLimit and Audit hash and shape invariants', async () => {
    await expectConstraintRejection(
      () => client.query(
        `
          INSERT INTO auth_rate_limits (
            scope,
            subject_key_hash,
            bucket_started_at,
            attempt_count
          )
          VALUES ('LOGIN_IP', $1, clock_timestamp(), 0)
        `,
        [Buffer.alloc(31, 1)],
      ),
      'auth_rate_limits_subject_key_hash_32_bytes_check',
    )

    await expectConstraintRejection(
      () => client.query(
        `
          INSERT INTO auth_rate_limits (
            scope,
            subject_key_hash,
            bucket_started_at,
            attempt_count
          )
          VALUES ('LOGIN_USERNAME', $1, clock_timestamp(), -1)
        `,
        [Buffer.alloc(32, 3)],
      ),
      'auth_rate_limits_attempt_count_nonnegative_check',
    )

    await expectConstraintRejection(
      () => client.query(
        `
          INSERT INTO audit_events (
            event_type,
            outcome,
            actor_type,
            request_id,
            source_ip_hash,
            metadata
          )
          VALUES ('AUTH_LOGIN_FAILED', 'FAILURE', 'ANONYMOUS', $1, $2, '{}'::jsonb)
        `,
        [`req_${randomUUID()}`, Buffer.alloc(31, 1)],
      ),
      'audit_events_source_ip_hash_32_bytes_check',
    )

    await expectConstraintRejection(
      () => client.query(
        `
          INSERT INTO audit_events (
            event_type,
            outcome,
            actor_type,
            request_id,
            metadata
          )
          VALUES ('AUTH_LOGIN_FAILED', 'FAILURE', 'ANONYMOUS', $1, $2::jsonb)
        `,
        [`req_${randomUUID()}`, JSON.stringify([])],
      ),
      'audit_events_metadata_object_check',
    )

    const actorId = await createActiveUser()
    await expectConstraintRejection(
      () => client.query(
        `
          INSERT INTO audit_events (
            event_type,
            outcome,
            actor_type,
            actor_user_id,
            request_id,
            metadata
          )
          VALUES ('SYSTEM_BOOTSTRAP', 'SUCCESS', 'SYSTEM', $1, $2, '{}'::jsonb)
        `,
        [actorId, `req_${randomUUID()}`],
      ),
      'audit_events_actor_identity_check',
    )
  })
})
