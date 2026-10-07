import { PassThrough, Readable } from 'node:stream'

import type { MediaKeyMigrationCopyOperations } from '../modules/media/media-key-migration-copy.service'
import type {
  MediaKeyMigrationApplyResult,
  MediaKeyMigrationCandidate,
  MediaKeyMigrationOperations,
  MediaKeyMigrationPlan,
  MediaKeyMigrationPreviewSummary,
  MediaKeyMigrationRegistrationResult,
} from '../modules/media/media-key-migration.service'
import {
  createLocalCopyClient,
  runApplyMigration,
  runCopyMigration,
  runCopyMigrationFromEnvironment,
  runMediaKeyMigrationCli,
  runPreviewMigration,
  type MediaKeyMigrationCliDependencies,
  type MediaKeyMigrationCopyReport,
  type MediaKeyMigrationReport,
} from './media-key-migration'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'
const OLD_KEY = `assets/2026/08/${ASSET_ID}.webp`
const NEW_KEY = `assets/prod/product/2026/08/${ASSET_ID}.webp`

const PASSED_REPORT: MediaKeyMigrationReport = {
  applied: 3,
  conflicts: 0,
  missingTarget: 0,
  pools: { product: 4, voucher: 1 },
  registered: 4,
  scanned: 5,
  skipped: 0,
}

const PASSED_COPY_REPORT: MediaKeyMigrationCopyReport = {
  copied: 3,
  failed: 0,
  scanned: 5,
  skipped: 2,
}

function candidate(): MediaKeyMigrationCandidate {
  return {
    assetId: ASSET_ID,
    checksumSha256: 'a'.repeat(64),
    newKey: NEW_KEY,
    oldKey: OLD_KEY,
    sizeBytes: 321n,
  }
}

interface FakeOperations {
  readonly applyBatch: jest.Mock<Promise<MediaKeyMigrationApplyResult>, [number]>
  readonly operations: MediaKeyMigrationOperations
  readonly planCandidates: jest.Mock<Promise<MediaKeyMigrationPlan>, []>
  readonly previewSummary: jest.Mock<Promise<MediaKeyMigrationPreviewSummary>, []>
  readonly registerPlan: jest.Mock<
    Promise<MediaKeyMigrationRegistrationResult>,
    [readonly MediaKeyMigrationCandidate[]]
  >
}

function createOperations(options: {
  readonly applyResults?: readonly MediaKeyMigrationApplyResult[]
  readonly candidates?: readonly MediaKeyMigrationCandidate[]
  readonly planScanned?: number
  readonly preview?: MediaKeyMigrationPreviewSummary
  readonly registration?: MediaKeyMigrationRegistrationResult
} = {}): FakeOperations {
  const applyResults = [...(options.applyResults ?? [{ applied: 0, missingTarget: 0, skipped: 0 }])]
  const candidates = options.candidates ?? []
  const applyBatch = jest.fn<Promise<MediaKeyMigrationApplyResult>, [number]>()
    .mockImplementation(() => {
      const result = applyResults.shift() ?? { applied: 0, missingTarget: 0, skipped: 0 }
      return Promise.resolve(result)
    })
  const planCandidates = jest.fn<Promise<MediaKeyMigrationPlan>, []>().mockResolvedValue({
    candidates,
    scanned: options.planScanned ?? candidates.length,
  })
  const previewSummary = jest.fn<Promise<MediaKeyMigrationPreviewSummary>, []>()
    .mockResolvedValue(options.preview ?? { alreadyRegistered: 0, applied: 0, candidates: 0, pools: {} })
  const registerPlan = jest.fn<
    Promise<MediaKeyMigrationRegistrationResult>,
    [readonly MediaKeyMigrationCandidate[]]
  >().mockResolvedValue(options.registration ?? { conflicts: 0, registered: candidates.length })
  return {
    applyBatch,
    operations: { applyBatch, planCandidates, previewSummary, registerPlan },
    planCandidates,
    previewSummary,
    registerPlan,
  }
}

function createCopyOperations(
  results: readonly { copied: number, failed: number, skipped: number }[] = [],
): { readonly copyBatch: jest.Mock<Promise<{ copied: number, failed: number, skipped: number }>, [readonly MediaKeyMigrationCandidate[]]>, readonly operations: MediaKeyMigrationCopyOperations } {
  const queue = [...results]
  const copyBatch = jest.fn<
    Promise<{ copied: number, failed: number, skipped: number }>,
    [readonly MediaKeyMigrationCandidate[]]
  >().mockImplementation(() => Promise.resolve(queue.shift() ?? { copied: 0, failed: 0, skipped: 0 }))
  return { copyBatch, operations: { copyBatch } }
}

function cliFixture(overrides: Partial<MediaKeyMigrationCliDependencies> = {}) {
  const log = jest.fn<void, [string]>()
  const error = jest.fn<void, [string]>()
  const processRef = { exitCode: undefined as number | undefined }
  const dependencies: MediaKeyMigrationCliDependencies = {
    output: { error, log },
    processRef,
    runCopy: jest.fn().mockResolvedValue(PASSED_COPY_REPORT),
    runMigration: jest.fn().mockResolvedValue(PASSED_REPORT),
    ...overrides,
  }
  return { dependencies, error, log, processRef }
}

function parsedCalls(output: jest.Mock<void, [string]>): unknown[] {
  return output.mock.calls.map(([line]) => JSON.parse(line) as unknown)
}

describe('runPreviewMigration', () => {
  it('stays read-only and reports the work that is waiting', async () => {
    const fixture = createOperations({
      preview: { alreadyRegistered: 7, applied: 2, candidates: 9, pools: { product: 6, voucher: 3 } },
    })

    await expect(runPreviewMigration(fixture.operations)).resolves.toEqual({
      applied: 2,
      conflicts: 0,
      missingTarget: 0,
      // 池分布是生产迁移前复核「哪些对象进哪个池」的唯一依据。
      pools: { product: 6, voucher: 3 },
      registered: 7,
      scanned: 9,
      skipped: 0,
    })
    // preview 只统计：既不登记也不改键。
    expect(fixture.registerPlan).not.toHaveBeenCalled()
    expect(fixture.applyBatch).not.toHaveBeenCalled()
    expect(fixture.planCandidates).not.toHaveBeenCalled()
  })
})

describe('runCopyMigration', () => {
  it('copies the planned candidates in batches without touching the database', async () => {
    const planned = [candidate()]
    const planning = createOperations({ candidates: planned, planScanned: 1 })
    const copy = createCopyOperations([{ copied: 1, failed: 0, skipped: 0 }])

    await expect(runCopyMigration(planning.operations, copy.operations)).resolves.toEqual({
      copied: 1,
      failed: 0,
      scanned: 1,
      skipped: 0,
    })
    expect(copy.copyBatch).toHaveBeenCalledWith(planned)
    // copy 只复制：登记与改键必须留给 apply。
    expect(planning.registerPlan).not.toHaveBeenCalled()
    expect(planning.applyBatch).not.toHaveBeenCalled()
  })

  it('copies in batches of 500 and sums every batch instead of stopping at the first failure', async () => {
    const planned = Array.from({ length: 501 }, (_, index) => ({
      ...candidate(),
      assetId: `00000000-0000-4000-8000-0000000${index.toString().padStart(5, '0')}`,
    }))
    const planning = createOperations({ candidates: planned, planScanned: 501 })
    const copy = createCopyOperations([
      { copied: 499, failed: 1, skipped: 0 },
      { copied: 0, failed: 1, skipped: 0 },
    ])

    await expect(runCopyMigration(planning.operations, copy.operations)).resolves.toEqual({
      copied: 499,
      failed: 2,
      scanned: 501,
      skipped: 0,
    })
    expect(copy.copyBatch.mock.calls.map(([batch]) => batch.length)).toEqual([500, 1])
  })
})

describe('runApplyMigration', () => {
  it('registers the plan first and then rewrites keys batch by batch', async () => {
    const fixture = createOperations({
      applyResults: [
        { applied: 500, missingTarget: 0, skipped: 0 },
        { applied: 500, missingTarget: 0, skipped: 0 },
        { applied: 20, missingTarget: 0, skipped: 0 },
        { applied: 0, missingTarget: 0, skipped: 0 },
      ],
      candidates: [candidate()],
      planScanned: 3,
      registration: { conflicts: 0, registered: 1 },
    })

    await expect(runApplyMigration(fixture.operations)).resolves.toEqual({
      applied: 1020,
      conflicts: 0,
      missingTarget: 0,
      pools: { product: 1 },
      registered: 1,
      scanned: 3,
      skipped: 0,
    })
    expect(fixture.registerPlan).toHaveBeenCalledWith([candidate()])
    // 登记必须先于任何改键：触发器只放行已登记的键对。
    const registrationOrder = fixture.registerPlan.mock.invocationCallOrder[0] ?? 0
    const firstBatchOrder = fixture.applyBatch.mock.invocationCallOrder[0] ?? 0
    expect(registrationOrder).toBeLessThan(firstBatchOrder)
    // 每批固定 500，空批之后停止。
    expect(fixture.applyBatch.mock.calls.map(([limit]) => limit)).toEqual([500, 500, 500, 500])
  })

  it('stops at 100 batches so a stuck registration cannot loop forever', async () => {
    const fixture = createOperations({
      candidates: [candidate()],
      planScanned: 1,
      registration: { conflicts: 0, registered: 1 },
    })
    fixture.applyBatch.mockResolvedValue({ applied: 500, missingTarget: 0, skipped: 0 })

    const report = await runApplyMigration(fixture.operations)

    expect(fixture.applyBatch).toHaveBeenCalledTimes(100)
    expect(report.applied).toBe(50_000)
  })

  it('stops after the first batch that could not rewrite anything and keeps the count truthful', async () => {
    const fixture = createOperations({
      candidates: [candidate()],
      planScanned: 1,
      registration: { conflicts: 0, registered: 1 },
    })
    fixture.applyBatch.mockResolvedValue({ applied: 0, missingTarget: 500, skipped: 0 })

    const report = await runApplyMigration(fixture.operations)

    // 目标缺失的行不会退出待应用集合：继续迭代只会把同一批行重复计数，因此一批无进展即停。
    expect(fixture.applyBatch).toHaveBeenCalledTimes(1)
    expect(report.missingTarget).toBe(500)
    expect(report.applied).toBe(0)
  })

  it('never rewrites keys when the plan conflicts', async () => {
    const fixture = createOperations({
      candidates: [candidate()],
      registration: { conflicts: 2, registered: 0 },
    })

    await expect(runApplyMigration(fixture.operations)).resolves.toEqual({
      applied: 0,
      conflicts: 2,
      missingTarget: 0,
      pools: { product: 1 },
      registered: 0,
      scanned: 1,
      skipped: 0,
    })
    expect(fixture.applyBatch).not.toHaveBeenCalled()
  })

  it('propagates a failing batch instead of continuing with the next one', async () => {
    const fixture = createOperations({ candidates: [candidate()] })
    fixture.applyBatch
      .mockResolvedValueOnce({ applied: 1, missingTarget: 0, skipped: 0 })
      .mockRejectedValueOnce(new Error('database is unavailable'))

    await expect(runApplyMigration(fixture.operations)).rejects.toThrow('database is unavailable')
    expect(fixture.applyBatch).toHaveBeenCalledTimes(2)
  })
})

describe('runMediaKeyMigrationCli', () => {
  it('prints the fixed counters with the requested mode for a clean apply', async () => {
    const { dependencies, log, processRef } = cliFixture()

    await runMediaKeyMigrationCli(['apply'], dependencies)

    expect(processRef.exitCode).toBeUndefined()
    expect(parsedCalls(log)).toEqual([{
      applied: 3,
      conflicts: 0,
      kind: 'media_key_migration',
      missingTarget: 0,
      pools: { product: 4, voucher: 1 },
      registered: 4,
      scanned: 5,
      skipped: 0,
      status: 'passed',
    }])
  })

  it('prints the copy counters for the copy mode', async () => {
    const { dependencies, log, processRef } = cliFixture()

    await runMediaKeyMigrationCli(['copy'], dependencies)

    expect(processRef.exitCode).toBeUndefined()
    expect(parsedCalls(log)).toEqual([{
      copied: 3,
      failed: 0,
      kind: 'media_key_migration',
      scanned: 5,
      skipped: 2,
      status: 'passed',
    }])
  })

  it('passes the requested mode through to the runner', async () => {
    const runMigration = jest.fn().mockResolvedValue(PASSED_REPORT)
    const runCopy = jest.fn().mockResolvedValue(PASSED_COPY_REPORT)
    const { dependencies } = cliFixture({ runCopy, runMigration })

    await runMediaKeyMigrationCli(['preview'], dependencies)

    expect(runMigration).toHaveBeenCalledWith('preview')
    expect(runCopy).not.toHaveBeenCalled()
  })

  it('exits non-zero and reports issues when registrations were not applied', async () => {
    const { dependencies, log, processRef } = cliFixture({
      runMigration: jest.fn().mockResolvedValue({
        applied: 1,
        conflicts: 0,
        missingTarget: 0,
        registered: 2,
        scanned: 2,
        skipped: 1,
      }),
    })

    await runMediaKeyMigrationCli(['apply'], dependencies)

    expect(processRef.exitCode).toBe(1)
    expect(parsedCalls(log)).toContainEqual(expect.objectContaining({ status: 'issues' }))
  })

  it('exits non-zero when the copy phase failed any object', async () => {
    const { dependencies, log, processRef } = cliFixture({
      runCopy: jest.fn().mockResolvedValue({ copied: 1, failed: 2, scanned: 3, skipped: 0 }),
    })

    await runMediaKeyMigrationCli(['copy'], dependencies)

    expect(processRef.exitCode).toBe(1)
    expect(parsedCalls(log)).toContainEqual(expect.objectContaining({
      failed: 2,
      status: 'issues',
    }))
  })

  it('fails closed with the fixed event when the configured storage cannot be mounted', async () => {
    const { dependencies, error, log, processRef } = cliFixture({
      // 本地驱动也支持复制，但存储根不可用时必须在装配阶段失败关闭，而不是报告「什么都没复制」。
      runCopy: () => runCopyMigrationFromEnvironment({
        MEDIA_STORAGE_DRIVER: 'local',
        MEDIA_STORAGE_ROOT: '/',
      }),
    })

    await runMediaKeyMigrationCli(['copy'], dependencies)

    expect(processRef.exitCode).toBe(1)
    expect(error).toHaveBeenCalledWith('{"kind":"media_key_migration","status":"failed"}')
    expect(log).not.toHaveBeenCalled()
  })

  it('copies through staging and finalize for the local driver and cancels on failure', async () => {
    const assetId = '00000000-0000-4000-8000-000000000321'
    const order: string[] = []
    const cancel = jest.fn(() => {
      order.push('cancel')
      return Promise.resolve()
    })
    const createStagingWrite = jest.fn(() => {
      order.push('staging')
      return Promise.resolve({
        cancel,
        key: `staging/${assetId}.00000000-0000-4000-8000-000000000777.part`,
        stream: new PassThrough(),
      })
    })
    const finalize = jest.fn((_stagingKey: string, objectKey: string) => {
      order.push(`finalize:${objectKey}`)
      return Promise.resolve()
    })
    const client = createLocalCopyClient({ createStagingWrite, finalize } as never)

    await client.putObject({
      assetId,
      contentLength: 3,
      key: `assets/dev/product/2026/08/${assetId}.webp`,
      sha256: 'a'.repeat(64),
      stream: Readable.from([Buffer.from('abc')]),
    })

    expect(order).toEqual(['staging', `finalize:assets/dev/product/2026/08/${assetId}.webp`])
    expect(cancel).not.toHaveBeenCalled()

    // 落位失败必须取消 staging 写入并向上抛错：半成品留在磁盘上会阻塞后续重试。
    const failingFinalize = jest.fn(() => Promise.reject(new Error('media storage conflict')))
    const failingClient = createLocalCopyClient({
      createStagingWrite,
      finalize: failingFinalize,
    } as never)
    await expect(failingClient.putObject({
      assetId,
      contentLength: 3,
      key: `assets/dev/product/2026/08/${assetId}.webp`,
      sha256: 'a'.repeat(64),
      stream: Readable.from([Buffer.from('abc')]),
    })).rejects.toThrow('media storage conflict')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('fails with one fixed event and never touches the runner for unsupported input', async () => {
    for (const argv of [[], ['switch'], ['apply', 'preview'], ['APPLY']]) {
      const fixture = cliFixture()

      await runMediaKeyMigrationCli(argv, fixture.dependencies)

      expect(fixture.processRef.exitCode).toBe(1)
      expect(fixture.error).toHaveBeenCalledWith(
        '{"kind":"media_key_migration","status":"failed"}',
      )
      // 参数不合法时连服务都不装配：既不读也不写。
      expect(fixture.dependencies.runMigration).not.toHaveBeenCalled()
      expect(fixture.dependencies.runCopy).not.toHaveBeenCalled()
      expect(fixture.log).not.toHaveBeenCalled()
    }
  })

  it('fails with the same fixed event for an internal error, without leaking keys or ids', async () => {
    const { dependencies, error, log, processRef } = cliFixture({
      runMigration: jest.fn().mockRejectedValue(
        new Error(`update failed for ${OLD_KEY} (${ASSET_ID})`),
      ),
    })

    await runMediaKeyMigrationCli(['apply'], dependencies)

    expect(processRef.exitCode).toBe(1)
    expect(error).toHaveBeenCalledWith('{"kind":"media_key_migration","status":"failed"}')
    expect(log).not.toHaveBeenCalled()
    // 异常原文可能带对象键与资产标识，输出里不得出现任何片段。
    expect(JSON.stringify(error.mock.calls)).not.toContain(OLD_KEY)
    expect(JSON.stringify(error.mock.calls)).not.toContain(ASSET_ID)
  })
})
