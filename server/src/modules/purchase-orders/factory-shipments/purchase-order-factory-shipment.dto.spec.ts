import { ValidationPipe } from '@nestjs/common'

import { createValidationException } from '../../../infrastructure/http/validation-exception.factory'
import { PurchaseOrderFactoryShipmentRequestDto, SalesOrderFactoryShipmentRequestDto } from './purchase-order-factory-shipment.dto'
import { normalizePurchaseOrderFactoryShipmentRequest, normalizeSalesOrderFactoryShipmentRequest } from './purchase-order-factory-shipment.normalizer'

const PART_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FOREIGN_PART_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const dtoPipe = new ValidationPipe({
  transform: true, whitelist: true, forbidNonWhitelisted: true,
  exceptionFactory: createValidationException,
})

async function transformPurchase(trackingNumbers?: unknown) {
  return dtoPipe.transform({ partIds: [PART_ID], expectedVersion: 1, trackingNumbers }, {
    type: 'body', metatype: PurchaseOrderFactoryShipmentRequestDto,
  }) as Promise<PurchaseOrderFactoryShipmentRequestDto>
}

async function transformSales(trackingNumbers?: unknown) {
  return dtoPipe.transform({
    mode: 'SELECTED', targets: [{ purchaseOrderId: PART_ID, partIds: [PART_ID], expectedVersion: 1, trackingNumbers }],
  }, { type: 'body', metatype: SalesOrderFactoryShipmentRequestDto }) as Promise<SalesOrderFactoryShipmentRequestDto>
}

describe('factory shipment tracking number HTTP DTOs', () => {
  it.each([undefined, [], [{ partId: PART_ID, trackingNo: null }], [{ partId: PART_ID, trackingNo: 'SF123' }]])(
    'accepts optional tracking numbers through the whitelist and nested transforms %#', async (trackingNumbers) => {
      const purchase = await transformPurchase(trackingNumbers)
      const sales = await transformSales(trackingNumbers)
      expect(purchase.trackingNumbers).toEqual(trackingNumbers)
      expect(sales.targets[0].trackingNumbers).toEqual(trackingNumbers)
      expect(() => normalizePurchaseOrderFactoryShipmentRequest(purchase)).not.toThrow()
      expect(() => normalizeSalesOrderFactoryShipmentRequest(sales)).not.toThrow()
    },
  )

  it.each([
    [{ partId: PART_ID, trackingNo: 'SF\n123' }],
    [{ partId: PART_ID, trackingNo: '\tSF123' }],
    [{ partId: PART_ID, trackingNo: 'SF\u0085123' }],
    [{ partId: PART_ID, trackingNo: 'a'.repeat(101) }],
    [{ partId: PART_ID, trackingNo: 123 }],
    [{ partId: PART_ID }],
    [{ partId: PART_ID, trackingNo: 'SF123', extra: 'not allowed' }],
    Array(1001).fill({ partId: PART_ID, trackingNo: null }),
  ])('rejects malformed tracking values at the HTTP boundary %#', async (trackingNumbers) => {
    await expect(transformPurchase(trackingNumbers)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(transformSales(trackingNumbers)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('rejects a structurally valid but unselected part after HTTP transformation', async () => {
    const trackingNumbers = [{ partId: FOREIGN_PART_ID, trackingNo: 'SF123' }]
    const purchase = await transformPurchase(trackingNumbers)
    const sales = await transformSales(trackingNumbers)
    expect(() => normalizePurchaseOrderFactoryShipmentRequest(purchase))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => normalizeSalesOrderFactoryShipmentRequest(sales))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })
})
