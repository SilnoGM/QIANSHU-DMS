import { OceanFreightBillService } from './ocean-freight-bill.service'
import { fingerprint, normalizeBill, normalizeBillLine } from './ocean-freight-bill.normalizer'

const actorUserId = '10000000-0000-4000-8000-000000000001'
const id = '10000000-0000-4000-8000-000000000002'
const key = '10000000-0000-4000-8000-000000000003'
const dates = { createdAt: new Date(), updatedAt: new Date() }
const input = { billName: 'Bill', twdPerCny: '4.8' }
function setup() {
  const tx = { $queryRaw: jest.fn().mockResolvedValue([]), user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    oceanFreightBill: { findUnique: jest.fn(), create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id, ...dates, ...data })), update: jest.fn() },
    oceanFreightBillLine: { findUnique: jest.fn(), findFirst: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _max: { lineNumber: 0 } }), create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id, ...dates, ...data })) },
    containerLoadingItem: { findUnique: jest.fn() },
  }
  const prisma = { $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)) }
  const access = { getPermissionCodesInTransaction: jest.fn().mockResolvedValue([]), hasAll: jest.fn().mockReturnValue(true) }
  const numbering = { generateScopedInTransaction: jest.fn().mockResolvedValue({ number: 'BILL-1', issuanceId: id }) }
  const audit = { record: jest.fn() }
  const source = { attach: jest.fn() }
  const service = new OceanFreightBillService(prisma as never, access as never, numbering as never, audit, source as never)
  return { service, tx, numbering, audit, source, access }
}
describe('OceanFreightBillService commands', () => {
  it('creates the bill, issuance, source binding and audit in one transaction without totals', async () => {
    const { service, tx, numbering, audit, source } = setup()
    await service.create({ actorUserId, requestId: 'test' }, input, key)
    expect(numbering.generateScopedInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({ ruleCode: 'CTN_BILL_NO', idempotencyKey: `${actorUserId}:${key}` }))
    expect(source.attach).toHaveBeenCalledWith(tx, null, actorUserId)
    expect(tx.oceanFreightBill.create).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payableAmountCny: expect.anything() as unknown }) as unknown }))
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ eventType: 'OCEAN_FREIGHT_BILL_CREATED' }))
  })
  it('replays same normalized input without consuming numbers or reattaching files', async () => {
    const { service, tx, numbering, source } = setup()
    tx.oceanFreightBill.findUnique.mockResolvedValue({ id, ...dates, twdPerCny: '4.8', creationPayloadHash: fingerprint(normalizeBill(input)) })
    await service.create({ actorUserId, requestId: 'test' }, input, key)
    expect(numbering.generateScopedInTransaction).not.toHaveBeenCalled()
    expect(source.attach).not.toHaveBeenCalled()
  })
  it('rejects same key with changed payload', async () => {
    const { service, tx } = setup()
    tx.oceanFreightBill.findUnique.mockResolvedValue({ id, creationPayloadHash: 'other' })
    await expect(service.create({ actorUserId, requestId: 'test' }, input, key)).rejects.toMatchObject({ code: 'OCEAN_FREIGHT_BILL_IDEMPOTENCY_CONFLICT' })
  })
  it('checks active user on replay', async () => {
    const { service, tx, numbering } = setup()
    tx.user.findUnique.mockResolvedValue({ status: 'DISABLED' })
    await expect(service.create({ actorUserId, requestId: 'test' }, input, key)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(numbering.generateScopedInTransaction).not.toHaveBeenCalled()
  })
  it('rejects missing write permission before numbering', async () => {
    const { service, access, numbering } = setup()
    access.hasAll.mockReturnValue(false)
    await expect(service.create({ actorUserId, requestId: 'test' }, input, key)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(numbering.generateScopedInTransaction).not.toHaveBeenCalled()
  })
  it('replays an adjustment without appending another line or audit event', async () => {
    const { service, tx, audit } = setup()
    const command = { lineType: 'ADJUSTMENT' as const, goodsName: 'Delivery' }
    tx.oceanFreightBill.findUnique.mockResolvedValue({ id })
    tx.oceanFreightBillLine.findUnique.mockResolvedValue({ id, ...dates, ...normalizeBillLine(command), creationPayloadHash: fingerprint({ actorUserId, ...normalizeBillLine(command) }) })
    await service.createLine({ actorUserId, requestId: 'test' }, id, command, key)
    expect(tx.oceanFreightBillLine.create).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })
  it('rejects line retry with altered contents', async () => {
    const { service, tx } = setup()
    tx.oceanFreightBill.findUnique.mockResolvedValue({ id })
    tx.oceanFreightBillLine.findUnique.mockResolvedValue({ id, creationPayloadHash: 'different' })
    await expect(service.createLine({ actorUserId, requestId: 'test' }, id, { lineType: 'ADJUSTMENT', goodsName: 'Fee' }, key)).rejects.toMatchObject({ code: 'OCEAN_FREIGHT_BILL_IDEMPOTENCY_CONFLICT' })
    expect(tx.oceanFreightBillLine.create).not.toHaveBeenCalled()
  })
  it.each([null, id])('derives status only from real shipment linkage %s', async shipmentId => {
    const { service, tx } = setup()
    tx.oceanFreightBill.findUnique.mockResolvedValue({ id })
    tx.containerLoadingItem.findUnique.mockResolvedValue({ id, shipmentId })
    const result = await service.createLine({ actorUserId, requestId: 'test' }, id, { lineType: 'NORMAL', goodsName: 'Machine', loadingItemId: id }, key)
    expect(result.reconciliationStatus).toBe(shipmentId ? 'PENDING' : 'UNMATCHED')
  })
  it('blocks repeated normal billing across bills', async () => {
    const { service, tx } = setup()
    tx.oceanFreightBill.findUnique.mockResolvedValue({ id })
    tx.containerLoadingItem.findUnique.mockResolvedValue({ id, shipmentId: id })
    tx.oceanFreightBillLine.findFirst.mockResolvedValue({ id })
    await expect(service.createLine({ actorUserId, requestId: 'test' }, id, { lineType: 'NORMAL', goodsName: 'Machine', loadingItemId: id }, key)).rejects.toMatchObject({ code: 'OCEAN_FREIGHT_NORMAL_LINE_EXISTS' })
  })
  it('rejects adjustments linked to a different loading item', async () => {
    const { service, tx } = setup()
    tx.oceanFreightBill.findUnique.mockResolvedValue({ id })
    tx.containerLoadingItem.findUnique.mockResolvedValue({ id, shipmentId: id })
    tx.oceanFreightBillLine.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => where.id ? { id, loadingItemId: key, lineType: 'NORMAL' } : null)
    await expect(service.createLine({ actorUserId, requestId: 'test' }, id, { lineType: 'ADJUSTMENT', goodsName: 'Fee', loadingItemId: id, adjustsBillLineId: id }, key)).rejects.toMatchObject({ code: 'OCEAN_FREIGHT_LINE_REFERENCE_INVALID' })
  })
  it('leaves unmatched lines UNMATCHED with null computed values', async () => {
    const { service, tx } = setup()
    tx.oceanFreightBill.findUnique.mockResolvedValue({ id })
    await service.createLine({ actorUserId, requestId: 'test' }, id, { lineType: 'ADJUSTMENT', goodsName: 'Fee' }, key)
    expect(tx.oceanFreightBillLine.create).toHaveBeenCalledWith({ data: expect.objectContaining({ reconciliationStatus: 'UNMATCHED', codAmountTwd: null }) as unknown })
    expect(tx.oceanFreightBillLine.create).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ returnAmountCny: expect.anything() as unknown }) as unknown }))
  })
})
