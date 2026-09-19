import { Prisma } from '../../generated/prisma/client'
import { OceanFreightBillCalculationService } from './ocean-freight-bill-calculation.service'

const decimal = (value: string) => new Prisma.Decimal(value)
const computedMoney = { chargeTotalAmountTwd: null, payableAmountCny: null, returnAmountCny: null, netReturnAmountCny: null }
function line(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1', lineType: 'NORMAL', lineNumber: 1, reconciliationStatus: 'PENDING', version: 2,
    packageCount: 10, lengthCm: decimal('128'), widthCm: decimal('19'), heightCm: decimal('15'),
    grossWeightKg: decimal('180'), volumeCai: null, chargeableVolumeCai: null,
    reportedVolumeCai: decimal('12.88'), codAmountTwd: decimal('480'),
    sourceData: { raw: 'retained' }, charges: [], ...computedMoney, ...overrides,
  }
}
function charge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'charge-1', pricingBasis: 'VOLUME', currencyCode: 'CNY', chargeNature: 'NORMAL',
    amount: decimal('999'), chargeableQuantity: decimal('999'), unitPriceAmount: decimal('20'),
    reportedAmount: decimal('250'), ...overrides,
  }
}
function setup(lines = [line()]) {
  const bill = { id: 'bill-1', twdPerCny: decimal('4.8'), codTotalAmountTwd: null,
    roundingDifferenceCny: null, ...computedMoney }
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    oceanFreightBill: { findUnique: jest.fn().mockResolvedValue(bill), update: jest.fn() },
    oceanFreightBillLine: { findMany: jest.fn().mockResolvedValue(lines), update: jest.fn() },
    oceanFreightBillCharge: { update: jest.fn() },
  }
  return { service: new OceanFreightBillCalculationService(), tx, bill }
}

describe('OceanFreightBillCalculationService', () => {
  it('从原始尺寸重算计价费用，保留来源与用户输入，不额外增加父版本', async () => {
    const { service, tx } = setup([line({ charges: [charge()] })])
    await service.recalculateInTransaction(tx as unknown as Prisma.TransactionClient, 'bill-1')
    expect(tx.oceanFreightBillCharge.update).toHaveBeenCalledWith({ where: { id: 'charge-1' }, data: { amount: '260.00', chargeableQuantity: '13.00000000' } })
    expect(tx.oceanFreightBillLine.update).toHaveBeenCalledWith({ where: { id: 'line-1' }, data: {
      volumeCai: '12.88272063', chargeableVolumeCai: 13, chargeTotalAmountTwd: '0.00', payableAmountCny: '260.00',
      returnAmountCny: '100.00', netReturnAmountCny: '-160.00', version: { increment: 1 },
    } })
    expect(tx.oceanFreightBill.update).toHaveBeenCalledWith({ where: { id: 'bill-1' }, data: {
      codTotalAmountTwd: '480.00', chargeTotalAmountTwd: '0.00', payableAmountCny: '260.00',
      returnAmountCny: '100.00', netReturnAmountCny: '-160.00', roundingDifferenceCny: '0.00',
    } })
    expect(tx.oceanFreightBillLine.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }] }))
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3)
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.oceanFreightBill.findUnique.mock.invocationCallOrder[0])
  })

  it('没有录入费用时保持未知；代收已知仍可单独合计', async () => {
    const { service, tx } = setup([line({ packageCount: null, lengthCm: null, widthCm: null, heightCm: null })])
    await service.recalculateInTransaction(tx as unknown as Prisma.TransactionClient, 'bill-1')
    expect(tx.oceanFreightBillLine.update).not.toHaveBeenCalled()
    expect(tx.oceanFreightBill.update).toHaveBeenCalledWith({ where: { id: 'bill-1' }, data: {
      codTotalAmountTwd: '480.00', ...computedMoney, roundingDifferenceCny: null,
    } })
  })

  it('显式零费用与未知代收分别保留；调整行只扣本次费用', async () => {
    const { service, tx } = setup([
      line({ id: 'known', codAmountTwd: decimal('0'), charges: [charge({ pricingBasis: 'FIXED', amount: decimal('500'), currencyCode: 'TWD', chargeableQuantity: null, unitPriceAmount: null })] }),
      line({ id: 'unknown', lineNumber: 2, codAmountTwd: null, charges: [charge({ id: 'zero', pricingBasis: 'FIXED', amount: decimal('0'), chargeableQuantity: null, unitPriceAmount: null })] }),
    ])
    await service.recalculateInTransaction(tx as unknown as Prisma.TransactionClient, 'bill-1')
    expect(tx.oceanFreightBillLine.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'known' }, data: expect.objectContaining({ netReturnAmountCny: '-104.17' }) as unknown }))
    expect(tx.oceanFreightBillLine.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'unknown' }, data: expect.objectContaining({ chargeTotalAmountTwd: '0.00', payableAmountCny: '0.00', returnAmountCny: null, netReturnAmountCny: null }) as unknown }))
    expect(tx.oceanFreightBill.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ codTotalAmountTwd: null, chargeTotalAmountTwd: '500.00', returnAmountCny: null }) as unknown }))
  })

  it('重算结果相同不写入、不增加明细版本，Decimal scale 不影响相等比较', async () => {
    const value = line({ volumeCai: decimal('12.88272063'), chargeableVolumeCai: 13,
      charges: [charge({ amount: decimal('260'), chargeableQuantity: decimal('13') })],
      chargeTotalAmountTwd: decimal('0'), payableAmountCny: decimal('260'), returnAmountCny: decimal('100'), netReturnAmountCny: decimal('-160'),
    })
    const { service, tx, bill } = setup([value])
    Object.assign(bill, { codTotalAmountTwd: decimal('480'), chargeTotalAmountTwd: decimal('0'), payableAmountCny: decimal('260'), returnAmountCny: decimal('100'), netReturnAmountCny: decimal('-160'), roundingDifferenceCny: decimal('0') })
    await service.recalculateInTransaction(tx as unknown as Prisma.TransactionClient, 'bill-1')
    expect(tx.oceanFreightBillLine.update).not.toHaveBeenCalled()
    expect(tx.oceanFreightBillCharge.update).not.toHaveBeenCalled()
    expect(tx.oceanFreightBill.update).not.toHaveBeenCalled()
  })

  it('任一行已确认，拒绝重算整张账单且不产生写入', async () => {
    const { service, tx } = setup([line(), line({ id: 'confirmed', reconciliationStatus: 'CONFIRMED' })])
    await expect(service.recalculateInTransaction(tx as unknown as Prisma.TransactionClient, 'bill-1')).rejects.toMatchObject({ code: 'OCEAN_FREIGHT_BILL_STATE_CHANGED' })
    expect(tx.oceanFreightBillLine.update).not.toHaveBeenCalled()
    expect(tx.oceanFreightBillCharge.update).not.toHaveBeenCalled()
    expect(tx.oceanFreightBill.update).not.toHaveBeenCalled()
  })

  it('历史补费行未判定的非零代收不参与合计，且原始字段仍保留', async () => {
    const value = line({ lineType: 'ADJUSTMENT', codAmountTwd: decimal('19000'),
      charges: [charge({ pricingBasis: 'FIXED', amount: decimal('500'), currencyCode: 'TWD', chargeableQuantity: null, unitPriceAmount: null })],
    })
    const { service, tx } = setup([value])
    await service.recalculateInTransaction(tx as unknown as Prisma.TransactionClient, 'bill-1')
    expect(tx.oceanFreightBillLine.update).toHaveBeenCalledWith({ where: { id: 'line-1' }, data: {
      volumeCai: '12.88272063', chargeableVolumeCai: 13, chargeTotalAmountTwd: '500.00', payableAmountCny: '0.00',
      returnAmountCny: null, netReturnAmountCny: null, version: { increment: 1 },
    } })
    expect(tx.oceanFreightBill.update).toHaveBeenCalledWith({ where: { id: 'bill-1' }, data: {
      codTotalAmountTwd: null, chargeTotalAmountTwd: '500.00', payableAmountCny: '0.00',
      returnAmountCny: null, netReturnAmountCny: null, roundingDifferenceCny: null,
    } })
    expect(value.codAmountTwd?.toFixed()).toBe('19000')
    expect(value.sourceData).toEqual({ raw: 'retained' })
  })

  it('主表累计逐行舍入金额，并保存与整单汇率换算的差额', async () => {
    const values = Array.from({ length: 3 }, (_, index) => line({ id: `line-${index + 1}`, lineNumber: index + 1,
      codAmountTwd: decimal('0.01'),
      charges: [charge({ id: `charge-${index + 1}`, pricingBasis: 'FIXED', amount: decimal('0'), chargeableQuantity: null, unitPriceAmount: null })],
    }))
    const { service, tx, bill } = setup(values)
    bill.twdPerCny = decimal('2')
    await service.recalculateInTransaction(tx as unknown as Prisma.TransactionClient, 'bill-1')
    expect(tx.oceanFreightBill.update).toHaveBeenCalledWith({ where: { id: 'bill-1' }, data: {
      codTotalAmountTwd: '0.03', chargeTotalAmountTwd: '0.00', payableAmountCny: '0.00',
      returnAmountCny: '0.03', netReturnAmountCny: '0.03', roundingDifferenceCny: '0.01',
    } })
  })

  it('非法计价数据在任何派生值落库之前失败', async () => {
    const { service, tx } = setup([line({ charges: [charge()] }), line({ id: 'bad', grossWeightKg: null, charges: [charge({ pricingBasis: 'WEIGHT' })] })])
    await expect(service.recalculateInTransaction(tx as unknown as Prisma.TransactionClient, 'bill-1')).rejects.toMatchObject({ code: 'OCEAN_CALCULATION_INVALID' })
    expect(tx.oceanFreightBillLine.update).not.toHaveBeenCalled()
    expect(tx.oceanFreightBillCharge.update).not.toHaveBeenCalled()
    expect(tx.oceanFreightBill.update).not.toHaveBeenCalled()
  })

  it('空账单不制造零合计，账单不存在明确失败', async () => {
    const { service, tx } = setup([])
    await service.recalculateInTransaction(tx as unknown as Prisma.TransactionClient, 'bill-1')
    expect(tx.oceanFreightBill.update).not.toHaveBeenCalled()
    tx.oceanFreightBill.findUnique.mockResolvedValueOnce(null)
    await expect(service.recalculateInTransaction(tx as unknown as Prisma.TransactionClient, 'bill-1')).rejects.toMatchObject({ code: 'OCEAN_FREIGHT_BILL_NOT_FOUND' })
  })
})
