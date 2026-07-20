import { spawn } from 'node:child_process'
import process from 'node:process'

import { isDirectEntry } from '../run-command.mjs'

const bootstrapProgram = String.raw`
const argon2 = require('argon2')
const { randomUUID } = require('node:crypto')
const { Client } = require('pg')

;(async () => {
  const passwordHash = await argon2.hash(
    process.env.QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD.normalize('NFC'),
    {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    },
  )
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const role = await client.query(
      'SELECT id FROM roles WHERE code = $1 FOR UPDATE',
      ['system_admin'],
    )
    if (role.rowCount !== 1) throw new Error('role')
    const user = await client.query(
      [
        'INSERT INTO users (',
        'username, username_normalized, display_name, password_hash,',
        'status, must_change_password, password_changed_at, auth_version,',
        'last_login_at, created_by_user_id, disabled_at, disabled_by_user_id, updated_at',
        ') VALUES ($1, $2, $3, $4, \'ACTIVE\', false, clock_timestamp(), 0,',
        'NULL, NULL, NULL, NULL, clock_timestamp()) RETURNING id',
      ].join(' '),
      [
        process.env.QIANSHU_BROWSER_AUTH_ADMIN_USERNAME,
        process.env.QIANSHU_BROWSER_AUTH_ADMIN_USERNAME.normalize('NFC').toLowerCase(),
        process.env.QIANSHU_BROWSER_AUTH_ADMIN_DISPLAY_NAME,
        passwordHash,
      ],
    )
    await client.query(
      'INSERT INTO user_profiles (user_id) VALUES ($1)',
      [user.rows[0].id],
    )
    await client.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [user.rows[0].id, role.rows[0].id],
    )
    await client.query(
      [
        'INSERT INTO audit_events (',
        'event_type, outcome, actor_type, actor_user_id, target_type, target_id, request_id, metadata',
        ') VALUES (\'SYSTEM_BOOTSTRAP\', \'SUCCESS\', \'SYSTEM\', NULL,',
        '\'User\', $1, $2, \'{}\'::jsonb)',
      ].join(' '),
      [user.rows[0].id, 'e2e:' + randomUUID()],
    )
    await client.query('COMMIT')
  }
  catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
  finally {
    await client.end()
  }
})().catch((error) => {
  process.stderr.write('UNKNOWN')
  process.exit(1)
})
`

class ProvisionAdminError extends Error {
  constructor(readonlyCode = 'UNKNOWN') {
    super('Browser auth admin fixture failed')
    this.name = 'ProvisionAdminError'
    this.readonlyCode = readonlyCode
  }
}

export function readProvisionInput(environment) {
  const databaseUrl = environment.DATABASE_URL
  const username = environment.QIANSHU_BROWSER_AUTH_ADMIN_USERNAME
  const displayName = environment.QIANSHU_BROWSER_AUTH_ADMIN_DISPLAY_NAME
  const password = environment.QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD
  let database
  try {
    database = new URL(databaseUrl)
  }
  catch {
    throw new Error('Browser auth admin fixture input is invalid')
  }
  const passwordLength = typeof password === 'string'
    ? Array.from(password.normalize('NFC')).length
    : 0
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol)
    || database.username !== 'qianshu_ci'
    || database.password.length === 0
    || !['127.0.0.1', 'localhost'].includes(database.hostname)
    || database.pathname !== '/qianshu_ci'
    || database.search !== '?schema=public'
    || typeof username !== 'string'
    || !/^[a-z][a-z0-9_]{2,63}$/u.test(username)
    || typeof displayName !== 'string'
    || Array.from(displayName).length < 1
    || Array.from(displayName).length > 128
    || typeof password !== 'string'
    || passwordLength < 8
    || passwordLength > 20
  ) {
    throw new Error('Browser auth admin fixture input is invalid')
  }
  return { databaseUrl, displayName, password, username }
}

export function createProvisionCommand(input, sourceEnvironment = process.env) {
  return {
    args: [
      '-C', 'server', 'exec', 'node',
      '--input-type=commonjs',
      '--eval',
      bootstrapProgram,
    ],
    command: 'pnpm',
    env: {
      ...sourceEnvironment,
      DATABASE_URL: input.databaseUrl,
      DOTENV_CONFIG_PATH: '/dev/null',
      NODE_ENV: 'test',
      QIANSHU_BROWSER_AUTH_ADMIN_DISPLAY_NAME: input.displayName,
      QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD: input.password,
      QIANSHU_BROWSER_AUTH_ADMIN_USERNAME: input.username,
    },
  }
}

function executeProvisionCommand(definition) {
  return new Promise((resolve, reject) => {
    let child
    const diagnostics = []
    try {
      child = spawn(definition.command, definition.args, {
        env: definition.env,
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    }
    catch {
      reject(new Error('Browser auth admin fixture failed'))
      return
    }
    child.stderr?.on('data', chunk => diagnostics.push(Buffer.from(chunk)))
    child.once('error', () => reject(new ProvisionAdminError()))
    child.once('exit', code => (
      code === 0
        ? resolve()
        : reject(new ProvisionAdminError((() => {
            const candidate = Buffer.concat(diagnostics).toString('utf8')
            return /^[A-Z_]{1,64}$/u.test(candidate) ? candidate : 'UNKNOWN'
          })()))
    ))
  })
}

export async function provisionAdmin(environment = process.env) {
  const input = readProvisionInput(environment)
  await executeProvisionCommand(createProvisionCommand(input, environment))
}

if (isDirectEntry(import.meta.url)) {
  provisionAdmin().catch((error) => {
    const code = error instanceof ProvisionAdminError
      ? error.readonlyCode
      : 'UNKNOWN'
    console.error(`Browser auth admin fixture failed (${code})`)
    process.exitCode = 1
  })
}
