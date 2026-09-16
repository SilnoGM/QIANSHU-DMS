import { Prisma } from '../../generated/prisma/client'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AccessControlService } from '../access-control/access-control.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { MediaAssetService } from '../media/media-asset.service'
import type { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import type { PackagingCostQueryService } from './packaging-cost-query.service'
import { PackagingCostService } from './packaging-cost.service'

const id = '00000000-0000-4000-8000-000000000001'
const actor = '00000000-0000-4000-8000-000000000002'
const context = { actorUserId: actor, requestId: 'test-payment' }
function fixture(row: Record<string, unknown> = {}) {
  const update = jest.fn().mockResolvedValue({})
  const record = jest.fn().mockResolvedValue({})
  const granted = jest.fn().mockResolvedValue(['packaging-costs:read', 'packaging-costs:pay'])
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0), $queryRaw: jest.fn().mockResolvedValue([{ now: new Date('2026-09-16T00:00:00Z') }]),
    user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    packagingCostRequest: { findUnique: jest.fn().mockResolvedValue({ id, status: 'PENDING_PAYMENT', version: 1, paidByUserId: null, amount: new Prisma.Decimal('120.50'), ...row }), update },
  }
  const prisma = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as PrismaService
  const query = { getById: jest.fn().mockResolvedValue({ id }) } as unknown as PackagingCostQueryService
  const access = { getPermissionCodesInTransaction: granted, hasAll: (codes: string[], required: string[]) => required.every(value => codes.includes(value)) } as unknown as AccessControlService
  const service = new PackagingCostService(prisma, query, {} as DictionaryLookupService, {} as MediaAssetService, {} as MediaContentDeliveryService, access, { record })
  return { service, tx, update, record, granted }
}
describe('PackagingCostService payment', () => {
  it('freezes the submitted amount and records payer/time with one version transition', async () => {
    const f = fixture()
    await f.service.pay(context, id, { expectedVersion: 1 })
    expect(f.update).toHaveBeenCalledWith({ where: { id }, data: { status: 'PAID', paidByUserId: actor, paidAt: expect.any(Date) as unknown, version: { increment: 1 } } })
    expect(f.record).toHaveBeenCalledWith(f.tx, expect.objectContaining({ eventType: 'PACKAGING_COST_PAID', metadata: { amount: '120.5000', currencyCode: 'CNY' } }))
  })
  it('replays the same confirmed request without another write or audit', async () => {
    const f = fixture({ status: 'PAID', version: 2, paidByUserId: actor })
    await expect(f.service.pay(context, id, { expectedVersion: 1 })).resolves.toEqual({ id })
    expect(f.update).not.toHaveBeenCalled(); expect(f.record).not.toHaveBeenCalled()
  })
  it.each([
    { status: 'PAID', version: 2, paidByUserId: id }, { status: 'PENDING_PAYMENT', version: 2 },
  ])('rejects a competing actor or stale version %j', async row => {
    const f = fixture(row)
    await expect(f.service.pay(context, id, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'PACKAGING_COST_STATE_CHANGED' })
    expect(f.update).not.toHaveBeenCalled()
  })
  it.each([['packaging-costs:read'], ['packaging-costs:pay'], []])('rechecks both permissions inside the payment transaction %j', async (...codes: string[]) => {
    const f = fixture(); f.granted.mockResolvedValue(codes)
    await expect(f.service.pay(context, id, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(f.update).not.toHaveBeenCalled()
  })
  it('rejects a disabled actor even when permission lookup still grants both capabilities', async () => {
    const f = fixture(); f.tx.user.findUnique.mockResolvedValue({ status: 'DISABLED' })
    await expect(f.service.pay(context, id, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(f.update).not.toHaveBeenCalled()
  })
})
