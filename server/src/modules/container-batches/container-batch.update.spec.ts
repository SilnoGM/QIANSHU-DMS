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
    containerLoadingItem: {
      findFirst: jest.fn().mockResolvedValue(item),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...item, ...data, version: 3, ...Object.fromEntries(['grossWeightKg', 'lengthCm', 'widthCm', 'heightCm', 'volumeCai', 'reportedVolumeCai', 'codAmountTwd'].map(field => [field, typeof data[field] === 'string' ? new Prisma.Decimal(data[field]) : null])) })),
    },
    purchaseOrderPart: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', deliveredAt: null, loadedAt: null, warehouseReceivedAt: new Date('2026-09-18T00:00:00Z'), destinationWarehouseValue: 'B5', containerLoadingItems: [] }),
      count: jest.fn().mockResolvedValue(0),
    },
    salesOrderLine: { findMany: jest.fn().mockResolvedValue([{ id: 'line-1', quantity: 1 }]) },
    salesOrderDocument: { count: jest.fn().mockResolvedValue(0) },
    salesOrderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    // 销售履约推进按现状判断；默认非候选状态，仅关联货件本身不改变订单。
    salesOrder: {
      findUnique: jest.fn().mockResolvedValue({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'LAND_TRANSIT' }),
      update: jest.fn().mockResolvedValue({}),
    },
    // 装柜聚合评估按采购单现状；默认没有有效采购，不足以推进或回退。
    purchaseOrder: { findMany: jest.fn().mockResolvedValue([]) },
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
    expect(result).toMatchObject({ volumeCai: '12.88', chargeableVolumeCai: 13, grossWeightKg: null, shipmentId: null, codAmountTwd: '100.10', recipientName: '客户', recipientPhone: null, version: 3 })
    expect(h.tx.containerBatch.update).toHaveBeenCalledWith({ where: { id: h.id }, data: { version: { increment: 1 }, updatedById: h.context.actorUserId } })
    expect(h.tx.purchaseOrderPart.findUnique).not.toHaveBeenCalled()
    expect(h.audit.record).toHaveBeenCalledTimes(1)
  })
  it('checks active shipment and rejects assignment to another container', async () => {
    const h = harness(), shipmentId = randomUUID()
    h.tx.purchaseOrderPart.findUnique.mockResolvedValueOnce({ status: 'CANCELLED', deliveredAt: null, loadedAt: null, warehouseReceivedAt: null, destinationWarehouseValue: 'B5', containerLoadingItems: [] })
    await expect(h.service.updateItem(h.context, h.id, h.itemId, { ...fields, shipmentId })).rejects.toMatchObject({ code: 'CONTAINER_SHIPMENT_UNAVAILABLE' })
    h.tx.containerLoadingItem.findFirst.mockResolvedValueOnce(h.item)
    h.tx.purchaseOrderPart.findUnique.mockResolvedValueOnce({ status: 'ACTIVE', deliveredAt: null, loadedAt: null, warehouseReceivedAt: new Date('2026-09-18T00:00:00Z'), destinationWarehouseValue: 'B5', containerLoadingItems: [{ containerBatchId: randomUUID() }] })
    await expect(h.service.updateItem(h.context, h.id, h.itemId, { ...fields, shipmentId })).rejects.toMatchObject({ code: 'CONTAINER_SHIPMENT_ALREADY_ASSIGNED' })
    expect(h.tx.containerLoadingItem.update).not.toHaveBeenCalled()
  })
  it('locks the sales order chain before the shipment and evaluates the advance afterwards', async () => {
    const h = harness(), shipmentId = randomUUID()
    h.tx.purchaseOrderPart.findMany.mockResolvedValueOnce([{ purchaseOrder: { salesOrderId: 'so-1' } }])
    h.tx.containerLoadingItem.findFirst.mockResolvedValueOnce(h.item)
    await h.service.updateItem(h.context, h.id, h.itemId, { ...fields, shipmentId })
    // 锁序必须与发货、入仓一致：销售明细 → 采购单 → 销售主行 → 货件，装柜不能反向申请。
    const statements = h.tx.$queryRaw.mock.calls.map(call => (call as [{ sql: string }])[0].sql.replace(/\s+/gu, ' '))
    const position = (needle: string) => statements.findIndex(statement => statement.includes(needle))
    const shipmentLock = position('purchase_order_parts WHERE id')
    expect(shipmentLock).toBeGreaterThan(-1)
    for (const table of ['sales_order_lines', 'purchase_orders', 'sales_orders']) {
      expect(position(table)).toBeGreaterThan(-1)
      expect(position(table)).toBeLessThan(shipmentLock)
    }
    // 关联后按现状评估销售履约；非候选状态保持不动。
    expect(h.tx.salesOrder.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'so-1' } }))
  })
  it('clears the loading fact when the last item is unbound', async () => {
    const h = harness(), shipmentId = randomUUID(), previousLoadedAt = new Date('2026-09-19T00:00:00Z')
    h.tx.purchaseOrderPart.findMany.mockResolvedValueOnce([{ purchaseOrder: { salesOrderId: 'so-1' } }])
    h.tx.containerLoadingItem.findFirst.mockResolvedValueOnce({ ...h.item, shipmentId })
    h.tx.$queryRaw.mockImplementation((statement: { sql: string }) => Promise.resolve(statement.sql.includes('SET loaded_at = NULL')
      ? [{ id: shipmentId, previousLoadedAt, previousLoadedById: h.context.actorUserId }]
      : []))
    await h.service.updateItem(h.context, h.id, h.itemId, fields)
    const statements = h.tx.$queryRaw.mock.calls.map(call => (call as [{ sql: string }])[0].sql.replace(/\s+/gu, ' '))
    expect(statements.some(statement => statement.includes('SET loaded_at = NULL'))).toBe(true)
    // 只有确认没有任何装柜明细时才撤销事实；查询在明细更新之后。
    expect(h.tx.containerLoadingItem.count).toHaveBeenCalledWith({ where: { shipmentId } })
    const auditCalls = h.audit.record.mock.calls as Array<[unknown, { eventType: string, targetId: string, requestId: string, metadata: Record<string, unknown> }]>
    const unload = auditCalls.find(call => call[1].eventType === 'PURCHASE_SHIPMENT_CONTAINER_UNLOADED')
    expect(unload?.[1]).toMatchObject({
      targetId: shipmentId, requestId: h.context.requestId,
      metadata: { containerBatchId: h.id, loadingItemId: h.itemId, previousLoadedAt: previousLoadedAt.toISOString(), previousLoadedById: h.context.actorUserId, source: 'ITEM_UPDATE' },
    })
    // 订单不在候选状态时不产生回退写入。
    expect(h.tx.salesOrder.update).not.toHaveBeenCalled()
  })
  it('keeps the loading fact while another item of the same shipment remains', async () => {
    const h = harness(), shipmentId = randomUUID()
    h.tx.purchaseOrderPart.findMany.mockResolvedValueOnce([{ purchaseOrder: { salesOrderId: 'so-1' } }])
    h.tx.containerLoadingItem.findFirst.mockResolvedValueOnce({ ...h.item, shipmentId })
    h.tx.containerLoadingItem.count.mockResolvedValueOnce(1)
    await h.service.updateItem(h.context, h.id, h.itemId, fields)
    const statements = h.tx.$queryRaw.mock.calls.map(call => (call as [{ sql: string }])[0].sql.replace(/\s+/gu, ' '))
    expect(statements.some(statement => statement.includes('SET loaded_at = NULL'))).toBe(false)
    expect(h.audit.record).toHaveBeenCalledTimes(1)
    expect(h.tx.salesOrder.update).not.toHaveBeenCalled()
  })
  it('rejects unbinding a delivered shipment before any write', async () => {
    const h = harness(), shipmentId = randomUUID()
    h.tx.purchaseOrderPart.findMany.mockResolvedValueOnce([{ purchaseOrder: { salesOrderId: 'so-1' } }])
    h.tx.containerLoadingItem.findFirst.mockResolvedValueOnce({ ...h.item, shipmentId })
    h.tx.purchaseOrderPart.findUnique.mockResolvedValueOnce({ status: 'ACTIVE', deliveredAt: new Date('2026-09-20T00:00:00Z'), loadedAt: new Date('2026-09-19T00:00:00Z'), warehouseReceivedAt: new Date('2026-09-18T00:00:00Z'), destinationWarehouseValue: 'B5', containerLoadingItems: [] })
    await expect(h.service.updateItem(h.context, h.id, h.itemId, fields)).rejects.toMatchObject({ code: 'CONTAINER_SHIPMENT_UNLOAD_FORBIDDEN', status: 422 })
    expect(h.tx.containerLoadingItem.update).not.toHaveBeenCalled()
    expect(h.tx.containerLoadingItem.count).not.toHaveBeenCalled()
    expect(h.audit.record).not.toHaveBeenCalled()
  })
  it('clears the previous shipment and retreats its sales order when an item is rebound', async () => {
    const h = harness(), previousShipmentId = randomUUID(), nextShipmentId = randomUUID()
    h.tx.purchaseOrderPart.findMany.mockResolvedValue([{ purchaseOrder: { salesOrderId: 'so-1' } }])
    h.tx.containerLoadingItem.findFirst.mockResolvedValueOnce({ ...h.item, shipmentId: previousShipmentId })
    h.tx.salesOrder.findUnique.mockResolvedValue({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'SEA_TRANSIT' })
    h.tx.$queryRaw.mockImplementation((statement: { sql: string }) => Promise.resolve(statement.sql.includes('SET loaded_at = NULL')
      ? [{ id: previousShipmentId, previousLoadedAt: new Date('2026-09-19T00:00:00Z'), previousLoadedById: h.context.actorUserId }]
      : statement.sql.includes('SET loaded_at = clock_timestamp()') ? [{ id: nextShipmentId }] : []))
    await h.service.updateItem(h.context, h.id, h.itemId, { ...fields, shipmentId: nextShipmentId })
    const statements = h.tx.$queryRaw.mock.calls.map(call => (call as [{ sql: string }])[0].sql.replace(/\s+/gu, ' '))
    expect(statements.some(statement => statement.includes('SET loaded_at = clock_timestamp()'))).toBe(true)
    expect(statements.some(statement => statement.includes('SET loaded_at = NULL'))).toBe(true)
    expect(h.audit.record.mock.calls.map(call => (call as [unknown, { eventType: string }])[1].eventType)).toEqual(expect.arrayContaining([
      'PURCHASE_SHIPMENT_CONTAINER_LOADED', 'PURCHASE_SHIPMENT_CONTAINER_UNLOADED',
    ]))
    // 不再满足全部装柜且没有签收事实：订单回退到已到仓并留痕。
    expect(h.tx.salesOrder.update).toHaveBeenCalledWith({ where: { id: 'so-1' }, data: { fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: { increment: 1 } } })
    expect(h.tx.salesOrderStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ salesOrderId: 'so-1', fromStatus: 'SEA_TRANSIT', toStatus: 'WAREHOUSE_ARRIVED', changedByUserId: h.context.actorUserId }) as unknown })
  })
  it('keeps the sales order in sea transit when the unloaded order already has delivery facts', async () => {
    const h = harness(), shipmentId = randomUUID()
    h.tx.purchaseOrderPart.findMany.mockResolvedValueOnce([{ purchaseOrder: { salesOrderId: 'so-1' } }])
    h.tx.containerLoadingItem.findFirst.mockResolvedValueOnce({ ...h.item, shipmentId })
    h.tx.salesOrder.findUnique.mockResolvedValue({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'SEA_TRANSIT' })
    h.tx.purchaseOrderPart.count.mockResolvedValueOnce(1)
    await h.service.updateItem(h.context, h.id, h.itemId, fields)
    expect(h.tx.salesOrder.update).not.toHaveBeenCalled()
    expect(h.tx.salesOrderStatusHistory.create).not.toHaveBeenCalled()
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
