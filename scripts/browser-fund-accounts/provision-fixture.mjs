import { spawn } from 'node:child_process'
import process from 'node:process'

import { isDirectEntry } from '../run-command.mjs'

const bootstrapProgram = String.raw`
const argon2 = require('argon2')
const { randomBytes, randomUUID } = require('node:crypto')
const { Client } = require('pg')

let fixtureStage = 'PASSWORD'

const FLOW_USER_ID = '10000000-0000-4000-8000-000000000001'
const LEDGER_USER_ID = '10000000-0000-4000-8000-000000000002'
const LIMITED_USER_ID = '10000000-0000-4000-8000-000000000003'
const LEDGER_ACCOUNT_ID = '20000000-0000-4000-8000-000000000002'
const SOURCE_ID = '30000000-0000-4000-8000-000000000001'
const PROFIT_BATCH_ID = '40000000-0000-4000-8000-000000000001'
const LOSS_BATCH_ID = '40000000-0000-4000-8000-000000000002'
const COMPANY_ACCOUNT_ID = '00000000-0000-4000-8000-000000002001'
const ORDER_TYPE_ID = '00000000-0000-4000-8000-000000002201'
const ORDER_RULE_ID = '00000000-0000-4000-8000-000000002301'

/**
 * 直写 SQL 的资金批次必须同时登记与 batch_no 一致的 FUND_POSTING 发号记录，
 * 否则 20261017120000 迁移建立的 BEFORE INSERT 身份触发器会拒绝夹具。
 */
async function insertFundPostingBatchIssuance(client, generatedNumber) {
  const rule = await client.query([
    'SELECT rule."id" AS "ruleId",',
    'version."id" AS "versionId",',
    'to_char(transaction_timestamp() AT TIME ZONE \'Asia/Shanghai\', \'YYYY\') AS "periodKey"',
    'FROM "numbering_rules" AS rule',
    'JOIN "numbering_rule_versions" AS version',
    'ON version."rule_id" = rule."id" AND version."status" = \'ACTIVE\'',
    'WHERE rule."rule_code" = \'FUND_POSTING_BATCH_NO\'',
    'AND rule."status" = \'ENABLED\' AND rule."purpose" = \'BUSINESS\'',
    'LIMIT 1',
  ].join(' '))
  const row = rule.rows[0]
  if (!row) throw new Error('FUND_POSTING_BATCH_NO is unavailable')

  await client.query([
    'INSERT INTO "numbering_period_states" (',
    '"rule_id", "period_key", "next_sequence_value", "used_count"',
    ') VALUES ($1, $2, NULL, 0)',
    'ON CONFLICT ("rule_id", "period_key") DO NOTHING',
  ].join(' '), [row.ruleId, row.periodKey])

  const issuanceId = randomUUID()
  await client.query([
    'INSERT INTO "numbering_issuances" (',
    '"id", "rule_id", "rule_version_id", "period_key",',
    '"generated_number", "sequence_value", "consumer_code",',
    '"idempotency_key_hash", "request_fingerprint_hash"',
    ') VALUES ($1, $2, $3, $4, $5, NULL, \'FUND_POSTING\', $6, $7)',
  ].join(' '), [
    issuanceId,
    row.ruleId,
    row.versionId,
    row.periodKey,
    generatedNumber,
    randomBytes(32),
    randomBytes(32),
  ])
  return issuanceId
}

;(async () => {
  const passwordHash = await argon2.hash(
    process.env.QIANSHU_BROWSER_FUND_LIMITED_PASSWORD.normalize('NFC'),
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
    fixtureStage = 'USERS'
    const users = [
      [FLOW_USER_ID, 'fund_browser_flow_user', '资金浏览器调账用户'],
      [LEDGER_USER_ID, 'fund_browser_ledger_user', '资金浏览器流水用户'],
      [LIMITED_USER_ID, 'fund_browser_limited', '资金浏览器无权限用户'],
    ]
    for (const [id, username, displayName] of users) {
      await client.query(
        [
          'INSERT INTO users (',
          'id, username, username_normalized, display_name, password_hash,',
          'status, must_change_password, password_changed_at, auth_version,',
          'updated_at',
          ') VALUES ($1, $2, $2, $3, $4, \'ACTIVE\', false,',
          'clock_timestamp(), 0, clock_timestamp())',
        ].join(' '),
        [id, username, displayName, passwordHash],
      )
      await client.query(
        'INSERT INTO user_profiles (user_id) VALUES ($1)',
        [id],
      )
    }

    fixtureStage = 'LEDGER_ACCOUNT'
    await client.query(
      [
        'INSERT INTO fund_accounts (',
        'id, owner_type, user_id, currency, balance, user_share_rate,',
        'next_sequence, version, share_rate_updated_at',
        ') VALUES ($1, \'USER\', $2, \'CNY\', 15, 30, 3, 3,',
        'clock_timestamp())',
      ].join(' '),
      [LEDGER_ACCOUNT_ID, LEDGER_USER_ID],
    )
    fixtureStage = 'BUSINESS_SOURCE'
    await client.query(
      [
        'INSERT INTO fund_business_sources (',
        'id, code, name, description, enabled, version',
        ') VALUES ($1, \'BROWSER_ORDER_DOMAIN\', \'浏览器订单域\',',
        '\'仅用于一次性资金账户 Browser fixture\', true, 1)',
      ].join(' '),
      [SOURCE_ID],
    )
    fixtureStage = 'SOURCE_AUTHORIZATION'
    await client.query(
      [
        'INSERT INTO fund_business_source_posting_types (',
        'business_source_id, posting_type_id',
        ') VALUES ($1, $2)',
      ].join(' '),
      [SOURCE_ID, ORDER_TYPE_ID],
    )

    const batches = [
      {
        amount: '100.00',
        batchId: PROFIT_BATCH_ID,
        batchNo: 'FB_BROWSER_PROFIT',
        businessId: 'browser-order-profit',
        businessNo: 'E2E-ORDER-PROFIT',
        companyAmount: '70.00',
        companyAfter: '70.00',
        companyBefore: '0.00',
        direction: 'CREDIT',
        hashByte: '11',
        sequence: 1,
        summary: 'Browser 正收益订单结算',
        userAmount: '30.00',
        userAfter: '30.00',
        userBefore: '0.00',
      },
      {
        amount: '-50.00',
        batchId: LOSS_BATCH_ID,
        batchNo: 'FB_BROWSER_LOSS',
        businessId: 'browser-order-loss',
        businessNo: 'E2E-ORDER-LOSS',
        companyAmount: '35.00',
        companyAfter: '35.00',
        companyBefore: '70.00',
        direction: 'DEBIT',
        hashByte: '22',
        sequence: 2,
        summary: 'Browser 负收益订单结算',
        userAmount: '15.00',
        userAfter: '15.00',
        userBefore: '30.00',
      },
    ]
    for (const batch of batches) {
      fixtureStage = 'POSTING_BATCH'
      const numberingIssuanceId =
        await insertFundPostingBatchIssuance(client, batch.batchNo)
      await client.query(
        [
          'INSERT INTO fund_posting_batches (',
          'id, batch_no, numbering_issuance_id, kind, posting_type_id,',
          'posting_type_code_snapshot, posting_type_name_snapshot,',
          'business_category_snapshot, business_source_id,',
          'business_source_code_snapshot, business_source_name_snapshot,',
          'rule_version_id, rule_revision_snapshot, user_id, business_amount,',
          'user_share_rate_snapshot, company_share_rate_snapshot,',
          'business_id, business_no, summary, metadata, business_occurred_at,',
          'consumer_code, idempotency_key_hash, request_fingerprint_hash,',
          'request_id, posted_at',
          ') VALUES (',
          '$1, $2, $15, \'BUSINESS\', $3, \'ORDER_SETTLEMENT\', \'订单结算\',',
          '\'REVENUE\', $4, \'BROWSER_ORDER_DOMAIN\', \'浏览器订单域\',',
          '$5, 1, $6, $7, 30, 70, $8, $9, $10,',
          'jsonb_build_object(\'fixture\', true),',
          'clock_timestamp() - ($11::integer * interval \'1 minute\'),',
          '\'BROWSER_ORDER_CONSUMER\', decode(repeat($12, 32), \'hex\'),',
          'decode(repeat($13, 32), \'hex\'), $14,',
          'clock_timestamp() - ($11::integer * interval \'1 minute\')',
          ')',
        ].join(' '),
        [
          batch.batchId,
          batch.batchNo,
          ORDER_TYPE_ID,
          SOURCE_ID,
          ORDER_RULE_ID,
          LEDGER_USER_ID,
          batch.amount,
          batch.businessId,
          batch.businessNo,
          batch.summary,
          batch.sequence === 1 ? 2 : 1,
          batch.hashByte,
          batch.hashByte === '11' ? 'aa' : 'bb',
          'browser_fixture_' + batch.sequence,
          numberingIssuanceId,
        ],
      )
      fixtureStage = 'LEDGER_ENTRIES'
      await client.query(
        [
          'INSERT INTO fund_ledger_entries (',
          'batch_id, line_no, account_id, direction, account_target,',
          'amount_strategy, amount, balance_before, balance_after,',
          'account_sequence, posted_at',
          ') VALUES',
          '($1, 1, $2, $3, \'USER\', \'USER_SHARE\', $4, $5, $6, $7,',
          'clock_timestamp() - ($7::bigint * interval \'1 minute\')),',
          '($1, 2, $8, $3, \'COMPANY\', \'COMPANY_REMAINDER\', $9, $10,',
          '$11, $7, clock_timestamp() - ($7::bigint * interval \'1 minute\'))',
        ].join(' '),
        [
          batch.batchId,
          LEDGER_ACCOUNT_ID,
          batch.direction,
          batch.userAmount,
          batch.userBefore,
          batch.userAfter,
          batch.sequence,
          COMPANY_ACCOUNT_ID,
          batch.companyAmount,
          batch.companyBefore,
          batch.companyAfter,
        ],
      )
      fixtureStage = 'AUDIT_EVENT'
      await client.query(
        [
          'INSERT INTO audit_events (',
          'event_type, outcome, actor_type, actor_user_id, target_type,',
          'target_id, request_id, metadata',
          ') VALUES (\'FUND_BUSINESS_POSTED\', \'SUCCESS\', \'SYSTEM\', NULL,',
          '\'FundPostingBatch\', $1, $2,',
          'jsonb_build_object(\'businessNo\', $3::text))',
        ].join(' '),
        [batch.batchId, 'browser_fixture_audit_' + batch.sequence, batch.businessNo],
      )
    }

    fixtureStage = 'COMPANY_ACCOUNT'
    await client.query(
      [
        'UPDATE fund_accounts SET balance = 35, next_sequence = 3,',
        'version = 3, updated_at = clock_timestamp()',
        'WHERE id = $1',
      ].join(' '),
      [COMPANY_ACCOUNT_ID],
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
  // 仅输出 PostgreSQL 的结构化 constraint 名；不输出 message、SQL 或参数，
  // 既能定位一次性夹具漂移，也不会把连接串和测试凭据带入 CI 日志。
  const constraint = typeof error?.constraint === 'string'
    && /^[a-z0-9_]{1,64}$/u.test(error.constraint)
    ? error.constraint.toUpperCase()
    : [
        'FUND_FIXTURE_FAILED',
        fixtureStage,
        typeof error?.code === 'string' && /^[A-Z0-9]{5}$/u.test(error.code)
          ? error.code
          : 'UNKNOWN',
      ].join('_')
  process.stderr.write(constraint.slice(0, 64))
  process.exit(1)
})
`

class ProvisionFundFixtureError extends Error {
  constructor(readonlyCode = 'UNKNOWN') {
    super('Browser fund accounts fixture failed')
    this.name = 'ProvisionFundFixtureError'
    this.readonlyCode = readonlyCode
  }
}

export function readFundFixtureInput(environment) {
  const databaseUrl = environment.DATABASE_URL
  const password = environment.QIANSHU_BROWSER_FUND_LIMITED_PASSWORD
  let database
  try {
    database = new URL(databaseUrl)
  }
  catch {
    throw new Error('Browser fund accounts fixture input is invalid')
  }
  const passwordLength = typeof password === 'string'
    ? Array.from(password.normalize('NFC')).length
    : 0
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol)
    || database.username !== 'qianshu_ci'
    || database.password.length === 0
    || !['127.0.0.1', 'localhost'].includes(database.hostname)
    || !/^\d{1,5}$/u.test(database.port)
    || database.pathname !== '/qianshu_ci'
    || database.search !== '?schema=public'
    || typeof password !== 'string'
    || passwordLength < 8
    || passwordLength > 20
  ) {
    throw new Error('Browser fund accounts fixture input is invalid')
  }
  return { databaseUrl, password }
}

export function createFundFixtureCommand(input, sourceEnvironment = process.env) {
  return {
    args: [
      '-C', 'server', 'exec', 'node',
      '--input-type=commonjs', '--eval', bootstrapProgram,
    ],
    command: 'pnpm',
    env: {
      ...sourceEnvironment,
      DATABASE_URL: input.databaseUrl,
      DOTENV_CONFIG_PATH: '/dev/null',
      NODE_ENV: 'test',
      QIANSHU_BROWSER_FUND_LIMITED_PASSWORD: input.password,
    },
  }
}

function executeFundFixtureCommand(definition) {
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
      reject(new ProvisionFundFixtureError())
      return
    }
    child.stderr?.on('data', chunk => diagnostics.push(Buffer.from(chunk)))
    child.once('error', () => reject(new ProvisionFundFixtureError()))
    child.once('exit', code => (
      code === 0
        ? resolve()
        : reject(new ProvisionFundFixtureError((() => {
            const candidate = Buffer.concat(diagnostics).toString('utf8')
            return /^[A-Z0-9_]{1,64}$/u.test(candidate) ? candidate : 'UNKNOWN'
          })()))
    ))
  })
}

export async function provisionFundFixture(environment = process.env) {
  const input = readFundFixtureInput(environment)
  await executeFundFixtureCommand(createFundFixtureCommand(input, environment))
}

if (isDirectEntry(import.meta.url)) {
  provisionFundFixture().catch((error) => {
    const code = error instanceof ProvisionFundFixtureError
      ? error.readonlyCode
      : 'UNKNOWN'
    console.error(`Browser fund accounts fixture failed (${code})`)
    process.exitCode = 1
  })
}
