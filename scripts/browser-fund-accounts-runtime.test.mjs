import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createFundFixtureCommand,
  readFundFixtureInput,
} from './browser-fund-accounts/provision-fixture.mjs'

test('fund account browser fixture requires an isolated PostgreSQL URL and limited password', () => {
  assert.throws(
    () => readFundFixtureInput({
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/qianshu_dms',
      QIANSHU_BROWSER_FUND_LIMITED_PASSWORD: 'Limited-Fund!7',
    }),
    /fixture input is invalid/,
  )
  assert.throws(
    () => readFundFixtureInput({
      DATABASE_URL: 'postgresql://qianshu_ci:postgres@127.0.0.1:55432/qianshu_ci?schema=public',
      QIANSHU_BROWSER_FUND_LIMITED_PASSWORD: '',
    }),
    /fixture input is invalid/,
  )
})

test('fund account browser fixture command passes secrets through env only', () => {
  const command = createFundFixtureCommand({
    databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:55432/qianshu_dms_ci',
    password: 'Limited-Fund!7',
  })

  assert.equal(command.command, 'pnpm')
  assert.deepEqual(command.args.slice(0, 5), [
    '-C', 'server', 'exec', 'node', '--input-type=commonjs',
  ])
  assert.equal(command.env.DATABASE_URL.includes('55432'), true)
  assert.equal(command.env.QIANSHU_BROWSER_FUND_LIMITED_PASSWORD, 'Limited-Fund!7')
  assert.equal(command.args.join(' ').includes('Limited-Fund!7'), false)
})
