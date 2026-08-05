import process from 'node:process'

import {
  createBrowserDictionariesSensitiveValues,
  runBrowserDictionariesE2e,
  runProductionBrowserDictionariesE2e,
} from './ci-browser-dictionaries-e2e.mjs'
import { createBrowserRegionsPlan } from './ci-browser-regions-e2e.mjs'
import { isDirectEntry } from './run-command.mjs'

const supplierNumberingFixtureProgram = String.raw`
const { Client } = require('pg')

;(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const ruleResult = await client.query(
      [
        'INSERT INTO numbering_rules',
        '(rule_code, name, description)',
        "VALUES ('SUPPLIER', '供应商编号', 'Supplier Browser fixture only')",
        'RETURNING id',
      ].join(' '),
    )
    const ruleId = ruleResult.rows[0]?.id
    if (typeof ruleId !== 'string') throw new Error('supplier rule fixture')
    const versionResult = await client.query(
      [
        'INSERT INTO numbering_rule_versions',
        '(rule_id, revision, reset_policy, config_fingerprint)',
        "VALUES ($1, 1, 'NEVER', $2)",
        'RETURNING id',
      ].join(' '),
      [ruleId, 'a'.repeat(64)],
    )
    const versionId = versionResult.rows[0]?.id
    if (typeof versionId !== 'string') throw new Error('supplier version fixture')
    await client.query(
      [
        'INSERT INTO numbering_rule_segments',
        '(version_id, position, type, fixed_value, separator_value,',
        'sequence_width, sequence_start_value, sequence_step)',
        'VALUES',
        "($1, 0, 'FIXED', 'SUP', NULL, NULL, NULL, NULL),",
        "($1, 1, 'SEPARATOR', NULL, '-', NULL, NULL, NULL),",
        "($1, 2, 'SEQUENCE', NULL, NULL, 6, 1, 1)",
      ].join(' '),
      [versionId],
    )
    await client.query(
      [
        'UPDATE numbering_rule_versions',
        "SET status = 'ACTIVE', published_at = CURRENT_TIMESTAMP",
        'WHERE id = $1',
      ].join(' '),
      [versionId],
    )
    await client.query(
      "UPDATE numbering_rules SET status = 'ENABLED' WHERE id = $1",
      [ruleId],
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
})().catch(() => {
  process.stderr.write('SUPPLIER_FIXTURE_FAILED')
  process.exit(1)
})
`

const databaseVerificationProgram = String.raw`
const { Client } = require('pg')

const expectedEvents = [
  'SUPPLIER_CREATED',
  'SUPPLIER_UPDATED',
  'SUPPLIER_ENABLED',
  'SUPPLIER_DISABLED',
]

;(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const supplierResult = await client.query(
      [
        'SELECT id, code, legal_name, short_name, entity_type,',
        'registration_country_region_id, registration_number,',
        'contact_name, contact_phone, contact_wechat_id,',
        'address_country_region_id, address_province_state_id, address_city_id,',
        'address_line, postal_code, remark, enabled, version, numbering_issuance_id',
        'FROM suppliers',
      ].join(' '),
    )
    const supplier = supplierResult.rows[0]
    if (
      supplierResult.rowCount !== 1
      || !/^SUP-[0-9]{6}$/u.test(supplier?.code ?? '')
      || supplier.legal_name !== '浏览器供应商已编辑'
      || supplier.short_name !== '浏览器供方'
      || supplier.entity_type !== 'ORGANIZATION'
      || supplier.registration_country_region_id !== null
      || supplier.registration_number !== null
      || supplier.contact_name !== '林联系'
      || supplier.contact_phone !== '13800138000'
      || supplier.contact_wechat_id !== 'supplier_wechat'
      || supplier.address_country_region_id !== null
      || supplier.address_province_state_id !== null
      || supplier.address_city_id !== null
      || supplier.address_line !== null
      || supplier.postal_code !== null
      || supplier.remark !== '浏览器供应商备注已编辑'
      || supplier.enabled !== false
      || supplier.version !== 4
    ) {
      throw new Error('supplier state')
    }

    const intentResult = await client.query(
      [
        'SELECT supplier_id FROM supplier_create_requests',
        'WHERE supplier_id = $1',
      ].join(' '),
      [supplier.id],
    )
    if (intentResult.rowCount !== 1) throw new Error('supplier create intent')

    const issuanceResult = await client.query(
      [
        'SELECT generated_number, consumer_code FROM numbering_issuances',
        'WHERE id = $1',
      ].join(' '),
      [supplier.numbering_issuance_id],
    )
    const issuance = issuanceResult.rows[0]
    if (
      issuanceResult.rowCount !== 1
      || issuance.generated_number !== supplier.code
      || issuance.consumer_code !== 'SUPPLIER.CREATE'
    ) {
      throw new Error('supplier numbering issuance')
    }

    const auditResult = await client.query(
      [
        'SELECT event_type, request_id, target_type, target_id, metadata',
        'FROM audit_events',
        'WHERE target_type = $1 AND target_id = $2',
        'ORDER BY occurred_at ASC, id ASC',
      ].join(' '),
      ['Supplier', supplier.id],
    )
    if (
      auditResult.rowCount !== expectedEvents.length
      || JSON.stringify(auditResult.rows.map(row => row.event_type))
        !== JSON.stringify(expectedEvents)
      || auditResult.rows.some(row => (
        typeof row.request_id !== 'string'
        || row.request_id.length === 0
        || row.target_id !== supplier.id
        || row.metadata?.supplierCode !== supplier.code
      ))
    ) {
      throw new Error('supplier audit state')
    }
  }
  finally {
    await client.end()
  }
})().catch(() => {
  process.stderr.write('DATABASE_VERIFICATION_FAILED')
  process.exit(1)
})
`

function boundaryError() {
  return new Error(
    'Browser suppliers E2E database URL is outside the isolated boundary',
  )
}

/** 只接受根级 ci-postgres 注入的固定本机数据库边界。 */
export function validateBrowserSuppliersDatabaseUrl(rawValue) {
  let parsed
  try {
    parsed = new URL(rawValue)
  }
  catch {
    throw boundaryError()
  }
  const query = [...parsed.searchParams.entries()]
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || parsed.username !== 'qianshu_ci'
    || parsed.password.length === 0
    || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || !/^\d{1,5}$/u.test(parsed.port)
    || parsed.pathname !== '/qianshu_ci'
    || parsed.hash !== ''
    || JSON.stringify(query) !== JSON.stringify([['schema', 'public']])
  ) {
    throw boundaryError()
  }
  return rawValue
}

/**
 * 复用已审计的 Browser 认证/地区运行时，只插入隔离 SUPPLIER 规则夹具、供应商
 * runner 和终态核验。测试规则永不接触真实环境，也不修改正式规则定义。
 */
export function createBrowserSuppliersPlan(input) {
  const sourceEnv = { ...(input.sourceEnv ?? process.env) }
  for (const key of [
    'AUTH_IP_HMAC_KEY',
    'AUTH_USER_ID_HMAC_KEY',
    'AUTH_USERNAME_HMAC_KEY',
    'QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD',
    'QIANSHU_BROWSER_DICTIONARIES_LIMITED_PASSWORD',
    'QIANSHU_BROWSER_SUPPLIERS_LIMITED_PASSWORD',
  ]) {
    delete sourceEnv[key]
  }
  const basePlan = createBrowserRegionsPlan({ ...input, sourceEnv })
  const supplierFixture = Object.freeze({
    name: 'supplier-numbering-fixture',
    command: 'pnpm',
    args: Object.freeze([
      '-C', 'server', 'exec', 'node',
      '--input-type=commonjs',
      '--eval',
      supplierNumberingFixtureProgram,
    ]),
    env: basePlan.prepare[0].env,
  })
  return Object.freeze({
    prepare: Object.freeze([
      basePlan.prepare[0],
      supplierFixture,
      ...basePlan.prepare.slice(1),
    ]),
    services: basePlan.services,
    runner: Object.freeze({
      ...basePlan.runner,
      args: Object.freeze(['-C', 'web', 'test:browser:suppliers']),
      env: Object.freeze({
        ...basePlan.runner.env,
        QIANSHU_BROWSER_SUPPLIERS_LIMITED_PASSWORD:
          input.secrets.limitedPassword,
      }),
    }),
    verify: Object.freeze([
      Object.freeze({
        name: 'suppliers-database-verification',
        command: 'pnpm',
        args: Object.freeze([
          '-C', 'server', 'exec', 'node',
          '--input-type=commonjs',
          '--eval',
          databaseVerificationProgram,
        ]),
        env: basePlan.prepare[0].env,
      }),
    ]),
  })
}

export function createBrowserSuppliersSensitiveValues(databaseUrl, secrets) {
  return createBrowserDictionariesSensitiveValues(databaseUrl, secrets)
}

export async function runBrowserSuppliersE2e(input) {
  return runBrowserDictionariesE2e(input)
}

export async function runProductionBrowserSuppliersE2e() {
  return runProductionBrowserDictionariesE2e({
    databaseValidator: validateBrowserSuppliersDatabaseUrl,
    planFactory: createBrowserSuppliersPlan,
    sensitiveValuesFactory: createBrowserSuppliersSensitiveValues,
    sessionPrefix: 'qianshu-browser-suppliers-e2e-',
  })
}

if (isDirectEntry(import.meta.url)) {
  runProductionBrowserSuppliersE2e().catch((error) => {
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1
    console.error(
      typeof error?.message === 'string'
        ? error.message
        : 'Browser suppliers E2E failed unexpectedly',
    )
  })
}
