import 'dotenv/config'
import 'reflect-metadata'

import { ApiException } from '../infrastructure/http/api.exception'
import type {
  ContainerShipmentBackfillOptions,
  ContainerShipmentBackfillResult,
} from '../modules/container-batches/container-shipment-backfill.service'

interface Dependencies {
  run(options: ContainerShipmentBackfillOptions): Promise<ContainerShipmentBackfillResult>
  output: { log(value: string): void, error(value: string): void }
  processRef: { exitCode?: number | string | null }
}

function parseArguments(
  argv: readonly string[],
): ContainerShipmentBackfillOptions {
  let apply = false
  let modeSeen = false
  let actorUserId: string | undefined
  let limit = 1000
  const seen = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (seen.has(key)) throw new Error('Invalid container backfill arguments')
    seen.add(key)
    if (key === '--apply' || key === '--dry-run') {
      if (modeSeen) throw new Error('Conflicting container backfill mode')
      modeSeen = true
      apply = key === '--apply'
    }
    else if (key === '--actor-user-id') {
      actorUserId = argv[++index]
    }
    else if (key === '--limit') {
      const value = argv[++index] ?? ''
      if (!/^[1-9]\d{0,4}$/u.test(value)) throw new Error('Invalid container backfill limit')
      limit = Number(value)
    }
    else {
      throw new Error('Unknown container backfill argument')
    }
  }

  if (limit > 10_000) throw new Error('Invalid container backfill limit')
  if (
    actorUserId !== undefined
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(actorUserId)
  ) {
    throw new Error('Invalid container backfill actor')
  }
  if (apply && actorUserId === undefined) {
    throw new Error('Missing container backfill actor')
  }
  return { apply, actorUserId, limit }
}

async function runDefault(
  options: ContainerShipmentBackfillOptions,
): Promise<ContainerShipmentBackfillResult> {
  const [
    { NestFactory },
    { AppModule },
    { ContainerShipmentBackfillService },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module'),
    import('../modules/container-batches/container-shipment-backfill.service'),
  ])
  const application = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false,
  })
  try {
    return await application.get(ContainerShipmentBackfillService).run(options)
  }
  finally {
    await application.close()
  }
}

/** 默认预览；执行必须显式 --apply 并提供有效操作人。日志只输出计数与稳定错误码。 */
export async function runContainerShipmentBackfillCli(
  argv: readonly string[],
  dependencies: Dependencies = { run: runDefault, output: console, processRef: process },
): Promise<void> {
  try {
    const options = parseArguments(argv)
    const result = await dependencies.run(options)
    dependencies.output.log(JSON.stringify({
      kind: 'container_shipment_backfill',
      ...result,
    }))
    if (result.failed > 0 || result.errorCode !== null) {
      dependencies.processRef.exitCode = 1
    }
  }
  catch (error) {
    dependencies.output.error(JSON.stringify({
      kind: 'container_shipment_backfill',
      status: 'failed',
      code: error instanceof ApiException
        ? error.code
        : error instanceof SyntaxError
          ? 'CONTAINER_BACKFILL_FAILED'
          : 'CONTAINER_BACKFILL_FAILED',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (require.main === module) void runContainerShipmentBackfillCli(process.argv.slice(2))
