import {
  runMediaMigrationCli,
  type MediaMigrationCliDependencies,
  type MediaMigrationReport,
} from './media-migration'

const passed: MediaMigrationReport = {
  copied: 3,
  failed: 0,
  flipped: 3,
  scanned: 4,
  skipped: 1,
}

function fixture(
  overrides: Partial<MediaMigrationCliDependencies> = {},
) {
  const log = jest.fn<void, [string]>()
  const error = jest.fn<void, [string]>()
  const processRef = { exitCode: undefined as number | undefined }
  const dependencies: MediaMigrationCliDependencies = {
    output: { error, log },
    processRef,
    runMigration: jest.fn().mockResolvedValue(passed),
    ...overrides,
  }
  return { dependencies, error, log, processRef }
}

function parsedCalls(output: jest.Mock<void, [string]>): unknown[] {
  return output.mock.calls.map(([line]) => JSON.parse(line) as unknown)
}

describe('runMediaMigrationCli', () => {
  it('prints fixed counters and low-cardinality metrics for a successful apply', async () => {
    const { dependencies, log, processRef } = fixture()

    await runMediaMigrationCli(['apply'], dependencies)

    expect(processRef.exitCode).toBeUndefined()
    expect(parsedCalls(log)).toContainEqual({
      copied: 3,
      failed: 0,
      flipped: 3,
      kind: 'media_migration',
      mode: 'apply',
      scanned: 4,
      skipped: 1,
      status: 'passed',
    })
    expect(parsedCalls(log)).toContainEqual({
      kind: 'metric',
      labels: { mode: 'apply', result: 'copied' },
      metric: 'media_migration_total',
      value: 3,
    })
  })

  it('passes the requested mode through and never flips the driver on preview', async () => {
    const runMigration = jest.fn().mockResolvedValue({ ...passed, flipped: 0 })
    const { dependencies } = fixture({ runMigration })

    await runMediaMigrationCli(['preview'], dependencies)

    expect(runMigration).toHaveBeenCalledWith('preview')
  })

  it('exits non-zero when any object failed to migrate', async () => {
    const { dependencies, log, processRef } = fixture({
      runMigration: jest.fn().mockResolvedValue({
        copied: 1,
        failed: 2,
        flipped: 0,
        scanned: 3,
        skipped: 0,
      }),
    })

    await runMediaMigrationCli(['apply'], dependencies)

    expect(processRef.exitCode).toBe(1)
    expect(parsedCalls(log)).toContainEqual(expect.objectContaining({ status: 'issues' }))
  })

  it('fails with one fixed event for unsupported input or an internal error', async () => {
    const unsupported = fixture()
    await runMediaMigrationCli(['switch'], unsupported.dependencies)
    expect(unsupported.processRef.exitCode).toBe(1)
    expect(unsupported.error).toHaveBeenCalledWith(
      '{"kind":"media_migration","status":"failed"}',
    )

    const failed = fixture({
      runMigration: jest.fn().mockRejectedValue(
        new Error('cos://bucket/secret-connection-string'),
      ),
    })
    await runMediaMigrationCli(['apply'], failed.dependencies)
    expect(failed.processRef.exitCode).toBe(1)
    // 底层异常可能带桶名或连接串，输出里不得出现任何原文。
    expect(JSON.stringify(failed.error.mock.calls)).not.toContain('secret-connection-string')
    expect(JSON.stringify(failed.log.mock.calls)).not.toContain('secret-connection-string')
  })
})
