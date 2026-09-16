import { Injectable } from '@nestjs/common'
import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import type { PurchasePayableListQueryDto, PurchasePayableOrderDto, PurchasePayableOrderPageDto } from './purchase-payable.dto'
import { payableFailure, summarizePayable } from './purchase-payable.logic'

const person = { select: { id: true, displayName: true } }
const include = {
  salesOrder: { select: { orderNo: true } },
  payables: { include: { owner: person, payments: { where: { voidedAt: null }, include: { createdBy: person }, orderBy: [{ paidAt: 'desc' as const }, { id: 'desc' as const }] } } },
} satisfies Prisma.PurchaseOrderInclude
type Order = Prisma.PurchaseOrderGetPayload<{ include: typeof include }>
@Injectable()
export class PurchasePayableQueryService {
  constructor(private readonly prisma: PrismaService, private readonly dictionary: DictionaryLookupService) {}
  private async map(tx: Prisma.TransactionClient, row: Order): Promise<PurchasePayableOrderDto> {
    const payables = [...row.payables].sort((a, b) => a.paymentType === b.paymentType ? 0 : a.paymentType === 'DEPOSIT' ? -1 : 1)
    const owner = payables[0]
    if (!owner || payables.length !== 2) return payableFailure('PURCHASE_PAYABLE_NOT_AVAILABLE', '采购应付款记录不完整，请核对')
    const supplier = row.supplierValue ? await this.dictionary.resolveStoredValueInTransaction(tx, { dictionaryCode: 'service_provider.supplier', value: row.supplierValue }) : null
    return {
      id: row.id, orderNo: row.orderNo, orderDate: row.orderDate.toISOString().slice(0, 10), purchaseType: row.purchaseType,
      supplierName: row.customSupplierName ?? (supplier?.known ? supplier.label : row.supplierValue ?? '—'),
      salesOrderNo: row.salesOrder?.orderNo ?? null, purchaseTotalAmount: row.purchaseTotalAmount.toFixed(2), currencyCode: 'CNY',
      accountOwnerType: owner.accountOwnerType, owner: owner.owner ? { id: owner.owner.id, name: owner.owner.displayName } : null,
      items: payables.map(payable => {
        const last = payable.payments[0]
        return { id: payable.id, paymentType: payable.paymentType as 'DEPOSIT' | 'BALANCE', dueAmount: payable.dueAmount.toFixed(2),
          ...summarizePayable(payable.dueAmount.toFixed(2), payable.payments.map(payment => payment.amount.toFixed(2)), payable.closedAt !== null),
          version: payable.version, paidAt: last?.paidAt.toISOString() ?? null,
          paidBy: last ? { id: last.createdBy.id, name: last.createdBy.displayName } : null }
      }),
    }
  }
  async getOrder(id: string): Promise<PurchasePayableOrderDto> {
    return this.prisma.$transaction(async tx => {
      const order = await tx.purchaseOrder.findUnique({ where: { id }, include })
      if (!order || !order.payables.length) return payableFailure('PURCHASE_PAYABLE_NOT_FOUND', '采购应付款不存在', 404)
      return this.map(tx, order)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }
  async list(input: PurchasePayableListQueryDto): Promise<PurchasePayableOrderPageDto> {
    const page = input.page ?? 1, pageSize = input.pageSize ?? 20, keyword = input.keyword?.trim()
    const where: Prisma.PurchaseOrderWhereInput = { payables: { some: {} }, ...(keyword ? { OR: [
      { orderNo: { contains: keyword, mode: 'insensitive' } }, { customSupplierName: { contains: keyword, mode: 'insensitive' } },
      { salesOrder: { orderNo: { contains: keyword, mode: 'insensitive' } } },
    ] } : {}) }
    // 按父采购单分页，再读取完整定金/尾款；同一快照内取得组数和明细，避免跨页拆单。
    return this.prisma.$transaction(async tx => {
      const [rows, total] = await Promise.all([
        tx.purchaseOrder.findMany({ where, include, orderBy: [{ orderDate: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
        tx.purchaseOrder.count({ where }),
      ])
      return { items: await Promise.all(rows.map(row => this.map(tx, row))), total, page, pageSize }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }
}
