import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  cleanRootArtifacts,
  forbiddenRootArtifacts,
  validateRootArtifactCleanerArguments,
} from './root-artifact-cleaner.mjs'

async function createFixture(testContext, packageName = 'qianshu-dms') {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qianshu-root-cleaner-'))
  await fs.writeFile(
    path.join(fixtureRoot, 'package.json'),
    JSON.stringify({ name: packageName, private: true }),
    'utf8',
  )
  testContext.after(() => fs.rm(fixtureRoot, { force: true, recursive: true }))
  return fixtureRoot
}

async function exists(targetPath) {
  try {
    await fs.lstat(targetPath)
    return true
  }
  catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function quietLogger() {
  return { log() {} }
}

test('根违规产物白名单固定为四个精确名称', () => {
  assert.deepEqual(forbiddenRootArtifacts, [
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'node_modules',
    '.pnpm-store',
  ])
})

test('只删除根目录白名单并保留两端依赖域和普通文件', async (t) => {
  const fixtureRoot = await createFixture(t)
  const forbiddenFiles = ['pnpm-workspace.yaml', 'pnpm-lock.yaml']
  const forbiddenDirectories = ['node_modules', '.pnpm-store']

  for (const name of forbiddenFiles) {
    await fs.writeFile(path.join(fixtureRoot, name), 'generated', 'utf8')
  }
  for (const name of forbiddenDirectories) {
    await fs.mkdir(path.join(fixtureRoot, name, 'nested'), { recursive: true })
    await fs.writeFile(path.join(fixtureRoot, name, 'nested', 'canary'), 'keep outside', 'utf8')
  }
  await fs.mkdir(path.join(fixtureRoot, 'web'), { recursive: true })
  await fs.mkdir(path.join(fixtureRoot, 'server', 'node_modules'), { recursive: true })
  await fs.writeFile(path.join(fixtureRoot, 'web', 'pnpm-lock.yaml'), 'keep', 'utf8')
  await fs.writeFile(path.join(fixtureRoot, 'server', 'node_modules', 'canary'), 'keep', 'utf8')
  await fs.writeFile(path.join(fixtureRoot, 'notes.txt'), 'keep', 'utf8')

  const result = await cleanRootArtifacts({
    logger: quietLogger(),
    repositoryRoot: fixtureRoot,
  })

  assert.deepEqual(result.removed, forbiddenRootArtifacts)
  for (const name of forbiddenRootArtifacts) {
    assert.equal(await exists(path.join(fixtureRoot, name)), false)
  }
  assert.equal(await fs.readFile(path.join(fixtureRoot, 'web', 'pnpm-lock.yaml'), 'utf8'), 'keep')
  assert.equal(
    await fs.readFile(path.join(fixtureRoot, 'server', 'node_modules', 'canary'), 'utf8'),
    'keep',
  )
  assert.equal(await fs.readFile(path.join(fixtureRoot, 'notes.txt'), 'utf8'), 'keep')
})

test('重复执行保持幂等并报告没有违规产物', async (t) => {
  const fixtureRoot = await createFixture(t)
  const messages = []

  const first = await cleanRootArtifacts({
    logger: { log: message => messages.push(message) },
    repositoryRoot: fixtureRoot,
  })
  const second = await cleanRootArtifacts({
    logger: { log: message => messages.push(message) },
    repositoryRoot: fixtureRoot,
  })

  assert.deepEqual(first.removed, [])
  assert.deepEqual(second.removed, [])
  assert.deepEqual(messages, [
    'Root artifact guard passed.',
    'Root artifact guard passed.',
  ])
})

test('根违规路径为符号链接时只删除链接而不触碰外部目标', async (t) => {
  const fixtureRoot = await createFixture(t)
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qianshu-root-cleaner-outside-'))
  t.after(() => fs.rm(outsideRoot, { force: true, recursive: true }))
  const outsideCanary = path.join(outsideRoot, 'canary')
  await fs.writeFile(outsideCanary, 'keep', 'utf8')
  await fs.symlink(outsideRoot, path.join(fixtureRoot, 'node_modules'))

  const result = await cleanRootArtifacts({
    logger: quietLogger(),
    repositoryRoot: fixtureRoot,
  })

  assert.deepEqual(result.removed, ['node_modules'])
  assert.equal(await exists(path.join(fixtureRoot, 'node_modules')), false)
  assert.equal(await fs.readFile(outsideCanary, 'utf8'), 'keep')
})

test('仓库身份不匹配时拒绝删除任何同名文件', async (t) => {
  const fixtureRoot = await createFixture(t, 'not-qianshu-dms')
  const lockfile = path.join(fixtureRoot, 'pnpm-lock.yaml')
  await fs.writeFile(lockfile, 'keep', 'utf8')

  await assert.rejects(
    cleanRootArtifacts({ logger: quietLogger(), repositoryRoot: fixtureRoot }),
    /^CommandExecutionError: Root artifact guard could not verify repository root$/,
  )
  assert.equal(await fs.readFile(lockfile, 'utf8'), 'keep')
})

test('单项删除失败时继续清理其他白名单并最终返回非零错误', async (t) => {
  const fixtureRoot = await createFixture(t)
  const nodeModules = path.join(fixtureRoot, 'node_modules')
  const store = path.join(fixtureRoot, '.pnpm-store')
  await fs.mkdir(nodeModules)
  await fs.mkdir(store)
  const fileSystem = {
    lstat: fs.lstat,
    readFile: fs.readFile,
    unlink: fs.unlink,
    async rm(targetPath, options) {
      if (targetPath === nodeModules) {
        throw new Error('simulated secret=must-not-leak')
      }
      return fs.rm(targetPath, options)
    },
  }

  await assert.rejects(
    cleanRootArtifacts({ fileSystem, logger: quietLogger(), repositoryRoot: fixtureRoot }),
    /^CommandExecutionError: Root artifact cleanup failed: node_modules$/,
  )
  assert.equal(await exists(nodeModules), true)
  assert.equal(await exists(store), false)
})

test('并发清理已移除同一目标时保持幂等成功', async (t) => {
  const fixtureRoot = await createFixture(t)
  const nodeModules = path.join(fixtureRoot, 'node_modules')
  await fs.mkdir(nodeModules)
  const messages = []
  const fileSystem = {
    lstat: fs.lstat,
    readFile: fs.readFile,
    unlink: fs.unlink,
    async rm(targetPath, options) {
      await fs.rm(targetPath, options)
      const error = new Error('removed by concurrent cleaner')
      error.code = 'ENOENT'
      throw error
    },
  }

  const result = await cleanRootArtifacts({
    fileSystem,
    logger: { log: message => messages.push(message) },
    repositoryRoot: fixtureRoot,
  })

  assert.deepEqual(result, { removed: [] })
  assert.deepEqual(messages, ['Root artifact guard passed.'])
  assert.equal(await exists(nodeModules), false)
})

test('命令行入口不接受外部路径或其他参数', () => {
  assert.doesNotThrow(() => validateRootArtifactCleanerArguments([
    process.execPath,
    '/repo/scripts/root-artifact-cleaner.mjs',
  ]))
  assert.throws(
    () => validateRootArtifactCleanerArguments([
      process.execPath,
      '/repo/scripts/root-artifact-cleaner.mjs',
      '/tmp/outside',
    ]),
    /^CommandExecutionError: Unsupported root artifact cleaner arguments$/,
  )
})
