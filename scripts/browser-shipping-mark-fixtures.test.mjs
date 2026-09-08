import assert from 'node:assert/strict'
import test from 'node:test'

import { provisionBrowserShippingMarkFixtures } from './browser-auth/provision-shipping-mark-fixtures.mjs'

test('唛头Browser夹具按发布顺序配置专属规则，绑定稳定供应商且仅给MIXED展示单建立ledger', async () => {
  const calls = []
  let identity = 0
  const client = { query: async (sql, values = []) => {
    calls.push({ sql: sql.replace(/\s+/gu, ' ').trim(), values })
    return { rows: [{ id: `fixture-id-${++identity}` }] }
  } }
  const fixture = await provisionBrowserShippingMarkFixtures(client, 'fixture-actor')
  const rules = calls.filter(call => call.sql.startsWith('INSERT INTO numbering_rules '))
  assert.deepEqual(rules.map(call => call.values[0]), ['BROWSER_MARK', 'CUSTOM_MARK', 'BROWSER_MIXED_FIXTURE'])
  assert.ok(rules.every(call => call.sql.includes("'SHIPPING_MARK'")))
  const versions = calls.filter(call => call.sql.startsWith('INSERT INTO numbering_rule_versions '))
  assert.equal(versions.length, 3)
  assert.ok(versions.every(call => /^[0-9a-f]{64}$/u.test(call.values[1])))
  const bindings = calls.filter(call => call.sql.startsWith('INSERT INTO supplier_shipping_mark_rule_bindings '))
  assert.equal(bindings.length, 1)
  assert.ok(bindings[0].sql.includes("'BROWSER_SUPPLIER_EFFECTIVE'"))
  assert.deepEqual(bindings[0].values, ['fixture-id-1', 'fixture-actor'])
  const state = calls.filter(call => call.sql.startsWith('INSERT INTO numbering_period_states '))
  assert.equal(state.length, 1)
  const issuances = calls.filter(call => call.sql.startsWith('INSERT INTO numbering_issuances '))
  assert.equal(issuances.length, 2)
  assert.deepEqual(issuances.map(call => call.values.slice(2)), [
    ['BROWSER-HISTORICAL-MIXED-ACTIVE-MARK', Buffer.from('a'.repeat(64), 'hex'), Buffer.from('b'.repeat(64), 'hex')],
    ['BROWSER-HISTORICAL-MIXED-CANCEL-MARK', Buffer.from('c'.repeat(64), 'hex'), Buffer.from('d'.repeat(64), 'hex')],
  ])
  assert.ok(issuances.every(call => call.sql.includes("'PURCHASE_ORDER.SHIPPING_MARK'")))
  assert.notEqual(fixture.mixedActiveIssuanceId, fixture.mixedCancelableIssuanceId)
  for (const rule of rules) {
    const ruleIndex = calls.indexOf(rule)
    const nextRuleIndex = calls.findIndex((call, index) => index > ruleIndex && call.sql.startsWith('INSERT INTO numbering_rules '))
    const operations = calls.slice(ruleIndex, nextRuleIndex === -1 ? undefined : nextRuleIndex)
    const publishIndex = operations.findIndex(call => call.sql.includes("SET status = 'ACTIVE'"))
    const enableIndex = operations.findIndex(call => call.sql.includes("SET status = 'ENABLED'"))
    assert.ok(operations.some(call => call.sql.startsWith('INSERT INTO numbering_rule_segments ')))
    assert.ok(publishIndex > operations.findLastIndex(call => call.sql.startsWith('INSERT INTO numbering_rule_segments ')))
    assert.ok(enableIndex > publishIndex)
  }
  assert.ok(calls.every(call => !/DELETE|TRUNCATE|DISABLE TRIGGER|session_replication_role|BEGIN|COMMIT/u.test(call.sql)))
})
