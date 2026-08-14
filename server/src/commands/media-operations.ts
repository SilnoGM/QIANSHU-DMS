import 'dotenv/config'
import 'reflect-metadata'

import { createMediaConfiguration } from '../config/media.config'
import {
  collectMediaOperationalHealth,
  type MediaOperationalHealthResult,
} from '../modules/media/media-operational-health'
import type {
  MediaReconciliationDryRunResult,
  MediaReconciliationService,
} from '../modules/media/media-reconciliation.service'

export interface MediaOperationsOutput {
  error(message: string): void
  log(message: string): void
}

export interface MediaOperationsProcess {
  exitCode?: number | string | null
}

export interface MediaOperationsCliDependencies {
  readonly collectHealth: () => Promise<MediaOperationalHealthResult>
  readonly output: MediaOperationsOutput
  readonly processRef: MediaOperationsProcess
  readonly runRecoveryDryRun: () => Promise<MediaReconciliationDryRunResult>
}

type MediaOperationsCommand = 'health' | 'preflight' | 'recovery-dry-run'

function parseCommand(argv: readonly string[]): MediaOperationsCommand {
  if (
    argv.length !== 1 ||
    !['health', 'preflight', 'recovery-dry-run'].includes(argv[0] ?? '')
  ) {
    throw new Error('Media operations command is invalid')
  }
  return argv[0] as MediaOperationsCommand
}

async function collectDefaultHealth(): Promise<MediaOperationalHealthResult> {
  return collectMediaOperationalHealth(createMediaConfiguration(process.env))
}

async function runDefaultRecoveryDryRun(): Promise<MediaReconciliationDryRunResult> {
  // 动态加载 Nest 应用，health/preflight 因此不会初始化数据库或 HTTP 模块。
  const [{ NestFactory }, { AppModule }, { MediaReconciliationService }] =
    await Promise.all([
      import('@nestjs/core'),
      import('../app.module'),
      import('../modules/media/media-reconciliation.service'),
    ])
  const application = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false,
  })
  try {
    const reconciler = application.get<MediaReconciliationService>(
      MediaReconciliationService,
    )
    return await reconciler.dryRun({
      batchSize: 100,
      maxBatches: 10_000,
      timeBudgetMs: 60_000,
    })
  }
  finally {
    await application.close().catch(() => undefined)
  }
}

function defaultDependencies(): MediaOperationsCliDependencies {
  return {
    collectHealth: collectDefaultHealth,
    output: console,
    processRef: process,
    runRecoveryDryRun: runDefaultRecoveryDryRun,
  }
}

function metric(
  name: string,
  value: number,
  labels: Readonly<Record<string, string>>,
): string {
  return JSON.stringify({ kind: 'metric', labels, metric: name, value })
}

function issueTotal(result: MediaReconciliationDryRunResult): number {
  const issues = result.issues
  return issues.checksumMismatch +
    issues.duplicateLocation +
    issues.missing +
    issues.orphanObject +
    issues.sizeMismatch +
    issues.unexpectedLocation +
    issues.unmappableObject
}

function emitHealth(
  result: MediaOperationalHealthResult,
  output: MediaOperationsOutput,
): void {
  output.log(JSON.stringify({ component: 'media', kind: 'health', ...result }))
  if (result.capacity.freePercent !== null) {
    output.log(metric(
      'media_capacity_free_percent',
      result.capacity.freePercent,
      {},
    ))
  }
  for (const [capabilityName, capabilityResult] of [
    ['read', result.capabilities.read],
    ['write', result.capabilities.write],
    ['video_validator', result.capabilities.videoValidator],
  ] as const) {
    output.log(metric(
      'media_capability',
      capabilityResult.status === 'up' ? 1 : 0,
      { capability: capabilityName },
    ))
  }
}

function emitRecovery(
  result: MediaReconciliationDryRunResult,
  output: MediaOperationsOutput,
): 'incomplete' | 'issues' | 'passed' {
  const status = !result.complete
    ? 'incomplete'
    : issueTotal(result) > 0
      ? 'issues'
      : 'passed'
  output.log(JSON.stringify({
    complete: result.complete,
    databaseScanned: result.databaseScanned,
    issues: result.issues,
    kind: 'media_recovery_dry_run',
    matched: result.matched,
    status,
    storageScanned: result.storageScanned,
  }))
  const issues = result.issues
  for (const [kind, value] of [
    ['checksumMismatch', issues.checksumMismatch],
    ['duplicateLocation', issues.duplicateLocation],
    ['missing', issues.missing],
    ['orphanObject', issues.orphanObject],
    ['sizeMismatch', issues.sizeMismatch],
    ['unexpectedLocation', issues.unexpectedLocation],
    ['unmappableObject', issues.unmappableObject],
  ] as const) {
    output.log(metric('media_reconciliation_mismatch', value, { kind }))
  }
  return status
}

/**
 * 运维 CLI 只输出固定 JSON 合同。原始异常可能包含连接串、root 或文件名，因此所有失败
 * 都收敛为同一个固定事件；调用方依赖 exitCode 和低基数计数定位，不依赖异常文本。
 */
export async function runMediaOperationsCli(
  argv: readonly string[],
  dependencies: MediaOperationsCliDependencies = defaultDependencies(),
): Promise<void> {
  try {
    const command = parseCommand(argv)
    if (command === 'recovery-dry-run') {
      const status = emitRecovery(
        await dependencies.runRecoveryDryRun(),
        dependencies.output,
      )
      if (status !== 'passed') dependencies.processRef.exitCode = 1
      return
    }

    const result = await dependencies.collectHealth()
    emitHealth(result, dependencies.output)
    if (
      (command === 'preflight' && result.status === 'down') ||
      (command === 'health' && result.status !== 'healthy')
    ) {
      dependencies.processRef.exitCode = 1
    }
  }
  catch {
    dependencies.output.error(JSON.stringify({
      kind: 'media_operations',
      status: 'failed',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (require.main === module) {
  void runMediaOperationsCli(process.argv.slice(2))
}
