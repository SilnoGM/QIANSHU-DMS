import 'dotenv/config'
import 'reflect-metadata'

import { ApiException } from '../infrastructure/http/api.exception'
import type { SlhBillRecipientBackfillOptions, SlhBillRecipientBackfillResult } from '../modules/slh-bills/slh-bill-recipient-backfill.service'

interface Dependencies {
  run(options: SlhBillRecipientBackfillOptions): Promise<SlhBillRecipientBackfillResult>
  output: { log(value: string): void, error(value: string): void }
  processRef: { exitCode?: number | string | null }
}

function parseArguments(argv: readonly string[]): SlhBillRecipientBackfillOptions {
  let apply = false
  let limit = 1000
  let modeSeen = false
  const seen = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (seen.has(key)) throw new Error('Invalid backfill arguments')
    seen.add(key)
    if (key === '--apply' || key === '--dry-run') {
      if (modeSeen) throw new Error('Conflicting backfill mode')
      modeSeen = true
      apply = key === '--apply'
    }
    else if (key === '--limit') {
      const value = argv[++index] ?? ''
      if (!/^[1-9]\d{0,4}$/u.test(value)) throw new Error('Invalid backfill limit')
      limit = Number(value)
    }
    else {
      throw new Error('Unknown backfill argument')
    }
  }
  if (limit > 10_000) throw new Error('Invalid backfill limit')
  return { apply, limit }
}

async function runDefault(options: SlhBillRecipientBackfillOptions): Promise<SlhBillRecipientBackfillResult> {
  const [{ NestFactory }, { AppModule }, { SlhBillRecipientBackfillService }] = await Promise.all([
    import('@nestjs/core'), import('../app.module'), import('../modules/slh-bills/slh-bill-recipient-backfill.service'),
  ])
  const application = await NestFactory.createApplicationContext(AppModule, { abortOnError: false, logger: false })
  try {
    return await application.get(SlhBillRecipientBackfillService).run(options)
  }
  finally {
    await application.close()
  }
}

/** 默认预览；只输出计数，禁止把客户信息、连接串或原始异常带进运维日志。 */
export async function runSlhBillRecipientBackfillCli(argv: readonly string[], dependencies: Dependencies = { output: console, processRef: process, run: runDefault }): Promise<void> {
  try {
    const options = parseArguments(argv)
    const result = await dependencies.run(options)
    dependencies.output.log(JSON.stringify({ kind: 'slh_bill_recipient_backfill', ...result }))
    if (result.remaining > 0 && result.mode === 'APPLY') {
      dependencies.processRef.exitCode = 1
    }
  }
  catch (error) {
    dependencies.output.error(JSON.stringify({ code: error instanceof ApiException ? error.code : 'SLH_BILL_RECIPIENT_BACKFILL_FAILED', kind: 'slh_bill_recipient_backfill', status: 'failed' }))
    dependencies.processRef.exitCode = 1
  }
}

// 被测试或其他工具导入时不得执行；仅直接运行编译产物才启动回填。
if (require.main === module) void runSlhBillRecipientBackfillCli(process.argv.slice(2))
