import type {
  MediaReconciliationCleanupResult,
  MediaReconciliationDryRunResult,
} from '../modules/media/media-reconciliation.service'
import type { MediaOperationalHealthResult } from '../modules/media/media-operational-health'
import {
  runMediaOperationsCli,
  type MediaOperationsCliDependencies,
} from './media-operations'

const healthy: MediaOperationalHealthResult = {
  capabilities: {
    read: { code: 'MEDIA_READ_READY', status: 'up' },
    videoValidator: { code: 'MEDIA_VIDEO_VALIDATOR_READY', status: 'up' },
    write: { code: 'MEDIA_WRITE_READY', status: 'up' },
  },
  capacity: { freePercent: 50, level: 'ok' },
  status: 'healthy',
}

const recovery: MediaReconciliationDryRunResult = {
  complete: true,
  databaseScanned: 2,
  issues: {
    checksumMismatch: 0,
    duplicateLocation: 0,
    missing: 0,
    orphanObject: 0,
    sizeMismatch: 0,
    unexpectedLocation: 0,
    unmappableObject: 0,
  },
  matched: 2,
  storageScanned: 2,
}

const cleanup: MediaReconciliationCleanupResult = {
  completed: 2,
  failed: 0,
  isolated: 0,
  scanned: 2,
}

function fixture(
  overrides: Partial<MediaOperationsCliDependencies> = {},
) {
  const log = jest.fn<void, [string]>()
  const error = jest.fn<void, [string]>()
  const processRef = { exitCode: undefined as number | undefined }
  const dependencies: MediaOperationsCliDependencies = {
    collectHealth: jest.fn().mockResolvedValue(healthy),
    output: { error, log },
    processRef,
    runExpiredTrashCleanup: jest.fn().mockResolvedValue(cleanup),
    runRecoveryDryRun: jest.fn().mockResolvedValue(recovery),
    ...overrides,
  }
  return { dependencies, error, log, processRef }
}

function parsedCalls(log: jest.Mock<void, [string]>): unknown[] {
  return log.mock.calls.map(([line]) => JSON.parse(line) as unknown)
}

describe('runMediaOperationsCli', () => {
  it('prints sanitized capability and capacity metrics for the health command', async () => {
    const { dependencies, log, processRef } = fixture()

    await runMediaOperationsCli(['health'], dependencies)

    expect(processRef.exitCode).toBeUndefined()
    expect(parsedCalls(log)).toEqual([
      { component: 'media', kind: 'health', ...healthy },
      {
        kind: 'metric',
        labels: {},
        metric: 'media_capacity_free_percent',
        value: 50,
      },
      {
        kind: 'metric',
        labels: { capability: 'read' },
        metric: 'media_capability',
        value: 1,
      },
      {
        kind: 'metric',
        labels: { capability: 'write' },
        metric: 'media_capability',
        value: 1,
      },
      {
        kind: 'metric',
        labels: { capability: 'video_validator' },
        metric: 'media_capability',
        value: 1,
      },
    ])
  })

  it('returns non-zero for a recovery mismatch without printing identifiers', async () => {
    const sensitiveCanary = 'assets/2026/08/customer-secret.webp'
    const { dependencies, log, processRef } = fixture({
      runRecoveryDryRun: jest.fn().mockResolvedValue({
        ...recovery,
        issues: { ...recovery.issues, checksumMismatch: 1 },
      }),
    })

    await runMediaOperationsCli(['recovery-dry-run'], dependencies)

    expect(processRef.exitCode).toBe(1)
    expect(parsedCalls(log)[0]).toEqual({
      complete: true,
      databaseScanned: 2,
      issues: { ...recovery.issues, checksumMismatch: 1 },
      kind: 'media_recovery_dry_run',
      matched: 2,
      status: 'issues',
      storageScanned: 2,
    })
    expect(JSON.stringify(parsedCalls(log))).not.toContain(sensitiveCanary)
  })

  it('runs bounded expired-trash cleanup and emits only fixed low-cardinality results', async () => {
    const { dependencies, log, processRef } = fixture()

    await runMediaOperationsCli(['cleanup-expired-trash'], dependencies)

    expect(dependencies.runExpiredTrashCleanup).toHaveBeenCalledTimes(1)
    expect(processRef.exitCode).toBeUndefined()
    expect(parsedCalls(log)).toEqual([
      {
        completed: 2,
        failed: 0,
        isolated: 0,
        kind: 'media_cleanup',
        operation: 'expired_trash',
        scanned: 2,
        status: 'passed',
      },
      {
        kind: 'metric',
        labels: { operation: 'expired_trash', result: 'completed' },
        metric: 'media_cleanup_total',
        value: 2,
      },
      {
        kind: 'metric',
        labels: { operation: 'expired_trash', result: 'failed' },
        metric: 'media_cleanup_total',
        value: 0,
      },
      {
        kind: 'metric',
        labels: { operation: 'expired_trash', result: 'isolated' },
        metric: 'media_cleanup_total',
        value: 0,
      },
    ])
  })

  it.each([
    ['failed', { ...cleanup, completed: 0, failed: 1, scanned: 1 }],
    ['isolated', { ...cleanup, completed: 0, isolated: 1, scanned: 1 }],
  ] as const)('returns non-zero when expired-trash cleanup has %s assets', async (_, result) => {
    const sensitiveCanary = 'trash/2026/08/customer-secret.mov'
    const { dependencies, log, processRef } = fixture({
      runExpiredTrashCleanup: jest.fn().mockResolvedValue(result),
    })

    await runMediaOperationsCli(['cleanup-expired-trash'], dependencies)

    expect(processRef.exitCode).toBe(1)
    expect(parsedCalls(log)[0]).toMatchObject({
      kind: 'media_cleanup',
      operation: 'expired_trash',
      status: 'issues',
    })
    expect(JSON.stringify(parsedCalls(log))).not.toContain(sensitiveCanary)
  })

  it('lets preflight keep read service available when only write or video is degraded', async () => {
    const { dependencies, processRef } = fixture({
      collectHealth: jest.fn().mockResolvedValue({
        ...healthy,
        capabilities: {
          ...healthy.capabilities,
          videoValidator: {
            code: 'MEDIA_VIDEO_VALIDATOR_UNAVAILABLE',
            status: 'down',
          },
          write: { code: 'MEDIA_CAPACITY_CRITICAL', status: 'down' },
        },
        capacity: { freePercent: 9, level: 'critical' },
        status: 'degraded',
      }),
    })

    await runMediaOperationsCli(['preflight'], dependencies)

    expect(processRef.exitCode).toBeUndefined()

    const blocked = fixture({
      collectHealth: jest.fn().mockResolvedValue({
        ...healthy,
        capabilities: {
          ...healthy.capabilities,
          read: { code: 'MEDIA_READ_UNAVAILABLE', status: 'down' },
        },
        status: 'down',
      }),
    })
    await runMediaOperationsCli(['preflight'], blocked.dependencies)
    expect(blocked.processRef.exitCode).toBe(1)
  })

  it('fails with one fixed message for unsupported input or an internal error', async () => {
    const unsupported = fixture()
    await runMediaOperationsCli(['unsupported'], unsupported.dependencies)
    expect(unsupported.processRef.exitCode).toBe(1)
    expect(unsupported.error).toHaveBeenCalledWith(
      '{"kind":"media_operations","status":"failed"}',
    )

    const failed = fixture({
      collectHealth: jest.fn().mockRejectedValue(new Error('secret canary')),
    })
    await runMediaOperationsCli(['health'], failed.dependencies)
    expect(failed.processRef.exitCode).toBe(1)
    expect(failed.error).toHaveBeenCalledWith(
      '{"kind":"media_operations","status":"failed"}',
    )
    expect(JSON.stringify(failed.error.mock.calls)).not.toContain('secret canary')
  })
})
