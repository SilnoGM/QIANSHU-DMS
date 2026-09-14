import 'dotenv/config'
import 'reflect-metadata'

import { ApiException } from '../infrastructure/http/api.exception'
import type { ShipmentNumberBackfillOptions, ShipmentNumberBackfillResult } from '../modules/purchase-orders/shipments/purchase-shipment-number-backfill.service'

interface Dependencies {
  run(options: ShipmentNumberBackfillOptions): Promise<ShipmentNumberBackfillResult>
  output: { log(value: string): void, error(value: string): void }
  processRef: { exitCode?: number | string | null }
}

function parseArguments(argv: readonly string[]): ShipmentNumberBackfillOptions {
  let actorUserId: string | undefined, limit = 1000, apply = false, modeSeen = false
  const seen = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (seen.has(key)) throw new Error('Invalid backfill arguments')
    seen.add(key)
    if (key === '--apply' || key === '--dry-run') {
      if (modeSeen) throw new Error('Conflicting backfill mode')
      modeSeen = true; apply = key === '--apply'
    }
    else if (key === '--actor-user-id') actorUserId = argv[++index]
    else if (key === '--limit') {
      const value = argv[++index] ?? ''
      if (!/^[1-9]\d{0,4}$/u.test(value)) throw new Error('Invalid backfill limit')
      limit = Number(value)
    }
    else throw new Error('Unknown backfill argument')
  }
  if (!actorUserId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(actorUserId) || limit > 10_000) {
    throw new Error('Invalid backfill arguments')
  }
  return { actorUserId, apply, limit }
}

async function runDefault(options: ShipmentNumberBackfillOptions): Promise<ShipmentNumberBackfillResult> {
  const [{ NestFactory }, { AppModule }, { PurchaseShipmentNumberBackfillService }] = await Promise.all([
    import('@nestjs/core'), import('../app.module'), import('../modules/purchase-orders/shipments/purchase-shipment-number-backfill.service'),
  ])
  const application = await NestFactory.createApplicationContext(AppModule, { abortOnError: false, logger: false })
  try { return await application.get(PurchaseShipmentNumberBackfillService).run(options) }
  finally { await application.close() }
}

/** 默认预览；运行只输出计数与安全错误码。禁止将连接串、SQL 或原始异常带入运维日志。 */
export async function runShipmentNumberBackfillCli(argv: readonly string[], dependencies: Dependencies = { run: runDefault, output: console, processRef: process }): Promise<void> {
  try {
    const options = parseArguments(argv)
    const result = await dependencies.run(options)
    dependencies.output.log(JSON.stringify({ kind: 'shipment_number_backfill', ...result }))
    if (result.failed > 0 || result.errorCode !== null || (!result.ruleAvailable && result.remaining > 0)) dependencies.processRef.exitCode = 1
  }
  catch (error) {
    dependencies.output.error(JSON.stringify({ kind: 'shipment_number_backfill', status: 'failed', code: error instanceof ApiException ? error.code : 'SHIPMENT_BACKFILL_FAILED' }))
    dependencies.processRef.exitCode = 1
  }
}

if (require.main === module) void runShipmentNumberBackfillCli(process.argv.slice(2))
