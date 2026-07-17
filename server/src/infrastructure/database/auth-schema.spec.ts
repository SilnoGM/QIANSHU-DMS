import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260717090000_user_auth_rbac/migration.sql',
)

function readSchema(): string {
  return readFileSync(schemaPath, 'utf8')
}

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8')
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

describe('authentication and RBAC database schema', () => {
  it('defines every confirmed PostgreSQL-backed authentication model', () => {
    const schema = readSchema()

    for (const modelName of [
      'User',
      'Role',
      'Permission',
      'UserRole',
      'RolePermission',
      'AuthSession',
      'AuthRateLimit',
      'AuditEvent',
    ]) {
      expect(schema).toContain(`model ${modelName} {`)
    }

    expect(schema).toContain('enum UserStatus {')
    expect(schema).toContain('enum SessionRevokedReason {')
    expect(schema).toContain('enum AuthRateLimitScope {')
  })

  it('keeps AuthSession limited to the confirmed single-session design', () => {
    const authSession = extractModel(readSchema(), 'AuthSession')

    for (const field of [
      'id',
      'userId',
      'tokenHash',
      'authVersion',
      'createdAt',
      'lastActivityAt',
      'idleExpiresAt',
      'absoluteExpiresAt',
      'revokedAt',
      'revokedReason',
    ]) {
      expect(authSession).toMatch(new RegExp(`\\n\\s*${field}\\s`))
    }

    for (const forbiddenField of [
      'rememberCredentialId',
      'reauthenticatedAt',
      'supersededAt',
      'predecessorSessionId',
      'sourceRememberTokenId',
      'deviceLabel',
    ]) {
      expect(authSession).not.toContain(forbiddenField)
    }
  })

  it('creates database constraints that Prisma schema cannot express', () => {
    const migration = readMigration()

    for (const constraintName of [
      'users_auth_version_nonnegative_check',
      'users_disabled_state_check',
      'auth_sessions_token_hash_32_bytes_check',
      'auth_sessions_expiry_order_check',
      'auth_sessions_revocation_pair_check',
      'auth_rate_limits_subject_key_hash_32_bytes_check',
      'auth_rate_limits_attempt_count_nonnegative_check',
      'audit_events_source_ip_hash_32_bytes_check',
      'audit_events_actor_identity_check',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraintName}"`)
    }
  })

  it('creates the required session lookup and cleanup indexes', () => {
    const migration = readMigration()

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "auth_sessions_token_hash_key"',
    )
    expect(migration).toContain(
      'CREATE INDEX "auth_sessions_user_id_revoked_at_absolute_expires_at_idx"',
    )
    expect(migration).toContain(
      'CREATE INDEX "auth_sessions_idle_expires_at_idx"',
    )
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "auth_rate_limits_scope_subject_key_hash_key"',
    )
  })

  it('does not create rejected remember-me, device or reauthentication columns', () => {
    const migration = readMigration()

    for (const rejectedColumn of [
      'remember_credential_id',
      'reauthenticated_at',
      'superseded_at',
      'predecessor_session_id',
      'source_remember_token_id',
      'device_label',
    ]) {
      expect(migration).not.toContain(rejectedColumn)
    }
  })

  it('seeds only the confirmed system role and management permission catalog', () => {
    const migration = readMigration()
    const permissionCodes = [
      'users:read',
      'users:create',
      'users:update',
      'users:enable',
      'users:disable',
      'users:assign-roles',
      'users:reset-password',
      'roles:read',
      'roles:create',
      'roles:update',
      'roles:assign-permissions',
      'audit:read',
    ]

    expect(migration).toContain('CREATE UNIQUE INDEX "roles_single_system_role_key"')
    expect(migration).toContain("'system_admin'")
    for (const code of permissionCodes) {
      expect(migration).toContain(`'${code}'`)
    }
    expect(migration).not.toMatch(/pages\.[^']*:browse/)
  })
})
