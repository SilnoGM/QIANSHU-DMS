import { runFundPostingBatchNumberBackfillCli } from './fund-posting-batch-number-backfill'
import type { FundPostingBatchNumberBackfillResult } from '../modules/fund-accounts/application/fund-posting-batch-number-backfill.service'

function result(
  overrides: Partial<FundPostingBatchNumberBackfillResult> = {},
): FundPostingBatchNumberBackfillResult {
  return {
    mode: 'DRY_RUN',
    selected: 0,
    assigned: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
    ruleAvailable: true,
    errorCode: null,
    mappings: [],
    ...overrides,
  }
}

function fixture(
  overrides: Partial<FundPostingBatchNumberBackfillResult> = {},
) {
  const output = {
    log: jest.fn<void, [string]>(),
    error: jest.fn<void, [string]>(),
  }
  const processRef: { exitCode?: number | string | null } = {}
  const run = jest.fn().mockResolvedValue(result(overrides))
  return { run, output, processRef }
}

describe('fund posting batch number backfill CLI', () => {
  it('defaults to dry-run and emits the structured result', async () => {
    const dependencies = fixture({ selected: 2, assigned: 2 })
    await runFundPostingBatchNumberBackfillCli([], dependencies)

    expect(dependencies.run).toHaveBeenCalledWith({
      apply: false,
      limit: 1000,
    })
    const logged = dependencies.output.log.mock.calls[0]?.[0]
    expect(logged).toEqual(expect.any(String))
    expect(JSON.parse(logged ?? '')).toMatchObject({
      kind: 'fund_posting_batch_number_backfill',
      mode: 'DRY_RUN',
      selected: 2,
      assigned: 2,
    })
    expect(dependencies.processRef.exitCode).toBeUndefined()
  })

  it('passes apply and a bounded limit', async () => {
    const dependencies = fixture()
    await runFundPostingBatchNumberBackfillCli(
      ['--apply', '--limit', '25'],
      dependencies,
    )

    expect(dependencies.run).toHaveBeenCalledWith({
      apply: true,
      limit: 25,
    })
  })

  it('rejects conflicting modes without running the service', async () => {
    const dependencies = fixture()
    await runFundPostingBatchNumberBackfillCli(
      ['--apply', '--dry-run'],
      dependencies,
    )

    expect(dependencies.run).not.toHaveBeenCalled()
    expect(dependencies.output.error).toHaveBeenCalledWith(JSON.stringify({
      kind: 'fund_posting_batch_number_backfill',
      status: 'failed',
      code: 'FUND_POSTING_NUMBER_BACKFILL_FAILED',
    }))
    expect(dependencies.processRef.exitCode).toBe(1)
  })

  it('fails closed when the rule is unavailable or a write fails', async () => {
    const ruleUnavailable = fixture({
      remaining: 1,
      ruleAvailable: false,
      errorCode: 'FUND_POSTING_NUMBERING_UNAVAILABLE',
      failed: 1,
    })
    await runFundPostingBatchNumberBackfillCli([], ruleUnavailable)
    expect(ruleUnavailable.processRef.exitCode).toBe(1)

    const failed = fixture({
      selected: 1,
      failed: 1,
      errorCode: 'FUND_POSTING_NUMBER_BACKFILL_FAILED',
    })
    await runFundPostingBatchNumberBackfillCli(['--apply'], failed)
    expect(failed.processRef.exitCode).toBe(1)
  })
})
