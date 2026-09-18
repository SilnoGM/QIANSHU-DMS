import assert from 'node:assert/strict'
import test from 'node:test'
import { Script } from 'node:vm'

import { createPaymentFixtureCommand, provisionBrowserPaymentFixtures } from './browser-auth/provision-payment-fixtures.mjs'

const databaseUrl = 'postgresql://qianshu_ci:test-password@127.0.0.1:54321/qianshu_ci?schema=public'

test('付款夹具仅允许隔离测试库，连接凭据只经环境变量传递', () => {
  const command = createPaymentFixtureCommand({ DATABASE_URL: databaseUrl, NODE_ENV: 'test' })
  assert.equal(command.command, 'pnpm')
  assert.equal(command.env.DATABASE_URL, databaseUrl)
  assert.equal(command.env.DOTENV_CONFIG_PATH, '/dev/null')
  assert.equal(command.args.join(' ').includes(databaseUrl), false)
  assert.doesNotThrow(() => new Script(command.args.at(-1)))
  for (const environment of [
    { DATABASE_URL: databaseUrl, NODE_ENV: 'production' },
    { DATABASE_URL: 'postgresql://dev:secret@localhost:5432/qianshu_dms_dev?schema=public', NODE_ENV: 'test' },
    { DATABASE_URL: databaseUrl.replace('127.0.0.1', 'db.example.com'), NODE_ENV: 'test' },
  ]) assert.throws(() => createPaymentFixtureCommand(environment))
})

function clientFixture({ missing = '', failOnAccount = false } = {}) {
  const calls = []
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql: sql.trim(), values })
      if (missing && sql.includes(missing)) return { rowCount: 0, rows: [] }
      if (sql.includes('FROM _prisma_migrations')) return { rowCount: 1, rows: [{}] }
      if (sql.includes('SELECT u.id FROM users')) return { rowCount: 1, rows: [{ id: 'actor' }] }
      if (sql.includes('SELECT item.value')) return { rowCount: 2, rows: [{}] }
      if (sql.includes('SELECT type.id')) return { rowCount: 1, rows: [{}] }
      if (sql.includes('SELECT id, order_no')) return { rowCount: 2, rows: [{ id: 'active' }, { id: 'cancel' }] }
      if (sql.includes('INSERT INTO payment_recipient_profiles')) return { rowCount: 1, rows: [{ id: 'profile' }] }
      if (sql.includes('INSERT INTO payment_recipient_accounts') && failOnAccount) throw new Error('account failure')
      return { rowCount: 1, rows: [] }
    },
  }
}

test('付款夹具仅插入精确收款资料及两笔订单的完整阶段，提交前执行真实约束', async () => {
  const client = clientFixture()
  await provisionBrowserPaymentFixtures(client)
  assert.equal(client.calls[0].sql, 'BEGIN')
  assert.deepEqual(client.calls.slice(-2).map(call => call.sql), ['SET CONSTRAINTS ALL IMMEDIATE', 'COMMIT'])
  const writes = client.calls.filter(call => /INSERT INTO/u.test(call.sql))
  assert.equal(writes.length, 4)
  assert.deepEqual(writes.map(call => call.values), [['actor'], ['profile'], ['active', 'actor'], ['cancel', 'actor']])
  assert.match(writes[0].sql, /'BROWSER_SUPPLIER_EFFECTIVE'/u)
  assert.match(writes[1].sql, /'BANK_TRANSFER', 'Browser 收款人', 'Browser 银行', '6222000000000000'/u)
  for (const write of writes.slice(2)) assert.match(write.sql, /'DEPOSIT', 10, 'COMPANY'[\s\S]*'BALANCE', 20, 'COMPANY'/u)
  assert.doesNotMatch(client.calls.map(call => call.sql).join('\n'), /DISABLE TRIGGER|session_replication_role|\bUPDATE\b|\bDELETE\b|INSERT INTO fund_|INSERT INTO purchase_order_payments/u)
})

test('迁移、操作者、字典、资金或历史订单不满足前置条件时零写入并回滚', async () => {
  for (const missing of ['FROM _prisma_migrations', 'SELECT u.id FROM users', 'SELECT item.value', 'SELECT type.id', 'SELECT id, order_no']) {
    const client = clientFixture({ missing })
    await assert.rejects(provisionBrowserPaymentFixtures(client), /PAYMENT_FIXTURE_.*_REQUIRED/u)
    assert.equal(client.calls.some(call => /INSERT INTO/u.test(call.sql)), false)
    assert.equal(client.calls.at(-1).sql, 'ROLLBACK')
  }
})

test('收款资料写入失败时整批回滚，不继续创建应付或提交', async () => {
  const client = clientFixture({ failOnAccount: true })
  await assert.rejects(provisionBrowserPaymentFixtures(client), /account failure/u)
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK')
  assert.equal(client.calls.some(call => /INSERT INTO purchase_order_payables|COMMIT/u.test(call.sql)), false)
})
