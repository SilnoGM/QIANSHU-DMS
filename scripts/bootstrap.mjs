import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyFailureToProcess,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')

export async function bootstrap(run = runCommand) {
  // 命令工作目录锚定脚本所在仓库根，不继承调用者 cwd；因此从仓库外直接
  // 执行入口时，相对的 server/web 目录仍解析到当前项目。安装保持严格串行，
  // Server 失败时 await 会立即抛出，Web 不会继续执行。
  await run('pnpm', ['-C', 'server', 'install'], { cwd: repositoryRoot })
  await run('pnpm', ['-C', 'web', 'install'], { cwd: repositoryRoot })
}

if (isDirectEntry(import.meta.url)) {
  bootstrap().catch(error => applyFailureToProcess(error))
}
