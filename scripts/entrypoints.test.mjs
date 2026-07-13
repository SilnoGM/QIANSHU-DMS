import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
import { createConnection } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
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
  const readyPath = path.join(fixtureRoot, 'web-dev.ready')
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

const isDev = record.args[0] === '-C' && record.args[2] === 'dev'

if (isDev && record.args[1] === 'server') {
  const deadline = Date.now() + 5_000
  const waitForWebReady = () => {
    if (fs.existsSync(process.env.QIANSHU_FAKE_PNPM_READY)) {
      process.exit(7)
      return
    }
    if (Date.now() >= deadline) {
      process.exit(12)
      return
    }
    setTimeout(waitForWebReady, 10)
  }
  waitForWebReady()
} else if (isDev && record.args[1] === 'web') {
  const safetyTimer = setTimeout(() => process.exit(13), 5_000)
  process.once('SIGTERM', () => {
    clearTimeout(safetyTimer)
    fs.appendFileSync(
      process.env.QIANSHU_FAKE_PNPM_LOG,
      JSON.stringify({ ...record, event: 'signal', signal: 'SIGTERM' }) + '\\n',
    )
    process.exit(0)
  })

  const temporaryReadyPath = process.env.QIANSHU_FAKE_PNPM_READY + '.' + process.pid + '.tmp'
  fs.writeFileSync(temporaryReadyPath, 'ready', 'utf8')
  fs.renameSync(temporaryReadyPath, process.env.QIANSHU_FAKE_PNPM_READY)
  fs.appendFileSync(
    process.env.QIANSHU_FAKE_PNPM_LOG,
    JSON.stringify({ ...record, event: 'ready' }) + '\\n',
  )
} else if (
  record.args[0] === '-C' &&
  record.args[1] === 'server' &&
  ['install', 'openapi:generate'].includes(record.args[2])
) {
  process.exit(7)
} else {
  process.exit(0)
}
`
  await writeFile(fakePnpmPath, fakePnpmSource, 'utf8')
  await chmod(fakePnpmPath, 0o755)

  return {
    binDirectory,
    logPath,
    outsideDirectory,
    readyPath,
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
      QIANSHU_FAKE_PNPM_READY: fixture.readyPath,
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

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false
    }
    throw error
  }

  if (process.platform !== 'linux') {
    return true
  }

  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const commandEnd = stat.lastIndexOf(')')

    // Linux 的 kill(pid, 0) 对 zombie 仍返回成功，但 Z 状态已经不能执行代码、
    // 持有监听端口或响应信号。测试必须把它视为已退出，避免把 PID 1 尚未回收
    // 的瞬时进程表项误报成开发进程泄漏。
    return commandEnd === -1 || stat[commandEnd + 2] !== 'Z'
  } catch (error) {
    if (error?.code === 'ENOENT') {
      // kill(0) 与读取 /proc 之间进程可能刚好被回收，这是正常退出竞态。
      return false
    }
    throw error
  }
}

async function waitForProcessTreeStatus(statusPath) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(statusPath, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error
      }
    }
    await delay(25)
  }
  throw new Error('Timed out waiting for process-tree fixture')
}

async function waitForPidsToExit(pids) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (pids.every(pid => !isPidAlive(pid))) {
      return
    }
    await delay(25)
  }
  throw new Error('Timed out waiting for managed process tree to exit')
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const settle = (result) => {
      if (settled) {
        return
      }
      settled = true
      if (result) {
        // 成功握手后用 FIN 正常结束，避免立即 RST 令服务端 fixture 产生假失败。
        socket.end()
      } else {
        socket.destroy()
      }
      resolve(result)
    }
    socket.setTimeout(1_000, () => settle(false))
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
  })
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve([child.exitCode, child.signalCode])
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('exit', handleExit)
      reject(new Error('Timed out waiting for child process'))
    }, timeoutMs)

    function handleExit(code, signal) {
      clearTimeout(timeout)
      resolve([code, signal])
    }

    child.once('exit', handleExit)
  })
}

async function waitForPortState(port, expectedState) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await canConnect(port) === expectedState) {
      return
    }
    await delay(25)
  }
  throw new Error(`Timed out waiting for port state: ${expectedState}`)
}

function processTreeSnapshot(launcher, managedPids, port) {
  return {
    launcher: {
      exitCode: launcher?.exitCode,
      pid: launcher?.pid,
      signalCode: launcher?.signalCode,
    },
    managed: managedPids.map(pid => ({ alive: isPidAlive(pid), pid })),
    port,
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

  test('check 从仓库外直接执行时保留 Contract 退出码且不执行 Web', async (t) => {
    const fixture = await createFixture(t)
    const result = runEntrypoint(path.join(scriptsDirectory, 'check.mjs'), fixture)

    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    assert.equal(result.status, 7)
    assert.match(result.stderr, /OpenAPI contract check failed/)
    assert.equal(
      result.stderr.includes(`Command failed: ${process.execPath}`),
      true,
    )
    assert.equal(result.stderr.includes(testSecret), false)
    const records = await readPnpmCalls(fixture.logPath)
    assert.equal(records.length, 2)
    assert.deepEqual(records[0], {
      cwd: repositoryRoot,
      args: ['-C', 'server', 'check'],
    })
    assert.equal(records[1].cwd, repositoryRoot)
    assert.equal(records[1].args.length, 5)
    assert.deepEqual(records[1].args.slice(0, 4), [
      '-C',
      'server',
      'openapi:generate',
      '--output',
    ])
    assert.equal(path.isAbsolute(records[1].args[4]), true)
    assert.equal(
      records.some(record => record.args[1] === 'web'),
      false,
      'Contract 失败后不得执行 Web 检查或生成',
    )
    await assertRootStateAbsent()
  })

  test('dev 从仓库外直接执行时清理 Web 并保留 Server 退出码', async (t) => {
    const fixture = await createFixture(t)
    const result = runEntrypoint(path.join(scriptsDirectory, 'dev.mjs'), fixture)

    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    assert.equal(result.status, 7)
    assert.equal(result.stderr.includes(testSecret), false)
    assert.equal(await exists(fixture.readyPath), true)
    assert.equal(await readFile(fixture.readyPath, 'utf8'), 'ready')

    const records = await readPnpmCalls(fixture.logPath)
    const startRecords = records.filter(record => record.event === undefined)
    assert.equal(startRecords.length, 2)
    assert.equal(startRecords.every(record => record.cwd === repositoryRoot), true)
    assert.deepEqual(
      startRecords.map(record => record.args).sort((left, right) => left[1].localeCompare(right[1])),
      [
        ['-C', 'server', 'dev'],
        ['-C', 'web', 'dev'],
      ],
    )
    assert.deepEqual(
      records.find(record => record.event === 'ready'),
      {
        cwd: repositoryRoot,
        args: ['-C', 'web', 'dev'],
        event: 'ready',
      },
    )
    assert.deepEqual(
      records.find(record => record.event === 'signal'),
      {
        cwd: repositoryRoot,
        args: ['-C', 'web', 'dev'],
        event: 'signal',
        signal: 'SIGTERM',
      },
    )
    await assertRootStateAbsent()
  })

  test('node --run 外层退出后清理真实多层开发进程组', {
    skip: process.platform === 'win32'
      ? 'Windows 不支持 POSIX 负 PID 进程组信号'
      : false,
  }, async (t) => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'qianshu-dev-tree-'))
    const statusPath = path.join(fixtureRoot, 'tree.json')
    const fixturePath = path.join(scriptsDirectory, 'fixtures', 'dev-process-tree.mjs')
    const packageScript = [
      shellQuote(process.execPath),
      shellQuote(fixturePath),
      'manager',
      shellQuote(statusPath),
    ].join(' ')
    await writeFile(
      path.join(fixtureRoot, 'package.json'),
      JSON.stringify({ private: true, scripts: { 'dev-tree': packageScript } }),
      'utf8',
    )

    let launcher
    let managedPids = []
    t.after(async () => {
      const cleanupPids = [
        ...managedPids.slice().reverse(),
        launcher?.pid,
      ].filter(pid => Number.isInteger(pid) && pid > 1 && pid !== process.pid)
      for (const pid of cleanupPids) {
        if (isPidAlive(pid)) {
          process.kill(pid, 'SIGTERM')
        }
      }
      await delay(100)
      for (const pid of cleanupPids) {
        if (isPidAlive(pid)) {
          process.kill(pid, 'SIGKILL')
        }
      }
      if (launcher?.exitCode === null && launcher?.signalCode === null) {
        await waitForChildExit(launcher, 1_000).catch(() => undefined)
      }
      await rm(fixtureRoot, { force: true, recursive: true })
    })

    launcher = spawn(process.execPath, ['--run', 'dev-tree'], {
      cwd: fixtureRoot,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    const status = await waitForProcessTreeStatus(statusPath)
    managedPids = [status.managerPid, status.workerPid, status.leafPid]
    assert.equal(
      managedPids.every(pid => Number.isInteger(pid) && pid > 1),
      true,
    )
    assert.equal(new Set(managedPids).size, 3)
    assert.equal(
      managedPids.every(isPidAlive),
      true,
      JSON.stringify(processTreeSnapshot(launcher, managedPids, status.port)),
    )
    try {
      await waitForPortState(status.port, true)
    } catch (cause) {
      throw new Error(
        `Process-tree listener was unavailable: ${JSON.stringify(
          processTreeSnapshot(launcher, managedPids, status.port),
        )}`,
        { cause },
      )
    }

    const launcherExit = waitForChildExit(launcher, 10_000)
    launcher.kill('SIGTERM')
    const [code, signal] = await launcherExit
    assert.equal(code, null)
    assert.equal(signal, 'SIGTERM')
    await waitForPidsToExit(managedPids)
    await waitForPortState(status.port, false)
    await assertRootStateAbsent()
  })
}
