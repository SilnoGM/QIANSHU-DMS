import 'dotenv/config'
import 'reflect-metadata'

import type {
  FundSourceBackfillOptions,
  FundSourceBackfillResult,
} from '../modules/fund-accounts/application/fund-source-backfill.service'

interface Dependencies {
  run(options: FundSourceBackfillOptions): Promise<FundSourceBackfillResult>
  output: { log(value: string): void; error(value: string): void }
  processRef: { exitCode?: number | string | null }
}

function parseArguments(argv: readonly string[]): FundSourceBackfillOptions {
  let apply = false
  let force = false
  let modeSeen = false
  const seen = new Set<string>()

  for (const key of argv) {
    if (seen.has(key)) throw new Error('Invalid fund source backfill arguments')
    seen.add(key)
    if (key === '--apply' || key === '--dry-run') {
      if (modeSeen) throw new Error('Conflicting fund source backfill mode')
      modeSeen = true
      apply = key === '--apply'
    }
    else if (key === '--force') {
      force = true
    }
    else {
      throw new Error('Unknown fund source backfill argument')
    }
  }

  return { apply, force }
}

async function runDefault(
  options: FundSourceBackfillOptions,
): Promise<FundSourceBackfillResult> {
  const [
    { NestFactory },
    { AppModule },
    { FundSourceBackfillService },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module'),
    import('../modules/fund-accounts/application/fund-source-backfill.service'),
  ])
  const application = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false,
  })
  try {
    return await application.get(FundSourceBackfillService).run(options)
  }
  finally {
    await application.close()
  }
}

/**
 * 历史流水来源说明回填：只写派生投影表，不触碰资金事实与不可变触发器。
 * 默认预览；只有 --apply 才写库，--force 才会重算已解析行。
 */
export async function runFundSourceBackfillCli(
  argv: readonly string[],
  dependencies: Dependencies = { run: runDefault, output: console, processRef: process },
): Promise<void> {
  try {
    const options = parseArguments(argv)
    const result = await dependencies.run(options)
    dependencies.output.log(JSON.stringify({
      kind: 'fund_source_backfill',
      ...result,
    }))
  }
  catch (error) {
    // 异常信息不含连接串、SQL 或原始 payload，只回报稳定的失败标记。
    dependencies.output.error(JSON.stringify({
      kind: 'fund_source_backfill',
      status: 'failed',
      code: error instanceof Error ? 'FUND_SOURCE_BACKFILL_FAILED' : 'UNKNOWN',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (require.main === module) {
  void runFundSourceBackfillCli(process.argv.slice(2))
}
