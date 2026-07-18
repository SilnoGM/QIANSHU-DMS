import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  applyFailureToProcess,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')

export async function check(run = runCommand) {
  // 根测试通过 process.execPath 调用 node --run，避免 pnpm 11 在根 package
  // 自动 install 并生成 pnpm-lock.yaml 或 node_modules 状态目录。所有步骤都
  // 锚定脚本所在仓库根，确保从任意 cwd 直接执行时解析同一 package、
  // 契约入口和两端目录。严格串行的 await 会在任一边界失败时立即短路。
  await run(process.execPath, ['--run', 'test:root'], { cwd: repositoryRoot })
  await run('pnpm', ['-C', 'server', 'check'], { cwd: repositoryRoot })
  // Node 24 的 node --run 会把 package script 的非零退出码归一为 1。
  // 直接执行同一 CLI 才能让 Contract 生成器的原始退出码向上传播。
  await run(process.execPath, ['./scripts/contract-check.mjs'], {
    cwd: repositoryRoot,
  })
  await run('pnpm', ['-C', 'web', 'check'], { cwd: repositoryRoot })
  // 真实 Cookie、浏览器重启和多标签同步必须在两端静态检查均通过后，
  // 由唯一隔离入口启动 PostgreSQL、正式构建与系统 Chrome 验证。
  await run(process.execPath, ['--run', 'ci:browser-auth-e2e'], {
    cwd: repositoryRoot,
  })
}

if (isDirectEntry(import.meta.url)) {
  check().catch(error => applyFailureToProcess(error))
}
