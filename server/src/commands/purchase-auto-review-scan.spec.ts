import {
  parsePurchaseAutoReviewScanArguments,
  runPurchaseAutoReviewScanCli,
} from './purchase-auto-review-scan'

const SUMMARY = {
  status: 'completed' as const,
  dryRun: false,
  enabled: true,
  claimed: 1,
  succeeded: 1,
  cancelled: 0,
  retried: 0,
  failed: 0,
  notificationFailed: 0,
  candidates: [] as string[],
}

describe('parsePurchaseAutoReviewScanArguments', () => {
  it('defaults to a real run without a limit', () => {
    expect(parsePurchaseAutoReviewScanArguments([])).toEqual({ dryRun: false, limit: undefined })
  })

  it('parses dry-run and a bounded limit', () => {
    expect(parsePurchaseAutoReviewScanArguments(['--dry-run', '--limit=3']))
      .toEqual({ dryRun: true, limit: 3 })
  })

  it.each([
    ['--limit=0'],
    ['--limit=-1'],
    ['--limit=abc'],
    ['--limit'],
    ['--apply'],
  ])('rejects unsupported argument %s', argument => {
    expect(() => parsePurchaseAutoReviewScanArguments([argument])).toThrow()
  })
})

describe('runPurchaseAutoReviewScanCli', () => {
  function harness(result = SUMMARY) {
    const log = jest.fn()
    const error = jest.fn()
    const run = jest.fn().mockResolvedValue(result)
    return { error, log, run, output: { log, error } }
  }

  it('prints one JSON line and returns success', async () => {
    const fixture = harness()
    await expect(runPurchaseAutoReviewScanCli(['--dry-run'], {
      run: fixture.run,
      output: fixture.output,
    })).resolves.toBe(0)
    expect(fixture.run).toHaveBeenCalledWith({ dryRun: true, limit: undefined })
    expect(fixture.log).toHaveBeenCalledWith(JSON.stringify({
      kind: 'purchase_auto_review_scan',
      ...SUMMARY,
    }))
  })

  it('returns a failing exit code when a failure notification could not be enqueued', async () => {
    const fixture = harness({ ...SUMMARY, notificationFailed: 1 })
    await expect(runPurchaseAutoReviewScanCli([], {
      run: fixture.run,
      output: fixture.output,
    })).resolves.toBe(1)
  })

  it('hides unexpected errors behind a fixed message', async () => {
    const fixture = harness()
    fixture.run.mockRejectedValue(new Error('postgres://user:secret@db'))
    await expect(runPurchaseAutoReviewScanCli([], {
      run: fixture.run,
      output: fixture.output,
    })).resolves.toBe(1)
    expect(fixture.error).toHaveBeenCalledWith('Purchase auto review scan failed')
  })
})
