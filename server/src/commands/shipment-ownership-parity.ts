import 'dotenv/config'
import 'reflect-metadata'

import { ApiException } from '../infrastructure/http/api.exception'
import type { ShipmentOwnershipParityResult } from '../modules/shipment-ownership/shipment-ownership-parity.service'

interface Dependencies {
  run(limit: number): Promise<ShipmentOwnershipParityResult>
  output: { log(value: string): void, error(value: string): void }
  processRef: { exitCode?: number | string | null }
}

function parseArguments(argv: readonly string[]): number {
  let limit = 50
  const seen = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (seen.has(key)) throw new Error('Invalid parity arguments')
    seen.add(key)
    if (key === '--limit') {
      const value = argv[++index] ?? ''
      if (!/^[1-9]\d{0,2}$/u.test(value)) throw new Error('Invalid parity limit')
      limit = Number(value)
    }
    else throw new Error('Unknown parity argument')
  }
  if (limit > 500) throw new Error('Invalid parity limit')
  return limit
}

async function runDefault(limit: number): Promise<ShipmentOwnershipParityResult> {
  const [{ NestFactory }, { AppModule }, { ShipmentOwnershipParityService }] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module'),
    import('../modules/shipment-ownership/shipment-ownership-parity.service'),
  ])
  const application = await NestFactory.createApplicationContext(AppModule, { abortOnError: false, logger: false })
  try {
    return await application.get(ShipmentOwnershipParityService).run(limit)
  }
  finally {
    await application.close()
  }
}

/** 迁移阶段门禁：当前归属与采购来源必须零差异。 */
export async function runShipmentOwnershipParityCli(
  argv: readonly string[],
  dependencies: Dependencies = { run: runDefault, output: console, processRef: process },
): Promise<void> {
  try {
    const limit = parseArguments(argv)
    const result = await dependencies.run(limit)
    dependencies.output.log(JSON.stringify({ kind: 'shipment_ownership_parity', ...result }))
    if (result.differences > 0) dependencies.processRef.exitCode = 1
  }
  catch (error) {
    dependencies.output.error(JSON.stringify({
      kind: 'shipment_ownership_parity',
      status: 'failed',
      code: error instanceof ApiException ? error.code : 'SHIPMENT_OWNERSHIP_PARITY_FAILED',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('shipment-ownership-parity.js')) {
  void runShipmentOwnershipParityCli(process.argv.slice(2))
}
