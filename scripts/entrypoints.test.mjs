import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const entrypointChild = process.env.QIANSHU_ENTRYPOINT_CHILD === '1'
const testSecret = 'qianshu-entrypoint-secret-must-not-leak'

async function exists(absolutePath) {
  try {
    await lstat(absolutePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function createFixture(testContext) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'qianshu-entrypoint-'))
  const binDirectory = path.join(fixtureRoot, 'bin')
  const outsideDirectory = path.join(fixtureRoot, 'outside')
  const logPath = path.join(fixtureRoot, 'pnpm-calls.jsonl')
  await mkdir(binDirectory)
  await mkdir(outsideDirectory)

  // 清理范围只能是 mkdtemp 返回的独立测试目录，绝不指向仓库或其子目录。
  testContext.after(async () => {
    await rm(fixtureRoot, { force: true, recursive: true })
  })

  const fakePnpmPath = path.join(binDirectory, 'pnpm')
  const fakePnpmSource = `#!/usr/bin/env node
const fs = require('node:fs')

const record = {
  cwd: process.cwd(),
  args: process.argv.slice(2),
}
fs.appendFileSync(
  process.env.QIANSHU_FAKE_PNPM_LOG,
  JSON.stringify(record) + '\\n',
)

if (record.args[0] === '-C' && record.args[1] === 'server') {
  process.exit(7)
}
process.exit(0)
`
  await writeFile(fakePnpmPath, fakePnpmSource, 'utf8')
  await chmod(fakePnpmPath, 0o755)

  return {
    binDirectory,
    logPath,
    outsideDirectory,
  }
}

function runEntrypoint(entrypointPath, fixture) {
  return spawnSync(process.execPath, [entrypointPath], {
    cwd: fixture.outsideDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixture.binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      QIANSHU_ENTRYPOINT_CHILD: '1',
      QIANSHU_FAKE_PNPM_LOG: fixture.logPath,
      QIANSHU_TEST_SECRET: testSecret,
    },
    maxBuffer: 5 * 1024 * 1024,
    timeout: 30_000,
  })
}

async function readPnpmCalls(logPath) {
  const contents = await readFile(logPath, 'utf8')
  return contents
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

async function assertRootStateAbsent() {
  for (const name of ['pnpm-workspace.yaml', 'pnpm-lock.yaml', 'node_modules']) {
    assert.equal(
      await exists(path.join(repositoryRoot, name)),
      false,
      `真实入口不得生成根状态：${name}`,
    )
  }
}

if (entrypointChild) {
  test('真实入口集成测试在入口子进程中跳过以避免递归', {
    skip: 'QIANSHU_ENTRYPOINT_CHILD=1',
  }, () => {})
} else {
  test('bootstrap 从仓库外直接执行时仍在仓库根运行 Server 安装', async (t) => {
    const fixture = await createFixture(t)
    const result = runEntrypoint(path.join(scriptsDirectory, 'bootstrap.mjs'), fixture)

    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    assert.equal(result.status, 7)
    assert.match(result.stderr, /Command failed: pnpm/)
    assert.equal(result.stderr.includes(testSecret), false)
    assert.deepEqual(await readPnpmCalls(fixture.logPath), [{
      cwd: repositoryRoot,
      args: ['-C', 'server', 'install'],
    }])
    await assertRootStateAbsent()
  })

  test('check 从仓库外直接执行时先完成根测试再运行 Server 检查', async (t) => {
    const fixture = await createFixture(t)
    const result = runEntrypoint(path.join(scriptsDirectory, 'check.mjs'), fixture)

    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    assert.equal(result.status, 7)
    assert.match(result.stderr, /Command failed: pnpm/)
    assert.equal(result.stderr.includes(testSecret), false)
    assert.deepEqual(await readPnpmCalls(fixture.logPath), [{
      cwd: repositoryRoot,
      args: ['-C', 'server', 'check'],
    }])
    await assertRootStateAbsent()
  })
}
