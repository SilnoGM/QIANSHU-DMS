import assert from 'node:assert/strict'
import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 契约测试由 Node.js 内置 test runner 直接运行。
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const generatedDirectory = path.resolve(
  testDirectory,
  '../../src/api/generated',
)

test('generated 目录精确包含非空且非 symlink 的 types.gen.ts', async () => {
  const directoryStats = await lstat(generatedDirectory)
  assert.equal(directoryStats.isSymbolicLink(), false)
  assert.equal(directoryStats.isDirectory(), true)

  const entries = await readdir(generatedDirectory, { withFileTypes: true })
  assert.deepEqual(entries.map(entry => entry.name), ['types.gen.ts'])
  assert.equal(entries[0]?.isSymbolicLink(), false)
  assert.equal(entries[0]?.isFile(), true)

  const typesPath = path.join(generatedDirectory, 'types.gen.ts')
  const typesStats = await lstat(typesPath)
  assert.equal(typesStats.isSymbolicLink(), false)
  assert.equal(typesStats.isFile(), true)
  assert.ok(typesStats.size > 0)
  assert.match(await readFile(typesPath, 'utf8'), /HealthGetResponses/)
})
