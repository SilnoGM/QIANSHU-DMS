import { runShipmentNumberBackfillCli } from './purchase-shipment-number-backfill'

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function fixture() {
  return { run: jest.fn().mockResolvedValue({ mode: 'DRY_RUN', assigned: 0, remaining: 0, errorCode: null, ruleAvailable: true }), output: { log: jest.fn(), error: jest.fn() }, processRef: { exitCode: 0 } }
}

describe('shipment number backfill CLI', () => {
  it('defaults to dry-run and requires an explicit actor', async () => {
    const dependencies = fixture()
    await runShipmentNumberBackfillCli(['--actor-user-id', actor], dependencies)
    expect(dependencies.run).toHaveBeenCalledWith({ actorUserId: actor, apply: false, limit: 1000 })
  })

  it.each([[], ['--apply'], ['--actor-user-id', actor, '--force'], ['--actor-user-id', actor, '--limit', '0'], ['--actor-user-id', actor, '--apply', '--dry-run']])('rejects invalid arguments without opening a database connection: %j', async (...argv) => {
    const dependencies = fixture()
    await runShipmentNumberBackfillCli(argv, dependencies)
    expect(dependencies.run).not.toHaveBeenCalled()
    expect(dependencies.processRef.exitCode).toBe(1)
  })

  it('uses explicit apply and redacts unknown failure details', async () => {
    const dependencies = fixture()
    dependencies.run.mockRejectedValue(new Error('postgresql://private-credential@internal'))
    await runShipmentNumberBackfillCli(['--actor-user-id', actor, '--apply', '--limit', '30'], dependencies)
    expect(dependencies.run).toHaveBeenCalledWith({ actorUserId: actor, apply: true, limit: 30 })
    expect(dependencies.output.error).toHaveBeenCalledWith('{"kind":"shipment_number_backfill","status":"failed","code":"SHIPMENT_BACKFILL_FAILED"}')
  })
})
