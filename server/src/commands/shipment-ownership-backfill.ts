import 'dotenv/config'
import 'reflect-metadata'

import { ApiException } from '../infrastructure/http/api.exception'
import type {
  ShipmentOwnershipBackfillOptions,
  ShipmentOwnershipBackfillResult,
} from '../modules/shipment-ownership/shipment-ownership-backfill.service'

interface Dependencies {
  run(options: ShipmentOwnershipBackfillOptions): Promise<ShipmentOwnershipBackfillResult>
  output: { log(value: string): void, error(value: string): void }
  processRef: { exitCode?: number | string | null }
}

function parseArguments(argv: readonly string[]): ShipmentOwnershipBackfillOptions {
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
    else throw new Error('Unknown backfill argument')
  }
  if (limit > 10_000) throw new Error('Invalid backfill limit')
  return { apply, limit }
}

async function runDefault(options: ShipmentOwnershipBackfillOptions): Promise<ShipmentOwnershipBackfillResult> {
  const [{ NestFactory }, { AppModule }, { ShipmentOwnershipBackfillService }] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module'),
    import('../modules/shipment-ownership/shipment-ownership-backfill.service'),
  ])
  const application = await NestFactory.createApplicationContext(AppModule, { abortOnError: false, logger: false })
  try {
    return await application.get(ShipmentOwnershipBackfillService).run(options)
  }
  finally {
    await application.close()
  }
}

/** 默认预览；只输出计数与安全错误码，不输出连接串或原始异常。 */
export async function runShipmentOwnershipBackfillCli(
  argv: readonly string[],
  dependencies: Dependencies = { run: runDefault, output: console, processRef: process },
): Promise<void> {
  try {
    const options = parseArguments(argv)
    const result = await dependencies.run(options)
    dependencies.output.log(JSON.stringify({ kind: 'shipment_ownership_backfill', ...result }))
    if (result.remaining > 0) dependencies.processRef.exitCode = 1
  }
  catch (error) {
    dependencies.output.error(JSON.stringify({
      kind: 'shipment_ownership_backfill',
      status: 'failed',
      code: error instanceof ApiException ? error.code : 'SHIPMENT_OWNERSHIP_BACKFILL_FAILED',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('shipment-ownership-backfill.js')) {
  void runShipmentOwnershipBackfillCli(process.argv.slice(2))
}
