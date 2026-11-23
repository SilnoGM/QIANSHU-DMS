import { Prisma } from '../../generated/prisma/client'
import {
  calculateSettleAmountCny,
  calculateTaxAmount,
  describeSettleFormula,
  INVOICE_SETTLE_WAIT_HOURS,
  INVOICE_TOTAL_TOLERANCE_CENTS,
  isSettleable,
  resolveInvoiceAmounts,
  resolveInvoiceDocumentVariant,
  resolveSettleableAt,
  sumBatchSettleAmountsCny,
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

  it('derives the tax as the residual when the paper total is provided', () => {
    // 源行 55：43,810 × 5% = 2,190.5，票面是 2,190 / 总计 46,000。
    const paper = resolveInvoiceAmounts(43_810n, '46000')
    expect(paper).toEqual({
      status: 'OK',
      salesAmount: 43_810n,
      taxAmount: 2_190n,
      totalAmount: 46_000n,
      taxAdjusted: true,
      deviationCents: 50,
    })
    // 源行 163 同理：323,810 → 16,190 / 340,000。
    expect(resolveInvoiceAmounts(323_810n, '340000')).toMatchObject({ status: 'OK', taxAmount: 16_190n, totalAmount: 340_000n, taxAdjusted: true })

    // 不传总计（或空串）时保持现行 5% 口径。
    for (const input of [undefined, null, '', '   ']) {
      expect(resolveInvoiceAmounts(47_619n, input)).toEqual({
        status: 'OK',
        salesAmount: 47_619n,
        taxAmount: 2_381n,
        totalAmount: 50_000n,
        taxAdjusted: false,
        deviationCents: 0,
      })
    }
  })

  it('accepts the nearest sales amount only and rejects the neighbour', () => {
    expect(INVOICE_TOTAL_TOLERANCE_CENTS).toBe(50)
    // 46,000 只允许 43,810：偏差恰好 0.5 元，落在容差边界内。
    expect(resolveInvoiceAmounts(43_810n, '46000')).toMatchObject({ status: 'OK', taxAmount: 2_190n })
    // 43,809 会得到 2,191 / 46,000，但偏差 0.55 元越界。
    expect(resolveInvoiceAmounts(43_809n, '46000')).toEqual({
      status: 'TOTAL_OUT_OF_TOLERANCE',
      salesAmount: 43_809n,
      requestedTotalAmount: 46_000n,
      computedTotalAmount: 45_999n,
      deviationCents: 55,
    })
    // 总计差 1 元的另一侧：46,001 与 43,810 的偏差仍是 0.5 元，接受。
    expect(resolveInvoiceAmounts(43_810n, '46001')).toMatchObject({ status: 'OK', taxAmount: 2_191n, totalAmount: 46_001n })
    // 再差 1 元即越界。
    expect(resolveInvoiceAmounts(43_810n, '46002')).toMatchObject({ status: 'TOTAL_OUT_OF_TOLERANCE', deviationCents: 150 })
  })

  it('rejects a total that would make the tax negative or the rate wildly wrong', () => {
    expect(resolveInvoiceAmounts(100_000n, '50000')).toMatchObject({ status: 'TOTAL_OUT_OF_TOLERANCE', deviationCents: 5_500_000 })
    expect(resolveInvoiceAmounts(100_000n, '100000')).toMatchObject({ status: 'TOTAL_OUT_OF_TOLERANCE', deviationCents: 500_000 })
    // 极小金额仍按容差判定：1 元含税、税额 0，偏差 0.05 元，接受。
    expect(resolveInvoiceAmounts(1n, '1')).toMatchObject({ status: 'OK', taxAmount: 0n, totalAmount: 1n, taxAdjusted: false })
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

  it('sums batch settlement amounts per document before adding them up', () => {
    // 每单各自向上取整：1000 ÷ 4.5 × 0.06 + 30 = 43.33… → 44。
    const one = calculateSettleAmountCny(1_000n, new Prisma.Decimal('4.5'))
    expect(one).toBe('44.00')
    expect(sumBatchSettleAmountsCny([one, one])).toBe('88.00')
    // 合并成 2000 再套一次公式会得到 57：向上取整必须逐单发生，批量合计只能相加。
    expect(calculateSettleAmountCny(2_000n, new Prisma.Decimal('4.5'))).toBe('57.00')
    expect(sumBatchSettleAmountsCny(['3302.00', '31.00'])).toBe('3333.00')
    expect(sumBatchSettleAmountsCny([])).toBe('0.00')
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
