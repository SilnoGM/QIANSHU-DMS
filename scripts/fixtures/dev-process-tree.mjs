import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runDevelopment } from '../dev.mjs'

const fixturePath = fileURLToPath(import.meta.url)
const mode = process.argv[2]
const statusPath = process.argv[3]

async function runManager() {
  const commands = [[
    process.execPath,
    [fixturePath, 'worker', statusPath, String(process.pid)],
  ]]
  process.exitCode = await runDevelopment({ commands })
}

function runWorker() {
  const managerPid = process.argv[4]
  const child = spawn(
    process.execPath,
    [fixturePath, 'leaf', statusPath, managerPid],
    { stdio: 'inherit' },
  )

  child.once('error', () => {
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    // worker 只负责保持额外一层真实后代关系；leaf 被进程组信号结束后，worker
    // 沿用 shell 约定映射信号，避免测试 fixture 成为永不退出的孤儿进程。
    process.exitCode = code ?? (signal === 'SIGTERM' ? 143 : 1)
  })
}

function runLeaf() {
  const managerPid = Number(process.argv[4])
  const server = createServer((socket) => {
    // readiness 只需要完成 TCP 握手，不传输业务数据。并发测试中客户端可能先
    // 关闭连接；吸收该测试 socket 的 reset，避免 fixture 自身把它误判为进程失败。
    socket.on('error', () => undefined)
    socket.end()
  })

  server.listen(0, '127.0.0.1', async () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      process.exitCode = 1
      server.close()
      return
    }

    // 状态文件只包含临时 PID 与动态 loopback 端口；集成测试据此精确清理，
    // 不依赖进程名或端口批量终止任何外部开发进程。
    await writeFile(statusPath, JSON.stringify({
      leafPid: process.pid,
      managerPid,
      port: address.port,
      workerPid: process.ppid,
    }), { mode: 0o600 })
  })
}

if (mode === 'manager' && statusPath) {
  runManager().catch(() => {
    process.exitCode = 1
  })
} else if (mode === 'worker' && statusPath) {
  runWorker()
} else if (mode === 'leaf' && statusPath) {
  runLeaf()
} else {
  process.exitCode = 1
}
