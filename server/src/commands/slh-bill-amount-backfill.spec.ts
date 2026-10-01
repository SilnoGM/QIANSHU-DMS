import { runSlhBillAmountBackfillCli } from './slh-bill-amount-backfill'

function fixture() {
  return {
    run: jest.fn().mockResolvedValue({ bills: [], blankToNull: 0, explicitZeroKept: 0, mode: 'DRY_RUN', rollbackPath: null, skipped: 0 }),
    output: { error: jest.fn(), log: jest.fn() },
    processRef: { exitCode: 0 },
  }
}

describe('slh bill amount backfill CLI', () => {
  it('defaults to dry-run', async () => {
    const dependencies = fixture()
    await runSlhBillAmountBackfillCli([], dependencies)
    expect(dependencies.run).toHaveBeenCalledWith({ apply: false, limit: 1000 })
    expect(dependencies.processRef.exitCode).toBe(0)
  })

  it.each([['--limit'], ['--limit', '0'], ['--limit', '100000'], ['--apply', '--dry-run'], ['--apply', '--apply'], ['--force']])('rejects invalid arguments without opening a database connection: %j', async (...argv) => {
    const dependencies = fixture()
    await runSlhBillAmountBackfillCli(argv, dependencies)
    expect(dependencies.run).not.toHaveBeenCalled()
    expect(dependencies.processRef.exitCode).toBe(1)
  })

  it('accepts explicit apply with a bounded limit', async () => {
    const dependencies = fixture()
    await runSlhBillAmountBackfillCli(['--apply', '--limit', '30'], dependencies)
    expect(dependencies.run).toHaveBeenCalledWith({ apply: true, limit: 30 })
  })

  it('fails the run when a bill was skipped in apply mode', async () => {
    const dependencies = fixture()
    dependencies.run.mockResolvedValue({ bills: [], blankToNull: 0, explicitZeroKept: 0, mode: 'APPLY', rollbackPath: '/tmp/rollback.json', skipped: 1 })
    await runSlhBillAmountBackfillCli(['--apply'], dependencies)
    expect(dependencies.processRef.exitCode).toBe(1)
  })

  it('keeps dry-run successful even when a bill is skipped', async () => {
    const dependencies = fixture()
    dependencies.run.mockResolvedValue({ bills: [], blankToNull: 0, explicitZeroKept: 0, mode: 'DRY_RUN', rollbackPath: null, skipped: 1 })
    await runSlhBillAmountBackfillCli([], dependencies)
    expect(dependencies.processRef.exitCode).toBe(0)
  })

  it('redacts unknown failure details', async () => {
    const dependencies = fixture()
    dependencies.run.mockRejectedValue(new Error('postgresql://private-credential@internal'))
    await runSlhBillAmountBackfillCli(['--apply'], dependencies)
    expect(dependencies.output.error).toHaveBeenCalledWith('{"code":"SLH_BILL_AMOUNT_BACKFILL_FAILED","kind":"slh_bill_amount_backfill","status":"failed"}')
  })
})
