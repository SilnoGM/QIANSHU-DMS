import process from 'node:process'

import { validateBrowserAuthDatabaseUrl } from '../ci-browser-auth-e2e.mjs'
import { isDirectEntry, runCommand } from '../run-command.mjs'

/** 只为一次性浏览器库建立当前付款前置；不得作为业务历史应付回填工具。 */
export async function provisionBrowserPaymentFixtures(client) {
  await client.query('BEGIN')
  try {
    const migration = await client.query(`
      SELECT migration_name FROM _prisma_migrations
      WHERE migration_name = '20260918030032_packaging_cost_amount_update'
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL
    `)
    if (migration.rowCount !== 1) throw new Error('PAYMENT_FIXTURE_MIGRATIONS_REQUIRED')
    const actor = await client.query(`
      SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.username = 'browser_admin' AND u.status = 'ACTIVE' AND r.code = 'system_admin'
    `)
    if (actor.rowCount !== 1) throw new Error('PAYMENT_FIXTURE_ADMIN_REQUIRED')
    const dictionary = await client.query(`
      SELECT item.value FROM dictionary_items item JOIN dictionary_types type ON type.id = item.dictionary_type_id
      WHERE type.enabled AND item.enabled AND (
        (type.code = 'service_provider.supplier' AND item.value = 'BROWSER_SUPPLIER_EFFECTIVE')
        OR (type.code = 'payment.method' AND item.value = 'BANK_TRANSFER'))
    `)
    if (dictionary.rowCount !== 2) throw new Error('PAYMENT_FIXTURE_DICTIONARIES_REQUIRED')
    // 真实迁移已建立资金来源、已发布规则及零余额公司账户；这里仅核验，不伪造流水或余额。
    const funds = await client.query(`
      SELECT type.id FROM fund_posting_types type
      JOIN fund_posting_rule_versions rule ON rule.id = type.current_rule_version_id AND rule.posting_type_id = type.id
      JOIN fund_business_source_posting_types binding ON binding.posting_type_id = type.id
      JOIN fund_business_sources source ON source.id = binding.business_source_id
      WHERE type.code = 'PURCHASE_PAYMENT' AND type.enabled AND type.requires_user
        AND type.business_category = 'COST' AND rule.status = 'ACTIVE'
        AND source.code = 'PURCHASE_PAYMENT' AND source.enabled
        AND EXISTS (SELECT 1 FROM fund_accounts WHERE owner_type = 'COMPANY' AND currency = 'CNY' AND user_id IS NULL)
    `)
    if (funds.rowCount !== 1) throw new Error('PAYMENT_FIXTURE_FUNDS_REQUIRED')
    const orders = await client.query(`
      SELECT id, order_no FROM purchase_orders
      WHERE order_no IN ('PO-BRW-MIXED-ACTIVE', 'PO-BRW-MIXED-CANCEL')
        AND purchase_type = 'STOCK' AND product_mode = 'MIXED' AND order_status = 'CONFIRMED'
        AND supplier_value = 'BROWSER_SUPPLIER_EFFECTIVE'
        AND purchase_total_amount = 30 AND deposit_due_amount = 10 AND balance_due_amount = 20
        AND NOT EXISTS (SELECT 1 FROM purchase_order_payments p WHERE p.purchase_order_id = purchase_orders.id)
        AND NOT EXISTS (SELECT 1 FROM purchase_order_payables p WHERE p.purchase_order_id = purchase_orders.id)
      ORDER BY order_no
    `)
    if (orders.rowCount !== 2) throw new Error('PAYMENT_FIXTURE_ORDERS_REQUIRED')
    const profile = await client.query(`
      INSERT INTO payment_recipient_profiles (supplier_value, created_by_user_id, updated_by_user_id)
      VALUES ('BROWSER_SUPPLIER_EFFECTIVE', $1, $1) RETURNING id
    `, [actor.rows[0].id])
    await client.query(`
      INSERT INTO payment_recipient_accounts (profile_id, payment_method, recipient_name, bank_name, bank_account)
      VALUES ($1, 'BANK_TRANSFER', 'Browser 收款人', 'Browser 银行', '6222000000000000')
    `, [profile.rows[0].id])
    // 只给两笔已冻结的测试订单建立当前应付，历史订单、发货事实与时间均保持不变。
    // 两阶段同事务写入，提交前执行全部真实约束；不关闭触发器、不回填实际付款。
    for (const order of orders.rows) {
      await client.query(`
        INSERT INTO purchase_order_payables (purchase_order_id, payment_type, due_amount, account_owner_type, created_by_user_id)
        VALUES ($1, 'DEPOSIT', 10, 'COMPANY', $2), ($1, 'BALANCE', 20, 'COMPANY', $2)
      `, [order.id, actor.rows[0].id])
    }
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    await client.query('COMMIT')
  }
  catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

export function createPaymentFixtureCommand(environment = process.env) {
  const databaseUrl = validateBrowserAuthDatabaseUrl(environment.DATABASE_URL)
  if (environment.NODE_ENV !== 'test') throw new Error('Browser payment fixture requires test mode')
  const program = `
    const { Client } = require('pg')
    const provision = ${provisionBrowserPaymentFixtures.toString()}
    ;(async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL })
      await client.connect()
      try { await provision(client) }
      finally { await client.end() }
    })().catch(error => {
      const code = /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message
        : /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'UNKNOWN'
      console.error('Browser payment fixture failed (' + code + ')')
      process.exitCode = 1
    })
  `
  return {
    command: 'pnpm',
    args: ['-C', 'server', 'exec', 'node', '--input-type=commonjs', '--eval', program],
    env: { ...environment, DATABASE_URL: databaseUrl, DOTENV_CONFIG_PATH: '/dev/null', NODE_ENV: 'test' },
  }
}

if (isDirectEntry(import.meta.url)) {
  try {
    const definition = createPaymentFixtureCommand()
    await runCommand(definition.command, definition.args, { env: definition.env })
  }
  catch {
    console.error('Browser payment fixture preparation failed')
    process.exitCode = 1
  }
}
