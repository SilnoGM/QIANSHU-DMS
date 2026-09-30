import { randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AccessControlService } from '../access-control/access-control.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { OceanFreightSourceFileService } from '../media/ocean-freight-source-file.service'
import type { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { ContainerBatchService } from './container-batch.service'

function harness() {
  const context = { actorUserId: randomUUID(), requestId: randomUUID() }, id = randomUUID(), itemId = randomUUID()
  const batch = { id, containerBatchNo: 'CB1', containerBatchName: '0917柜', warehouseValue: 'B5', sourceFileId: null, remark: null, version: 4, loadingDate: new Date('2026-09-17T00:00:00Z'), createdAt: new Date('2026-09-19T00:00:00Z'), updatedAt: new Date('2026-09-19T00:00:00Z'), sequenceInDay: 1, createdById: context.actorUserId }
  const item = { id: itemId, containerBatchId: id, lineNumber: 1, version: 2, shipmentId: null, goodsName: '履带', packageCount: 10, volumeCai: null, reportedVolumeCai: null }
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]), user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    containerBatch: { findUnique: jest.fn().mockResolvedValue(batch), update: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...batch, ...data, version: 5 })) },
    containerLoadingItem: { findFirst: jest.fn().mockResolvedValue(item), update: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...item, ...data, version: 3, ...Object.fromEntries(['grossWeightKg', 'lengthCm', 'widthCm', 'heightCm', 'volumeCai', 'reportedVolumeCai', 'codAmountTwd'].map(field => [field, typeof data[field] === 'string' ? new Prisma.Decimal(data[field]) : null])) })) },
    purchaseOrderPart: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
  }
  const prisma = { $transaction: jest.fn((callback: (value: typeof tx) => unknown) => callback(tx)) }
  const access = { getPermissionCodesInTransaction: jest.fn().mockResolvedValue(['container-batches:update']), hasAll: jest.fn().mockReturnValue(true) }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }, dictionary = { requireEffectiveValue: jest.fn() }, sourceFiles = { attach: jest.fn() }
  const service = new ContainerBatchService(prisma as unknown as PrismaService, {} as NumberingGeneratorService, dictionary as unknown as DictionaryLookupService, sourceFiles as unknown as OceanFreightSourceFileService, access as unknown as AccessControlService, audit)
  return { service, context, id, itemId, tx, batch, item, access, audit, dictionary, sourceFiles }
}
const fields = { goodsName: '履带', packageCount: 10, expectedVersion: 4, itemExpectedVersion: 2, lengthCm: '128', widthCm: '19', heightCm: '15' }

describe('Container maintenance commands', () => {
  it('updates dates using the creation year and preserves system numbering', async () => {
    const h = harness()
    const result = await h.service.update(h.context, h.id, { expectedVersion: 4, containerBatchName: '0920-02柜', warehouseValue: 'B5', remark: '修改' })
    expect(result).toMatchObject({ containerBatchNo: 'CB1', containerBatchName: '0920-02柜', loadingDate: '2026-09-20', sequenceInDay: 2, version: 5 })
    expect(h.audit.record).toHaveBeenCalledTimes(1)
    expect(h.dictionary.requireEffectiveValue).not.toHaveBeenCalled()
  })
  it('rejects stale versions, forged computed fields and wrong item identity', async () => {
    const h = harness()
    await expect(h.service.updateItem(h.context, h.id, h.itemId, { ...fields, itemExpectedVersion: 1 })).rejects.toMatchObject({ code: 'CONTAINER_STATE_CHANGED' })
    await expect(h.service.updateItem(h.context, h.id, h.itemId, { ...fields, volumeCai: '5' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    h.tx.containerLoadingItem.findFirst.mockResolvedValueOnce(null)
    await expect(h.service.updateItem(h.context, h.id, h.itemId, fields)).rejects.toMatchObject({ code: 'CONTAINER_LOADING_ITEM_NOT_FOUND' })
    expect(h.tx.containerLoadingItem.update).not.toHaveBeenCalled()
  })
  it('recalculates measurements and replaces nullable input without progressing shipments', async () => {
    const h = harness()
    const result = await h.service.updateItem(h.context, h.id, h.itemId, { ...fields, codAmountTwd: '100.10', recipientName: '客户' })
    expect(result).toMatchObject({ volumeCai: '12.88000000', chargeableVolumeCai: 13, grossWeightKg: null, shipmentId: null, codAmountTwd: '100.10', recipientName: '客户', recipientPhone: null, version: 3 })
    expect(h.tx.containerBatch.update).toHaveBeenCalledWith({ where: { id: h.id }, data: { version: { increment: 1 }, updatedById: h.context.actorUserId } })
    expect(h.tx.purchaseOrderPart.findUnique).not.toHaveBeenCalled()
    expect(h.audit.record).toHaveBeenCalledTimes(1)
  })
  it('checks active shipment and rejects assignment to another container', async () => {
    const h = harness(), shipmentId = randomUUID()
    h.tx.purchaseOrderPart.findUnique.mockResolvedValueOnce({ status: 'CANCELLED' })
    await expect(h.service.updateItem(h.context, h.id, h.itemId, { ...fields, shipmentId })).rejects.toMatchObject({ code: 'CONTAINER_SHIPMENT_UNAVAILABLE' })
    h.tx.containerLoadingItem.findFirst.mockResolvedValueOnce(h.item).mockResolvedValueOnce({ id: randomUUID() })
    await expect(h.service.updateItem(h.context, h.id, h.itemId, { ...fields, shipmentId })).rejects.toMatchObject({ code: 'CONTAINER_SHIPMENT_ALREADY_ASSIGNED' })
    expect(h.tx.containerLoadingItem.update).not.toHaveBeenCalled()
  })
  it('prevents source detach, but permits a remark change', async () => {
    const h = harness(), sourceFileId = randomUUID()
    h.tx.containerBatch.findUnique.mockResolvedValue({ ...h.batch, sourceFileId })
    await expect(h.service.update(h.context, h.id, { expectedVersion: 4, containerBatchName: '0917柜', warehouseValue: 'B5' })).rejects.toMatchObject({ code: 'CONTAINER_SOURCE_FILE_LOCKED' })
    await expect(h.service.update(h.context, h.id, { expectedVersion: 4, containerBatchName: '0917柜', warehouseValue: 'B5', sourceFileId, remark: '备注' })).resolves.toMatchObject({ remark: '备注' })
  })
  it('checks current user permissions inside the write transaction', async () => {
    const h = harness()
    h.access.hasAll.mockReturnValue(false)
    await expect(h.service.updateItem(h.context, h.id, h.itemId, fields)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(h.tx.containerLoadingItem.update).not.toHaveBeenCalled()
  })
})
