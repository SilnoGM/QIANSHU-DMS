import { Prisma, type ContainerBatch } from '../../generated/prisma/client'
import { serializeContainerBatch } from './container-batch.serializer'

const actorId = '44444444-4444-4444-8444-444444444444'
const batch: ContainerBatch = {
  id: '11111111-1111-4111-8111-111111111111',
  containerBatchNo: 'CB/20261106-0001',
  numberingIssuanceId: '22222222-2222-4222-8222-222222222222',
  containerBatchName: '1106-01柜',
  loadingDate: new Date('2026-11-06T00:00:00.000Z'),
  sequenceInDay: 1,
  warehouseValue: 'B5',
  sourceFileId: null,
  remark: null,
  version: 1,
  creationRequestKey: '33333333-3333-4333-8333-333333333333',
  creationPayloadHash: 'a'.repeat(64),
  createdById: actorId,
  updatedById: actorId,
  createdAt: new Date('2026-11-06T01:00:00.000Z'),
  updatedAt: new Date('2026-11-06T01:00:00.000Z'),
}

function line(shipmentId: string | null) {
  return { shipmentId, packageCount: 1, grossWeightKg: null, volumeCai: null, chargeableVolumeCai: null }
}

describe('serializeContainerBatch 绑定统计', () => {
  it('只统计已绑定货件的装柜明细行', () => {
    const dto = serializeContainerBatch({ ...batch, items: [line('shipment-a'), line(null), line('shipment-b')] })
    expect(dto.boundItemCount).toBe(2)
    expect(dto.itemCount).toBe(3)
    expect(dto.shipmentCount).toBe(2)
  })

  it('全部绑定与全部未绑定分别落到行数两端', () => {
    expect(serializeContainerBatch({ ...batch, items: [line('shipment-a'), line('shipment-a')] }).boundItemCount).toBe(2)
    expect(serializeContainerBatch({ ...batch, items: [line(null), line(null)] }).boundItemCount).toBe(0)
  })

  it('没有装柜明细的空柜统计为 0/0', () => {
    const dto = serializeContainerBatch({ ...batch, items: [] })
    expect(dto.boundItemCount).toBe(0)
    expect(dto.itemCount).toBe(0)
  })

  it('计费材数按两位定点汇总，保留 0.5 材', () => {
    const dto = serializeContainerBatch({ ...batch, items: [
      { ...line('shipment-a'), chargeableVolumeCai: new Prisma.Decimal('0.50') },
      { ...line('shipment-b'), chargeableVolumeCai: new Prisma.Decimal('2.50') },
    ] })
    expect(dto.chargeableVolumeCaiTotal).toBe(3)
  })

  it('毛重合计按两位小数汇总', () => {
    const dto = serializeContainerBatch({ ...batch, items: [
      { ...line(null), grossWeightKg: new Prisma.Decimal('180.50') },
      { ...line(null), grossWeightKg: new Prisma.Decimal('0.50') },
    ] })
    expect(dto.grossWeightKgTotal).toBe('181.00')
  })
})
