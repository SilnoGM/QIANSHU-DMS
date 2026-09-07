import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  historicalFixtureCutover,
  migrateBeforeHistoricalFixtures,
  selectHistoricalFixtureMigrations,
} from './browser-auth/migrate-before-historical-fixtures.mjs'

test('历史夹具精确位于货件 migration 前，之后的 migration 不得提前应用', () => {
  assert.deepEqual(selectHistoricalFixtureMigrations([
    'migration_lock.toml', historicalFixtureCutover, '20260908120000_future',
    '20260907053825_purchase_order_review_default_and_permission', '20260710152144_init', '../bad',
  ]), ['20260710152144_init', '20260907053825_purchase_order_review_default_and_permission'])
  assert.throws(() => selectHistoricalFixtureMigrations(['20260710152144_init']))
})

test('历史夹具 migration 在任何读写前拒绝业务库地址', async () => {
  await assert.rejects(migrateBeforeHistoricalFixtures({ DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/business?schema=public' }), /outside the isolated boundary/u)
})

test('夹具提交后恢复完整 migration，整个流程不关闭触发器或改写 migration 账本', async () => {
  const provision = await readFile(new URL('./browser-auth/provision-admin.mjs', import.meta.url), 'utf8')
  const migration = await readFile(new URL('./browser-auth/migrate-before-historical-fixtures.mjs', import.meta.url), 'utf8')
  assert.ok(provision.indexOf("await runCommand('pnpm', ['-C', 'server', 'db:migrate:deploy']") > provision.indexOf('await executeProvisionCommand('))
  assert.doesNotMatch(`${provision}\n${migration}`, /DISABLE TRIGGER|session_replication_role|INSERT INTO.*_prisma_migrations/u)
})
