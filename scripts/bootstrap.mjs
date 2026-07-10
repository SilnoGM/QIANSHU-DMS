import {
  applyFailureToProcess,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'

export async function bootstrap(run = runCommand) {
  // 必须串行安装：Server 失败时 await 会立即抛出，Web 不会继续执行。
  await run('pnpm', ['-C', 'server', 'install'])
  await run('pnpm', ['-C', 'web', 'install'])
}

if (isDirectEntry(import.meta.url)) {
  bootstrap().catch(error => applyFailureToProcess(error))
}
