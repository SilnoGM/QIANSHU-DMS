import { ApiException } from '../../infrastructure/http/api.exception'
import { SeedOperationError, type SeedRunResult } from './seed.service'

export interface SeedCommandOptions {
  /** 默认只预览；显式 --apply 才写入数据。 */
  readonly apply: boolean
}

export interface SeedIo {
  writeLine(line: string): void
}

/** 参数白名单保持极小体积：未知参数一律拒绝，避免把连接串或密码经 argv 带入。 */
export function parseSeedArguments(argv: readonly string[]): SeedCommandOptions {
  let apply = false
  for (const argument of argv) {
    if (argument === '--apply') {
      apply = true
      continue
    }
    if (argument === '--dry-run') {
      continue
    }
    throw new Error('Invalid seed arguments')
  }
  return { apply }
}

export interface SeedCliDependencies {
  readonly run: (options: SeedCommandOptions) => Promise<SeedRunResult>
  readonly io: SeedIo
}

/**
 * CLI 最外层安全边界：只输出固定 JSON 摘要与稳定错误码，任何未知异常都不向终端
 * 透传连接串、SQL 参数或底层实现细节。存在 conflicts 时以非零码退出。
 */
export async function executeSeedCli(
  argv: readonly string[],
  dependencies: SeedCliDependencies,
): Promise<number> {
  try {
    const options = parseSeedArguments(argv)
    const result = await dependencies.run(options)
    dependencies.io.writeLine(JSON.stringify({
      kind: 'seed',
      mode: options.apply ? 'applied' : 'preview',
      categories: result.categories,
      conflicts: result.conflicts,
    }))
    return result.conflicts.length > 0 ? 1 : 0
  }
  catch (error) {
    dependencies.io.writeLine(JSON.stringify({
      kind: 'seed',
      status: 'failed',
      code: readFailureCode(error),
    }))
    return 1
  }
}

function readFailureCode(error: unknown): string {
  if (error instanceof SeedOperationError) {
    return error.code
  }
  if (error instanceof ApiException) {
    return error.code
  }
  return 'SEED_FAILED'
}
