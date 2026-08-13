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

    // 产品列表浏览器验收只向本次隔离数据库写夹具。供应商沿用正式字典身份，
    // 先创建 Item 再启用 Type，以满足数据库的“启用字典至少一个启用项”约束。
    const supplierType = await client.query(
      'SELECT id FROM dictionary_types WHERE code = $1 FOR UPDATE',
      ['service_provider.supplier'],
    )
    if (supplierType.rowCount !== 1) throw new Error('supplier_dictionary')
    await client.query(
      [
        'INSERT INTO dictionary_items (',
        'dictionary_type_id, value, label, tone, enabled, sort_order',
        ') VALUES',
        '($1, \'BROWSER_SUPPLIER_EFFECTIVE\', \'Browser 有效供应商\', \'SUCCESS\', true, 10),',
        '($1, \'BROWSER_SUPPLIER_DISABLED\', \'Browser 停用供应商\', \'WARNING\', false, 20)',
      ].join(' '),
      [supplierType.rows[0].id],
    )
    await client.query(
      'UPDATE dictionary_types SET enabled = true, updated_at = clock_timestamp() WHERE id = $1',
      [supplierType.rows[0].id],
    )

    // 创建页必须从真实 Currency Catalog 取得 TWD/MYR/CNY。外币先建立当前汇率
    // 再启用，严格遵守数据库 trigger 的顺序约束；数据只存在于一次性 Browser 库。
    const productCurrencies = await client.query(
      'SELECT id, code FROM currencies WHERE code IN (\'TWD\', \'MYR\') ORDER BY code FOR UPDATE',
    )
    if (productCurrencies.rowCount !== 2) throw new Error('product_currencies')
    await client.query(
      [
        'INSERT INTO exchange_rates (currency_id, foreign_units_per_cny)',
        'SELECT id, 1 FROM currencies WHERE code IN (\'TWD\', \'MYR\')',
      ].join(' '),
    )
    await client.query(
      [
        'UPDATE currencies SET enabled = true, updated_at = clock_timestamp()',
        'WHERE code IN (\'TWD\', \'MYR\')',
      ].join(' '),
    )

    // PRODUCT 创建只能消费已发布且启用的真实编号规则。先在 DRAFT 父版本下写入
    // 片段，再按 DRAFT -> ACTIVE 与规则 ENABLED 的合法顺序完成 fixture。
    const productRule = await client.query(
      [
        'INSERT INTO numbering_rules (rule_code, name, status, version)',
        'VALUES (\'PRODUCT\', \'Browser Product Rule\', \'DRAFT\', 1)',
        'RETURNING id',
      ].join(' '),
    )
    const productRuleVersion = await client.query(
      [
        'INSERT INTO numbering_rule_versions (',
        'rule_id, revision, status, reset_policy, timezone, config_fingerprint',
        ') VALUES ($1, 1, \'DRAFT\', \'NEVER\', \'Asia/Shanghai\', repeat(\'a\', 64))',
        'RETURNING id',
      ].join(' '),
      [productRule.rows[0].id],
    )
    await client.query(
      [
        'INSERT INTO numbering_rule_segments (',
        'version_id, position, type, fixed_value',
        ') VALUES',
        '($1, 0, \'FIXED\', \'PRD\'),',
        '($1, 2, \'FIXED\', \'BRW\')',
      ].join(' '),
      [productRuleVersion.rows[0].id],
    )
    await client.query(
      [
        'INSERT INTO numbering_rule_segments (',
        'version_id, position, type, separator_value',
        ') VALUES',
        '($1, 1, \'SEPARATOR\', \'-\'),',
        '($1, 3, \'SEPARATOR\', \'-\')',
      ].join(' '),
      [productRuleVersion.rows[0].id],
    )
    await client.query(
      [
        'INSERT INTO numbering_rule_segments (',
        'version_id, position, type, sequence_width, sequence_start_value, sequence_step',
        ') VALUES ($1, 4, \'SEQUENCE\', 8, 1, 1)',
      ].join(' '),
      [productRuleVersion.rows[0].id],
    )
    await client.query(
      [
        'UPDATE numbering_rule_versions',
        'SET status = \'ACTIVE\', published_at = clock_timestamp()',
        'WHERE id = $1',
      ].join(' '),
      [productRuleVersion.rows[0].id],
    )
    await client.query(
      [
        'UPDATE numbering_rules SET status = \'ENABLED\', version = 3,',
        'updated_at = clock_timestamp() WHERE id = $1',
      ].join(' '),
      [productRule.rows[0].id],
    )

    const browserImage = [
      'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22',
      ' width=%2280%22 height=%2280%22 viewBox=%220 0 80 80%22%3E',
      '%3Crect width=%2280%22 height=%2280%22 rx=%2212%22 fill=%22%232563eb%22/%3E',
      '%3Ccircle cx=%2240%22 cy=%2240%22 r=%2218%22 fill=%22white%22/%3E%3C/svg%3E',
    ].join('')
    await client.query(
      [
        'INSERT INTO products (',
        'name, product_no, status, supplier_value, main_image, images, videos,',
        'twd_sale_price_amount, twd_sale_price_currency,',
        'myr_sale_price_amount, myr_sale_price_currency,',
        'purchase_cost_amount, purchase_cost_currency, attributes,',
        'created_by_user_id, updated_by_user_id, created_at, updated_at',
        ') VALUES (',
        '$1, \'PRODUCT-BROWSER-001\', \'ACTIVE\', \'BROWSER_SUPPLIER_EFFECTIVE\',',
        '$2, $3, $4, 1234.5678, \'TWD\', NULL, \'MYR\', 88.9, \'CNY\', $5::jsonb,',
        '$6, $6, clock_timestamp(), clock_timestamp()',
        ')',
      ].join(' '),
      [
        'Browser 多媒体产品',
        browserImage,
        [browserImage, browserImage, browserImage, browserImage],
        ['https://example.test/browser-product.mp4', 'javascript:alert(1)'],
        JSON.stringify([
          { title: '颜色', value: '墨黑' },
          { title: '尺寸', value: 'XL' },
        ]),
        user.rows[0].id,
      ],
    )
    await client.query(
      [
        'INSERT INTO products (',
        'name, product_no, status, supplier_value, purchase_cost_amount,',
        'purchase_cost_currency, created_by_user_id, updated_by_user_id, created_at, updated_at',
        ') VALUES',
        '(\'Browser 停用供应商产品\', \'PRODUCT-BROWSER-002\', \'INACTIVE\',',
        '\'BROWSER_SUPPLIER_DISABLED\', 10.5, \'ZZZ\', $1, $1,',
        'clock_timestamp() - interval \'1 minute\', clock_timestamp() - interval \'1 minute\'),',
        '(\'Browser 未知供应商产品\', \'PRODUCT-BROWSER-003\', \'INACTIVE\',',
        '\'BROWSER_SUPPLIER_UNKNOWN\', NULL, \'CNY\', $1, $1,',
        'clock_timestamp() - interval \'2 minutes\', clock_timestamp() - interval \'2 minutes\'),',
        '(\'Browser 草稿产品\', \'PRODUCT-BROWSER-004\', \'DRAFT\',',
        'NULL, NULL, \'CNY\', $1, $1,',
        'clock_timestamp() - interval \'3 minutes\', clock_timestamp() - interval \'3 minutes\')',
      ].join(' '),
      [user.rows[0].id],
    )
    await client.query(
      [
        'INSERT INTO products (',
        'name, product_no, status, supplier_value, created_by_user_id, updated_by_user_id,',
        'created_at, updated_at',
        ') SELECT',
        '\'Browser 填充分页产品 \' || lpad(series_no::text, 2, \'0\'),',
        '\'PRODUCT-BROWSER-FILLER-\' || lpad(series_no::text, 2, \'0\'),',
        '\'DRAFT\', NULL, $1, $1,',
        'clock_timestamp() - (interval \'4 minutes\' + (18 - series_no) * interval \'1 minute\'),',
        'clock_timestamp() - (interval \'4 minutes\' + (18 - series_no) * interval \'1 minute\')',
        'FROM generate_series(1, 17) AS fixture(series_no)',
      ].join(' '),
      [user.rows[0].id],
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
