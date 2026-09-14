import { createHash } from 'node:crypto'

import type { Prisma } from '../../../generated/prisma/client'
import type { NumberingGeneratorService } from '../../numbering/numbering-generator.service'
import { NumberingGenerationError } from '../../numbering/numbering.errors'
import { PurchaseShipmentNumberingService } from './purchase-shipment-numbering.service'

const part = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', purchaseOrderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }

function fixture() {
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ purpose: 'BUSINESS' }]) }
  const numbering = { generateScopedBatchInTransaction: jest.fn().mockResolvedValue([{ number: 'SHIP/0001', issuanceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', issuedAt: '2026-09-14T01:00:00.000Z' }]) }
  return { tx, numbering, service: new PurchaseShipmentNumberingService(numbering as unknown as NumberingGeneratorService) }
}

describe('PurchaseShipmentNumberingService', () => {
  it('binds a stable scoped issuance to the immutable shipment and order identity in the caller transaction', async () => {
    const { tx, numbering, service } = fixture()
    const result = await service.issue(tx as unknown as Prisma.TransactionClient, [part])
    expect(numbering.generateScopedBatchInTransaction).toHaveBeenCalledWith(tx, [{
      ruleCode: 'SHIPMENT_NO', consumerCode: 'SHIPMENT_NO.CREATE', idempotencyKey: part.id,
      requestFingerprint: createHash('sha256').update(`purchase-shipment.number.v1:${part.id}:${part.purchaseOrderId}:${part.key}`).digest('hex'),
    }])
    expect(result[0]).toMatchObject({ shipmentNo: 'SHIP/0001', numberingIssuanceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })
  })

  it.each([{ rules: [] }, { rules: [{ purpose: 'SHIPPING_MARK' }] }])('rejects a missing or shipping-mark-purpose rule before generation', async ({ rules }) => {
    const { tx, numbering, service } = fixture()
    tx.$queryRaw.mockResolvedValue(rules)
    await expect(service.issue(tx as unknown as Prisma.TransactionClient, [part])).rejects.toMatchObject({ code: 'PURCHASE_SHIPMENT_NUMBERING_UNAVAILABLE', status: 409 })
    expect(numbering.generateScopedBatchInTransaction).not.toHaveBeenCalled()
  })

  it.each([
    ['NUMBERING_CAPACITY_EXHAUSTED', 'PURCHASE_SHIPMENT_NUMBERING_UNAVAILABLE'],
    ['NUMBERING_RULE_UNAVAILABLE', 'PURCHASE_SHIPMENT_NUMBERING_UNAVAILABLE'],
    ['NUMBERING_OUTPUT_CONFLICT', 'PURCHASE_SHIPMENT_NUMBER_CONFLICT'],
    ['NUMBERING_RULE_STATE_CHANGED', 'PURCHASE_ORDER_STATE_CHANGED'],
    ['NUMBERING_IDEMPOTENCY_CONFLICT', 'PURCHASE_SHIPMENT_NUMBER_CONFLICT'],
  ] as const)('maps %s without generating a replacement key or retrying an aborted transaction', async (input, code) => {
    const { tx, numbering, service } = fixture()
    numbering.generateScopedBatchInTransaction.mockRejectedValue(new NumberingGenerationError(input))
    await expect(service.issue(tx as unknown as Prisma.TransactionClient, [part])).rejects.toMatchObject({ code, status: 409 })
    expect(numbering.generateScopedBatchInTransaction).toHaveBeenCalledTimes(1)
  })
})
