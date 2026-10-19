import { Prisma } from '../../generated/prisma/client'
import {
  calculateSettleAmountCny,
  calculateTaxAmount,
  describeSettleFormula,
  INVOICE_SETTLE_WAIT_HOURS,
  isSettleable,
  resolveInvoiceDocumentVariant,
  resolveSettleableAt,
  sumLineAmounts,
} from './invoice-request.logic'

describe('invoice request amounts and settle window', () => {
  it('rounds the business tax to whole TWD with the fixed 5% rate', () => {
    // 票面示例：270000 × 5% = 13500。
    expect(calculateTaxAmount(270_000n)).toBe(13_500n)
    // 非整数时四舍五入到元，销售额 1 元时为 0（总计因此等于销售额）。
    expect(calculateTaxAmount(1n)).toBe(0n)
    expect(calculateTaxAmount(9n)).toBe(0n)
    expect(calculateTaxAmount(10n)).toBe(1n)
    expect(calculateTaxAmount(30n)).toBe(2n)
    expect(calculateTaxAmount(270_001n)).toBe(13_500n)
  })

  it('sums line amounts as quantity × unit price', () => {
    expect(sumLineAmounts([{ quantity: 1, unitPrice: 90_000n }, { quantity: 1, unitPrice: 180_000n }])).toBe(270_000n)
    expect(sumLineAmounts([{ quantity: 3, unitPrice: 12_345n }])).toBe(37_035n)
    expect(sumLineAmounts([])).toBe(0n)
  })

  it('opens the settle window exactly 120 hours after the photo upload', () => {
    const uploadedAt = new Date('2026-05-01T02:00:00.000Z')
    expect(INVOICE_SETTLE_WAIT_HOURS).toBe(120)
    expect(resolveSettleableAt(uploadedAt).toISOString()).toBe('2026-05-06T02:00:00.000Z')
    // 差一毫秒不行，恰好整点可以。
    expect(isSettleable(uploadedAt, new Date('2026-05-06T01:59:59.999Z'))).toBe(false)
    expect(isSettleable(uploadedAt, new Date('2026-05-06T02:00:00.000Z'))).toBe(true)
    // 没有照片就没有可结算时刻。
    expect(isSettleable(null, new Date('2026-06-01T00:00:00.000Z'))).toBe(false)
  })

  it('computes the settlement cost with the documented formula and ceiling', () => {
    // 需求示例：283500 ÷ 5.2 × 0.06 + 30 = 3301.153… → 向上取整 3302。
    expect(calculateSettleAmountCny(283_500n, new Prisma.Decimal('5.2'))).toBe('3302.00')
    // 除以汇率之后不足 1 元时，邮寄费仍然是成本的一部分，结果恒 ≥ 31。
    expect(calculateSettleAmountCny(1n, new Prisma.Decimal('5.2'))).toBe('31.00')
    // 顺序敏感：先加 30 再向上取整，向上取整发生在最后一步。
    expect(calculateSettleAmountCny(520_000n, new Prisma.Decimal('5.2'))).toBe('6030.00')
    expect(describeSettleFormula(283_500n, new Prisma.Decimal('5.2'))).toBe('总计 283500 ÷ 汇率 5.2 × 0.06 + 30 = 3302.00')
  })

  it('accepts only the thumb variant and rejects unknown values instead of degrading to the original', () => {
    // 缺省与空串视为「不请求变体」，直接返回原件。
    expect(resolveInvoiceDocumentVariant(undefined)).toBeUndefined()
    expect(resolveInvoiceDocumentVariant('')).toBeUndefined()
    expect(resolveInvoiceDocumentVariant('thumb')).toBe('thumb')
    // poster 是视频封面专用、大小写敏感、类型错误的取值一律按参数校验失败处理。
    expect(resolveInvoiceDocumentVariant('poster')).toBe('invalid')
    expect(resolveInvoiceDocumentVariant('THUMB')).toBe('invalid')
    expect(resolveInvoiceDocumentVariant(42)).toBe('invalid')
  })
})
