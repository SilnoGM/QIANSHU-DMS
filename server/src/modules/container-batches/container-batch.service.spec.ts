import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type ContainerLoadingItem } from '../../generated/prisma/client'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AccessControlService } from '../access-control/access-control.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { OceanFreightSourceFileService } from '../media/ocean-freight-source-file.service'
import type { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { ContainerBatchService } from './container-batch.service'

function harness(previous?: Partial<ContainerLoadingItem>) {
  const actorUserId = randomUUID(), batchId = randomUUID(), key = randomUUID()
  const context = { actorUserId, requestId: randomUUID() }
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]), user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    containerBatch: { findUnique: jest.fn().mockResolvedValue({ version: 1 }), update: jest.fn().mockResolvedValue({}) },
    containerLoadingItem: {
      findUnique: jest.fn().mockResolvedValue(previous ?? null), aggregate: jest.fn().mockResolvedValue({ _max: { lineNumber: null } }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...data, id: randomUUID(), version: 1,
        ...Object.fromEntries(['grossWeightKg', 'lengthCm', 'widthCm', 'heightCm', 'volumeCai', 'reportedVolumeCai'].map(field => [field, typeof data[field] === 'string' ? new Prisma.Decimal(data[field]) : null])),
      })),
    },
  }
  const prisma = { $transaction: jest.fn((callback: (value: typeof tx) => unknown) => callback(tx)) }
  const access = { getPermissionCodesInTransaction: jest.fn().mockResolvedValue(['container-batches:update']), hasAll: jest.fn().mockReturnValue(true) }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new ContainerBatchService(prisma as unknown as PrismaService, {} as NumberingGeneratorService, {} as DictionaryLookupService, {} as OceanFreightSourceFileService, access as unknown as AccessControlService, audit)
  return { service, tx, prisma, audit, context, batchId, key }
}

describe('ContainerBatchService measurement calculation', () => {
  it('persists row volume and ceiling once while preserving source volume and total weight', async () => {
    const test = harness()
    const result = await test.service.createItem(test.context, test.batchId, { goodsName: '履带', packageCount: 10, expectedVersion: 1, lengthCm: '128', widthCm: '19', heightCm: '15', grossWeightKg: '180', reportedVolumeCai: '12.88' }, test.key)
    expect(result).toMatchObject({ packageCount: 10, grossWeightKg: '180', lengthCm: '128', volumeCai: '12.88', chargeableVolumeCai: 13, reportedVolumeCai: '12.88', volumeDifferenceCai: '0.00' })
    expect(test.tx.containerLoadingItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ volumeCai: '12.88', chargeableVolumeCai: 13, reportedVolumeCai: '12.88', grossWeightKg: '180' }) as unknown }))
    expect(test.audit.record).toHaveBeenCalledTimes(1)
  })

  it('retains missing measurements and rejects overflow before opening a transaction', async () => {
    const test = harness()
    const result = await test.service.createItem(test.context, test.batchId, { goodsName: '履带', packageCount: 1, expectedVersion: 1, lengthCm: '128', reportedVolumeCai: '0' }, test.key)
    expect(result).toMatchObject({ widthCm: null, grossWeightKg: null, volumeCai: null, chargeableVolumeCai: null, reportedVolumeCai: '0.00', volumeDifferenceCai: null })
    test.prisma.$transaction.mockClear()
    await expect(test.service.createItem(test.context, test.batchId, { goodsName: '履带', packageCount: 1, expectedVersion: 1, lengthCm: '999999999999999', widthCm: '999999999999999', heightCm: '999999999999999' }, test.key)).rejects.toMatchObject({ code: 'OCEAN_CALCULATION_OVERFLOW' })
    expect(test.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('compares the full supported source precision without decimal-library significant-digit rounding', async () => {
    const test = harness()
    const result = await test.service.createItem(test.context, test.batchId, { goodsName: '履带', packageCount: 10, expectedVersion: 1, lengthCm: '128', widthCm: '19', heightCm: '15', reportedVolumeCai: '9999999999999999.12' }, test.key)
    expect(result.volumeDifferenceCai).toBe('-9999999999999986.24')
  })

  it('replays a phase-one creation hash when new optional measurements are missing or null', async () => {
    const test = harness()
    const legacy = { shipmentId: null, oceanShippingMarkText: null, warehouseReceiptReference: null, goodsName: '履带', packageCount: 1, packageUnit: null, remark: null }
    const hash = createHash('sha256').update(JSON.stringify({ format: 'container.item.create.v1', actorUserId: test.context.actorUserId, ...legacy, expectedVersion: 1 })).digest('hex')
    const previous = { ...legacy, id: randomUUID(), containerBatchId: test.batchId, lineNumber: 1, version: 1, grossWeightKg: null, lengthCm: null, widthCm: null, heightCm: null, volumeCai: null, reportedVolumeCai: null, chargeableVolumeCai: null, creationPayloadHash: hash }
    test.tx.containerLoadingItem.findUnique.mockResolvedValue(previous)
    for (const extra of [{}, { lengthCm: null, reportedVolumeCai: null }]) {
      await expect(test.service.createItem(test.context, test.batchId, { goodsName: '履带', packageCount: 1, expectedVersion: 1, ...extra }, test.key)).resolves.toMatchObject({ id: previous.id })
    }
    expect(test.tx.containerLoadingItem.create).not.toHaveBeenCalled()
    expect(test.audit.record).not.toHaveBeenCalled()
  })
})
