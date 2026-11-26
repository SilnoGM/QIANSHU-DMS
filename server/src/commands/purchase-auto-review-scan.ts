import 'dotenv/config'

import type { PurchaseAutoReviewScanSummary } from '../modules/purchase-orders/auto-review/purchase-auto-review-scan.service'

export interface PurchaseAutoReviewScanCliOptions {
  readonly dryRun: boolean
  readonly limit: number | undefined
}

export interface PurchaseAutoReviewScanOutput {
  log(message: string): void
  error(message: string): void
}

const LIMIT_PREFIX = '--limit='

/** 参数白名单保持极小；未知参数直接拒绝，避免把连接串等敏感值经 argv 带入。 */
export function parsePurchaseAutoReviewScanArguments(
  argv: readonly string[],
): PurchaseAutoReviewScanCliOptions {
  let dryRun = false
  let limit: number | undefined
  for (const argument of argv) {
    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    if (argument.startsWith(LIMIT_PREFIX)) {
      const raw = argument.slice(LIMIT_PREFIX.length)
      if (!/^[1-9][0-9]?$/u.test(raw)) {
        throw new Error('Invalid limit')
      }
      limit = Number(raw)
      continue
    }
    throw new Error('Invalid arguments')
  }
  return { dryRun, limit }
}

async function runDefault(
  options: PurchaseAutoReviewScanCliOptions,
): Promise<PurchaseAutoReviewScanSummary> {
  const [
    { NestFactory },
    { AppModule },
    { PurchaseAutoReviewScanService },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module'),
    import('../modules/purchase-orders/auto-review/purchase-auto-review-scan.service'),
  ])
  const application = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false,
  })
  try {
    return await application.get(PurchaseAutoReviewScanService).run(options)
  }
  finally {
    await application.close()
  }
}

export async function runPurchaseAutoReviewScanCli(
  argv: readonly string[],
  dependencies: {
    readonly run: (options: PurchaseAutoReviewScanCliOptions) => Promise<PurchaseAutoReviewScanSummary>
    readonly output?: PurchaseAutoReviewScanOutput
  } = { run: runDefault },
): Promise<number> {
  const output = dependencies.output ?? console
  try {
    const options = parsePurchaseAutoReviewScanArguments(argv)
    const result = await dependencies.run(options)
    output.log(JSON.stringify({ kind: 'purchase_auto_review_scan', ...result }))
    return result.notificationFailed > 0 ? 1 : 0
  }
  catch {
    // 只输出固定文案：连接串、SQL 参数与上游响应体不进入终端历史。
    output.error('Purchase auto review scan failed')
    return 1
  }
}

if (require.main === module) {
  void runPurchaseAutoReviewScanCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
