import 'dotenv/config'
import 'reflect-metadata'

import { ApiException } from '../infrastructure/http/api.exception'
import type {
  FundPostingBatchNumberBackfillOptions,
  FundPostingBatchNumberBackfillResult,
} from '../modules/fund-accounts/application/fund-posting-batch-number-backfill.service'

interface Dependencies {
  run(
    options: FundPostingBatchNumberBackfillOptions,
  ): Promise<FundPostingBatchNumberBackfillResult>
  output: { log(value: string): void; error(value: string): void }
  processRef: { exitCode?: number | string | null }
}

function parseArguments(
  argv: readonly string[],
): FundPostingBatchNumberBackfillOptions {
  let apply = false
  let modeSeen = false
  let limit = 1000
  const seen = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (seen.has(key)) throw new Error('Invalid fund batch backfill arguments')
    seen.add(key)
    if (key === '--apply' || key === '--dry-run') {
      if (modeSeen) throw new Error('Conflicting fund batch backfill mode')
      modeSeen = true
      apply = key === '--apply'
    }
    else if (key === '--limit') {
      const value = argv[++index] ?? ''
      if (!/^[1-9]\d{0,4}$/u.test(value) || Number(value) > 10_000) {
        throw new Error('Invalid fund batch backfill limit')
      }
      limit = Number(value)
    }
    else {
      throw new Error('Unknown fund batch backfill argument')
    }
  }

  return { apply, limit }
}

async function runDefault(
  options: FundPostingBatchNumberBackfillOptions,
): Promise<FundPostingBatchNumberBackfillResult> {
  const [
    { NestFactory },
    { AppModule },
    { FundPostingBatchNumberBackfillService },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module'),
    import('../modules/fund-accounts/application/fund-posting-batch-number-backfill.service'),
  ])
  const application = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false,
  })
  try {
    return await application
      .get(FundPostingBatchNumberBackfillService)
      .run(options)
  }
  finally {
    await application.close()
  }
}

/** 默认预览；只输出稳定结果与错误码，不把连接串、SQL 或原始异常带入运维日志。 */
export async function runFundPostingBatchNumberBackfillCli(
  argv: readonly string[],
  dependencies: Dependencies = { run: runDefault, output: console, processRef: process },
): Promise<void> {
  try {
    const options = parseArguments(argv)
    const result = await dependencies.run(options)
    dependencies.output.log(JSON.stringify({
      kind: 'fund_posting_batch_number_backfill',
      ...result,
    }))
    if (
      result.failed > 0
      || result.errorCode !== null
      || (!result.ruleAvailable && result.remaining > 0)
    ) {
      dependencies.processRef.exitCode = 1
    }
  }
  catch (error) {
    dependencies.output.error(JSON.stringify({
      kind: 'fund_posting_batch_number_backfill',
      status: 'failed',
      code: error instanceof ApiException
        ? error.code
        : 'FUND_POSTING_NUMBER_BACKFILL_FAILED',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (require.main === module) {
  void runFundPostingBatchNumberBackfillCli(process.argv.slice(2))
}
