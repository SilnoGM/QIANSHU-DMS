import 'dotenv/config'
import 'reflect-metadata'

import { ApiException } from '../infrastructure/http/api.exception'
import type {
  ContainerShipmentOrphanCleanupOptions,
  ContainerShipmentOrphanCleanupResult,
} from '../modules/container-batches/container-shipment-orphan-cleanup.service'

interface Dependencies {
  run(options: ContainerShipmentOrphanCleanupOptions): Promise<ContainerShipmentOrphanCleanupResult>
  output: { log(value: string): void, error(value: string): void }
  processRef: { exitCode?: number | string | null }
}

function parseArguments(
  argv: readonly string[],
): ContainerShipmentOrphanCleanupOptions {
  let apply = false
  let modeSeen = false
  let actorUserId: string | undefined
  let limit = 1000
  const seen = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (seen.has(key)) throw new Error('Invalid orphan cleanup arguments')
    seen.add(key)
    if (key === '--apply' || key === '--dry-run') {
      if (modeSeen) throw new Error('Conflicting orphan cleanup mode')
      modeSeen = true
      apply = key === '--apply'
    }
    else if (key === '--actor-user-id') {
      actorUserId = argv[++index]
    }
    else if (key === '--limit') {
      const value = argv[index + 1] ?? ''
      if (!/^[1-9]\d{0,4}$/u.test(value)) throw new Error('Invalid orphan cleanup limit')
      limit = Number(value)
      index += 1
    }
    else {
      throw new Error('Unknown orphan cleanup argument')
    }
  }
  if (limit > 10_000) throw new Error('Invalid orphan cleanup limit')
  if (
    actorUserId !== undefined
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(actorUserId)
  ) {
    throw new Error('Invalid orphan cleanup actor')
  }
  if (apply && actorUserId === undefined) {
    throw new Error('Missing orphan cleanup actor')
  }
  return { apply, actorUserId, limit }
}

async function runDefault(
  options: ContainerShipmentOrphanCleanupOptions,
): Promise<ContainerShipmentOrphanCleanupResult> {
  const [
    { NestFactory },
    { AppModule },
    { ContainerShipmentOrphanCleanupService },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module'),
    import('../modules/container-batches/container-shipment-orphan-cleanup.service'),
  ])
  const application = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false,
  })
  try {
    return await application.get(ContainerShipmentOrphanCleanupService).run(options)
  }
  finally {
    await application.close()
  }
}

/** 默认预览；执行必须显式 --apply 并提供有效操作人。日志只输出计数与稳定错误码。 */
export async function runContainerShipmentOrphanCleanupCli(
  argv: readonly string[],
  dependencies: Dependencies = { run: runDefault, output: console, processRef: process },
): Promise<void> {
  try {
    const options = parseArguments(argv)
    const result = await dependencies.run(options)
    dependencies.output.log(JSON.stringify({
      kind: 'container_shipment_orphan_cleanup',
      ...result,
    }))
    if (result.failed > 0 || result.errorCode !== null) {
      dependencies.processRef.exitCode = 1
    }
  }
  catch (error) {
    dependencies.output.error(JSON.stringify({
      kind: 'container_shipment_orphan_cleanup',
      status: 'failed',
      code: error instanceof ApiException
        ? error.code
        : 'CONTAINER_ORPHAN_CLEANUP_FAILED',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (require.main === module) void runContainerShipmentOrphanCleanupCli(process.argv.slice(2))
