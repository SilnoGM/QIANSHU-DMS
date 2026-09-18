import { createPurchaseOrderImageSnapshot, hashPurchaseOrderImageSnapshot } from './purchase-order-image-snapshot'

type SnapshotInput = Parameters<typeof createPurchaseOrderImageSnapshot>[0]

export function imageOrderFixture(): SnapshotInput {
  return {
    id: 'order-1', orderNo: 'PO/20260915-00001', orderDate: '2026-09-15', currencyCode: 'CNY',
    supplier: { source: 'CUSTOM_TEXT', value: null, label: '千树设备有限公司', tone: null, known: null, effectiveEnabled: null },
    createdBy: { id: 'user-1', displayName: '采购经办人' }, shippingMarkText: 'TEST/20260915-0001', remark: '请按货件分别包装。',
    lineSummary: { lineCount: 1, totalQuantity: 2, previews: [{ lineId: 'line-1', productName: '环保设备', mainImage: { id: 'image-1', contentUrl: '/api/products/product-1/media/image-1/content' } }] },
    amounts: { lineSubtotalAmount: '1234.5600', purchaseTotalAmount: '1234.5600', depositDueAmount: '234.5600', balanceDueAmount: '1000.0000', paidAmount: '0.0000', outstandingAmount: '1234.5600' },
    lines: [{ id: 'line-1', lineNumber: 1, productNo: 'PROD/00001', productName: '环保设备', productAttributes: [{ title: '颜色', value: '绿色' }], description: '请附带说明书', quantity: 2, actualPurchaseUnitPriceAmount: '617.2800', lineTotalAmount: '1234.5600' }],
    parts: [{ id: 'part-1', shipmentNo: 'PKG/20260915-00001', partNumber: 1, status: 'PENDING_REVIEW', shippingMarkText: 'TEST/20260915-0001', items: [{ purchaseOrderLineId: 'line-1', lineNumber: 1, quantity: 2 }] }],
  }
}

describe('purchase order image snapshot', () => {
  it('freezes exact authoritative contents, preserving decimal precision and issued marks', () => {
    const input = imageOrderFixture()
    const result = createPurchaseOrderImageSnapshot(input)
    expect(result.lines[0]).toMatchObject({ productName: '环保设备', mainImageId: 'image-1', unitPrice: '617.2800', amount: '1234.5600', attributes: ['颜色：绿色'] })
    expect(result.parts[0]).toMatchObject({ shipmentNo: 'PKG/20260915-00001', shippingMarkText: 'TEST/20260915-0001', items: [{ purchaseOrderLineId: 'line-1', quantity: 2 }] })
    expect(result.shippingMarkText).toBe('TEST/20260915-0001')
    expect(result.purchaseTotalAmount).toBe('1234.5600')
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    const changed = { ...input, amounts: { ...input.amounts, purchaseTotalAmount: '9007199254740993.1234' } }
    expect(createPurchaseOrderImageSnapshot(changed).purchaseTotalAmount).toBe('9007199254740993.1234')
  })

  it('hashes displayed content only and detects notes, images and shipping allocation changes', () => {
    const input = imageOrderFixture()
    const initial = hashPurchaseOrderImageSnapshot(createPurchaseOrderImageSnapshot(input))
    expect(hashPurchaseOrderImageSnapshot(createPurchaseOrderImageSnapshot(input))).toBe(initial)
    const reordered = Object.fromEntries(Object.entries(createPurchaseOrderImageSnapshot(input)).reverse()) as unknown as ReturnType<typeof createPurchaseOrderImageSnapshot>
    expect(hashPurchaseOrderImageSnapshot(reordered)).toBe(initial)
    expect(hashPurchaseOrderImageSnapshot(createPurchaseOrderImageSnapshot({ ...input, remark: '修改采购备注' }))).not.toBe(initial)
    expect(hashPurchaseOrderImageSnapshot(createPurchaseOrderImageSnapshot({ ...input, lineSummary: { ...input.lineSummary, previews: [] } }))).not.toBe(initial)
    expect(hashPurchaseOrderImageSnapshot(createPurchaseOrderImageSnapshot({ ...input, parts: input.parts.map(part => ({ ...part, items: [{ purchaseOrderLineId: 'line-1', lineNumber: 1, quantity: 1 }] })) }))).not.toBe(initial)
  })

  it('requires real order/part marks and shipment numbers instead of inventing placeholders', () => {
    const input = imageOrderFixture()
    expect(() => createPurchaseOrderImageSnapshot({ ...input, shippingMarkText: null })).toThrow('PURCHASE_ORDER_IMAGE_SNAPSHOT_INVALID')
    expect(() => createPurchaseOrderImageSnapshot({ ...input, parts: input.parts.map(part => ({ ...part, shippingMarkText: null })) })).toThrow('PURCHASE_ORDER_IMAGE_SNAPSHOT_INVALID')
    expect(() => createPurchaseOrderImageSnapshot({ ...input, parts: input.parts.map(part => ({ ...part, shipmentNo: null })) })).toThrow('PURCHASE_ORDER_IMAGE_SNAPSHOT_INVALID')
    expect(() => createPurchaseOrderImageSnapshot({ ...input, parts: input.parts.map(part => ({ ...part, items: [{ purchaseOrderLineId: 'unknown-line', lineNumber: 2, quantity: 1 }] })) })).toThrow('PURCHASE_ORDER_IMAGE_SNAPSHOT_INVALID')
  })
})
