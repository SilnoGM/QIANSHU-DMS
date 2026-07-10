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
  // 锚定脚本所在仓库根，确保从任意 cwd 直接执行时解析同一 package 和两端目录。
  await run(process.execPath, ['--run', 'test:root'], { cwd: repositoryRoot })
  await run('pnpm', ['-C', 'server', 'check'], { cwd: repositoryRoot })
  await run('pnpm', ['-C', 'web', 'check'], { cwd: repositoryRoot })
}

if (isDirectEntry(import.meta.url)) {
  check().catch(error => applyFailureToProcess(error))
}
