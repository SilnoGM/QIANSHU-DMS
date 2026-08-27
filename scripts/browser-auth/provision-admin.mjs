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

    // 产品媒体 Browser 验收使用四个固定最小权限身份。账号、角色和关联只存在
    // 于一次性 PostgreSQL，全部复用本次随机密码 hash，日志不输出任何凭据。
    const roleFixtures = [
      {
        code: 'browser_products_read',
        permissions: ['products:read', 'product-media:read'],
      },
      {
        code: 'browser_products_update',
        permissions: ['products:update'],
      },
      {
        code: 'browser_media_read',
        permissions: ['product-media:read'],
      },
      {
        code: 'browser_products_manage_no_media',
        permissions: ['products:read', 'products:update'],
      },
    ]
    for (const fixture of roleFixtures) {
      const fixtureRole = await client.query(
        [
          'INSERT INTO roles (code, name, description)',
          'VALUES ($1, $2, $3) RETURNING id',
        ].join(' '),
        [fixture.code, fixture.code, 'Browser ProductMedia RBAC fixture'],
      )
      const permissionRows = await client.query(
        [
          'INSERT INTO role_permissions (role_id, permission_id)',
          'SELECT $1, id FROM permissions WHERE code = ANY($2::text[])',
        ].join(' '),
        [fixtureRole.rows[0].id, fixture.permissions],
      )
      if (permissionRows.rowCount !== fixture.permissions.length) {
        throw new Error('product_media_permissions')
      }
      const fixtureUser = await client.query(
        [
          'INSERT INTO users (',
          'username, username_normalized, display_name, password_hash,',
          'status, must_change_password, password_changed_at, auth_version, updated_at',
          ') VALUES ($1, $1, $2, $3, \'ACTIVE\', false, clock_timestamp(), 0,',
          'clock_timestamp()) RETURNING id',
        ].join(' '),
        [fixture.code, fixture.code, passwordHash],
      )
      await client.query(
        'INSERT INTO user_profiles (user_id) VALUES ($1)',
        [fixtureUser.rows[0].id],
      )
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
        [fixtureUser.rows[0].id, fixtureRole.rows[0].id],
      )
    }

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

    // 销售订单 Browser 场景必须通过正式编号域在最终保存时派号。该规则与
    // PRODUCT 使用独立序列，确保打开表单和前端硬拦截阶段不会提前消耗编号。
    const salesOrderRule = await client.query(
      [
        'INSERT INTO numbering_rules (rule_code, name, status, version)',
        'VALUES (\'SALES_ORDER\', \'Browser Sales Order Rule\', \'DRAFT\', 1)',
        'RETURNING id',
      ].join(' '),
    )
    const salesOrderRuleVersion = await client.query(
      [
        'INSERT INTO numbering_rule_versions (',
        'rule_id, revision, status, reset_policy, timezone, config_fingerprint',
        ') VALUES ($1, 1, \'DRAFT\', \'NEVER\', \'Asia/Shanghai\', repeat(\'b\', 64))',
        'RETURNING id',
      ].join(' '),
      [salesOrderRule.rows[0].id],
    )
    await client.query(
      [
        'INSERT INTO numbering_rule_segments (',
        'version_id, position, type, fixed_value',
        ') VALUES',
        '($1, 0, \'FIXED\', \'SO\'),',
        '($1, 2, \'FIXED\', \'BRW\')',
      ].join(' '),
      [salesOrderRuleVersion.rows[0].id],
    )
    await client.query(
      [
        'INSERT INTO numbering_rule_segments (',
        'version_id, position, type, separator_value',
        ') VALUES',
        '($1, 1, \'SEPARATOR\', \'-\'),',
        '($1, 3, \'SEPARATOR\', \'-\')',
      ].join(' '),
      [salesOrderRuleVersion.rows[0].id],
    )
    await client.query(
      [
        'INSERT INTO numbering_rule_segments (',
        'version_id, position, type, sequence_width, sequence_start_value, sequence_step',
        ') VALUES ($1, 4, \'SEQUENCE\', 8, 1, 1)',
      ].join(' '),
      [salesOrderRuleVersion.rows[0].id],
    )
    await client.query(
      [
        'UPDATE numbering_rule_versions',
        'SET status = \'ACTIVE\', published_at = clock_timestamp()',
        'WHERE id = $1',
      ].join(' '),
      [salesOrderRuleVersion.rows[0].id],
    )
    await client.query(
      [
        'UPDATE numbering_rules SET status = \'ENABLED\', version = 3,',
        'updated_at = clock_timestamp() WHERE id = $1',
      ].join(' '),
      [salesOrderRule.rows[0].id],
    )

    // 管理域 Browser 场景保留独立的 4 图 2 视频只读样本；产品媒体专属场景使用
    // 另一条空媒体 Product，通过真实 API 写入，避免测试文件顺序影响验收结果。
    const managementProduct = await client.query(
      [
        'INSERT INTO products (',
        'name, product_no, status, supplier_value,',
        'twd_sale_price_amount, twd_sale_price_currency,',
        'myr_sale_price_amount, myr_sale_price_currency,',
        'purchase_cost_amount, purchase_cost_currency, attributes,',
        'created_by_user_id, updated_by_user_id, created_at, updated_at',
        ') VALUES (',
        '$1, \'PRODUCT-BROWSER-001\', \'ACTIVE\', \'BROWSER_SUPPLIER_EFFECTIVE\',',
        '1234.5678, \'TWD\', NULL, \'MYR\', 88.9, \'CNY\', $2::jsonb,',
        '$3, $3, clock_timestamp(), clock_timestamp()',
        ') RETURNING id',
      ].join(' '),
      [
        'Browser 多媒体产品',
        JSON.stringify([
          { title: '颜色', value: '墨黑' },
          { title: '尺寸', value: 'XL' },
        ]),
        user.rows[0].id,
      ],
    )
    const managementMedia = [
      {
        checksum: '1'.repeat(64),
        extension: 'png',
        filename: 'browser-management-main.png',
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'IMAGE',
        mimeType: 'image/png',
        sizeBytes: 106,
        sortOrder: 0,
      },
      {
        checksum: '2'.repeat(64),
        extension: 'png',
        filename: 'browser-management-detail.png',
        id: '22222222-2222-4222-8222-222222222222',
        kind: 'IMAGE',
        mimeType: 'image/png',
        sizeBytes: 106,
        sortOrder: 1,
      },
      {
        checksum: '3'.repeat(64),
        extension: 'webp',
        filename: 'browser-management-side.webp',
        id: '33333333-3333-4333-8333-333333333333',
        kind: 'IMAGE',
        mimeType: 'image/webp',
        sizeBytes: 44,
        sortOrder: 2,
      },
      {
        checksum: '4'.repeat(64),
        extension: 'webp',
        filename: 'browser-management-package.webp',
        id: '44444444-4444-4444-8444-444444444444',
        kind: 'IMAGE',
        mimeType: 'image/webp',
        sizeBytes: 44,
        sortOrder: 3,
      },
      {
        checksum: '5'.repeat(64),
        durationMs: 1000,
        extension: 'mp4',
        filename: 'browser-management-overview.mp4',
        id: '55555555-5555-4555-8555-555555555555',
        kind: 'VIDEO',
        mimeType: 'video/mp4',
        sizeBytes: 1695,
        sortOrder: 0,
        videoCodec: 'h264',
      },
      {
        checksum: '6'.repeat(64),
        durationMs: 1000,
        extension: 'mp4',
        filename: 'browser-management-detail.mp4',
        id: '66666666-6666-4666-8666-666666666666',
        kind: 'VIDEO',
        mimeType: 'video/mp4',
        sizeBytes: 1695,
        sortOrder: 1,
        videoCodec: 'h264',
      },
    ]
    for (const fixture of managementMedia) {
      await client.query(
        [
          'INSERT INTO media_assets (',
          'id, media_type, status, storage_driver, object_key, original_filename,',
          'mime_type, size_bytes, checksum_sha256, width, height, duration_ms,',
          'video_codec, created_by_user_id, created_at, updated_at',
          ') VALUES ($1, $2, \'READY\', \'local\', $3, $4, $5, $6, $7,',
          '16, 16, $8, $9, $10, clock_timestamp(), clock_timestamp())',
        ].join(' '),
        [
          fixture.id,
          fixture.kind,
          'assets/2026/08/' + fixture.id + '.' + fixture.extension,
          fixture.filename,
          fixture.mimeType,
          fixture.sizeBytes,
          fixture.checksum,
          fixture.durationMs ?? null,
          fixture.videoCodec ?? null,
          user.rows[0].id,
        ],
      )
      await client.query(
        [
          'INSERT INTO product_media (',
          'product_id, media_asset_id, kind, sort_order, is_primary,',
          'created_by_user_id, created_at, updated_at',
          ') VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp(), clock_timestamp())',
        ].join(' '),
        [
          managementProduct.rows[0].id,
          fixture.id,
          fixture.kind,
          fixture.sortOrder,
          fixture.kind === 'IMAGE' && fixture.sortOrder === 0,
          user.rows[0].id,
        ],
      )
    }
    await client.query(
      [
        'INSERT INTO products (',
        'name, product_no, status, supplier_value,',
        'twd_sale_price_amount, twd_sale_price_currency,',
        'myr_sale_price_amount, myr_sale_price_currency,',
        'purchase_cost_amount, purchase_cost_currency,',
        'created_by_user_id, updated_by_user_id, created_at, updated_at',
        ') VALUES (',
        '\'Browser ProductMedia E2E\', \'PRODUCT-MEDIA-BROWSER-001\', \'ACTIVE\',',
        '\'BROWSER_SUPPLIER_EFFECTIVE\', 100, \'TWD\', 10, \'MYR\', 20, \'CNY\',',
        '$1, $1, clock_timestamp() - interval \'30 seconds\',',
        'clock_timestamp() - interval \'30 seconds\')',
      ].join(' '),
      [user.rows[0].id],
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
        'clock_timestamp() - (interval \'4 minutes\' + (17 - series_no) * interval \'1 minute\'),',
        'clock_timestamp() - (interval \'4 minutes\' + (17 - series_no) * interval \'1 minute\')',
        'FROM generate_series(1, 16) AS fixture(series_no)',
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
