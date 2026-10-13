import { Prisma } from '../../../generated/prisma/client'
import type { SalesOrderMutationContext } from '../sales-order-mutation.service'
import { SalesReceiptService } from './sales-receipt.service'

describe('收款引起的付款状态变更原因', () => {
  it.each([
    ['审核备注：已核对到账', true],
    ['凭证重复，作废收款', false],
  ])('保存原因 %s', async (reason, advance) => {
    const create = jest.fn().mockResolvedValue({})
    const tx = {
      salesOrderPayment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal(50) } }) },
      salesOrder: { update: jest.fn().mockResolvedValue({}) },
      salesOrderStatusHistory: { create },
    }
    const automatic = { advanceWhenEligible: jest.fn().mockResolvedValue('NONE') }
    // 直接验证事务内部实际写入，避免测试触发真实资金分录。
    const update = SalesReceiptService.prototype['updatePaymentStatus']
    await update.call({ automatic } as unknown as SalesReceiptService, tx as unknown as Prisma.TransactionClient,
      { actorUserId: 'actor' } as SalesOrderMutationContext,
      { id: 'order', agreedTotalAmount: new Prisma.Decimal(100), paymentStatus: 'UNPAID' }, advance, reason)
    expect(create).toHaveBeenCalledWith({ data: { reason, dimension: 'PAYMENT', toStatus: 'PARTIALLY_PAID', fromStatus: 'UNPAID', salesOrderId: 'order', changedByUserId: 'actor' } })
  })
})
