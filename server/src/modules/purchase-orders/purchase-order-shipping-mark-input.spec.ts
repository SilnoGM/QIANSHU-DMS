import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { CreatePurchaseOrderRequestDto } from './dto/purchase-order-create.dto'
import { normalizePurchaseOrderCreateCommand } from './purchase-order-command.normalizer'
import { calculatePurchaseOrderCreateFingerprint } from './purchase-order-create-fingerprint'

const TOKEN = 'a'.repeat(64)
function input() {
  return {
    parts: [{ key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', items: [{ lineNumber: 1, quantity: 1 }] }],
    purchaseType: 'STOCK', productMode: 'CUSTOM',
    paymentAccounts: [{ paymentMethod: 'BANK_TRANSFER', recipientName: 'Supplier', bankName: 'Bank', bankAccount: '123' }], customSupplierName: '临时供应商',
    orderDate: '2026-09-07', expectedShippingMarkResolution: TOKEN,
    lines: [{ lineType: 'CUSTOM', name: '包装', referencePurchaseUnitPriceAmount: '10', actualPurchaseUnitPriceAmount: '10', quantity: 1 }],
    purchaseTotalAmount: '10', depositDueAmount: '0', balanceDueAmount: '10',
  }
}

describe('purchase shipping mark create input', () => {
  it('accepts the resolution digest without a caller-supplied shipping mark', async () => {
    const body = input()
    expect(await validate(plainToInstance(CreatePurchaseOrderRequestDto, body), {
      whitelist: true, forbidNonWhitelisted: true,
    })).toEqual([])
    const normalized = normalizePurchaseOrderCreateCommand(body, '2026-09-07')
    expect(normalized).toHaveProperty('expectedShippingMarkResolution', TOKEN)
    expect(normalized).not.toHaveProperty('shippingMarkText')
  })

  it.each(['MANUAL', '', null])('rejects legacy shippingMarkText %s at both boundaries', async shippingMarkText => {
    const body = { ...input(), shippingMarkText }
    expect(await validate(plainToInstance(CreatePurchaseOrderRequestDto, body), {
      whitelist: true, forbidNonWhitelisted: true,
    })).not.toEqual([])
    expect(() => normalizePurchaseOrderCreateCommand(body, '2026-09-07')).toThrow()
  })

  it.each([undefined, null, '', 'A'.repeat(64), 'a'.repeat(63)])('rejects invalid digest %s', async expectedShippingMarkResolution => {
    const body = { ...input(), expectedShippingMarkResolution }
    expect(await validate(plainToInstance(CreatePurchaseOrderRequestDto, body), {
      whitelist: true, forbidNonWhitelisted: true,
    })).not.toEqual([])
    expect(() => normalizePurchaseOrderCreateCommand(body, '2026-09-07')).toThrow()
  })

  it('includes the selected configuration digest in the frozen request fingerprint', () => {
    const first = normalizePurchaseOrderCreateCommand(input(), '2026-09-07')
    const second = normalizePurchaseOrderCreateCommand({ ...input(), expectedShippingMarkResolution: 'b'.repeat(64) }, '2026-09-07')
    const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    expect(calculatePurchaseOrderCreateFingerprint(actor, first)).not.toBe(calculatePurchaseOrderCreateFingerprint(actor, second))
  })
})
