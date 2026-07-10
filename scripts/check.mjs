import process from 'node:process'

import {
  applyFailureToProcess,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'

export async function check(run = runCommand) {
  // 根测试通过 process.execPath 调用 node --run，避免 pnpm 11 在根 package
  // 自动 install 并生成 pnpm-lock.yaml 或 node_modules 状态目录。
  await run(process.execPath, ['--run', 'test:root'])
  await run('pnpm', ['-C', 'server', 'check'])
  await run('pnpm', ['-C', 'web', 'check'])
}

if (isDirectEntry(import.meta.url)) {
  check().catch(error => applyFailureToProcess(error))
}
