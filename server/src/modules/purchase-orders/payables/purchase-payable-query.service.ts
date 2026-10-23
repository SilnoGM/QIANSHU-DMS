import { PaymentRecipientService } from '../../payment-recipients/payment-recipient.service'
import type { PaymentRecipientAccountDto, PaymentRecipientProfileDto } from '../../payment-recipients/payment-recipient.dto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import {
  PERSON_REFERENCE_SELECT,
  toNullablePersonReference,
  type PersonReferenceRow,
} from '../../../infrastructure/database/person-reference'
import { DataScopeService, dataScopeFallback, resolveDataScopeActor } from '../../access-control/data-scope.service'
import type { DataScope } from '../../access-control/data-scope'
import { DictionaryLookupService, type StoredDictionaryValueResolution } from '../../dictionaries/dictionary-lookup.service'
import { purchaseOrderPayableScopeWhere } from '../purchase-order-access'
import type { PurchasePayableBatchOrdersDto, PurchasePayableBatchSuppliersDto, PurchasePayableListQueryDto, PurchasePayableOrderDto, PurchasePayableOrderPageDto } from './purchase-payable.dto'
import { payableFailure, summarizePayable } from './purchase-payable.logic'
import { normalizeBatchSupplier } from './purchase-payable-batch.logic'

const person = { select: PERSON_REFERENCE_SELECT }
const include = {
  salesOrder: { select: { orderNo: true } },
  payables: { include: { owner: person, payments: { where: { voidedAt: null }, include: { createdBy: person, documents: { where: { detachedAt: null, documentType: 'PAYMENT_VOUCHER' }, take: 1 } }, orderBy: [{ paidAt: 'desc' as const }, { id: 'desc' as const }] } } },
} satisfies Prisma.PurchaseOrderInclude
type Order = Prisma.PurchaseOrderGetPayload<{ include: typeof include }>
const outstandingOrders = {
  orderStatus: 'CONFIRMED', paymentStatus: { not: 'PAID' }, payables: { some: { closedAt: null, dueAmount: { gt: 0 } } },
} satisfies Prisma.PurchaseOrderWhereInput

function toPayablePerson(value: PersonReferenceRow) {
  const reference = toNullablePersonReference(value)!
  return { id: reference.id, name: reference.displayName, avatarUrl: reference.avatarUrl }
}
@Injectable()
export class PurchasePayableQueryService {
  constructor(private readonly prisma: PrismaService, private readonly dictionary: DictionaryLookupService, private readonly recipients: PaymentRecipientService, private readonly dataScope: DataScopeService = dataScopeFallback()) {}
  async batchSuppliers(actorUserId: string = resolveDataScopeActor()): Promise<PurchasePayableBatchSuppliersDto> {
    const scope = await this.dataScope.resolve(actorUserId)
    return this.prisma.$transaction(async tx => {
      // 待结清历史供应商仍需付款，不能用当前有效字典选项过滤掉已停用条目。
      const rows = await tx.purchaseOrder.findMany({ where: { ...this.outstandingOrderWhere(scope, actorUserId), productMode: 'CATALOG', supplierValue: { not: null } },
        distinct: ['supplierValue'], select: { supplierValue: true }, orderBy: { supplierValue: 'asc' } })
      const values = rows.map(row => row.supplierValue!)
      const resolved = await this.dictionary.resolveStoredValuesInTransaction(tx, {
        dictionaryCode: 'service_provider.supplier',
        values,
      })
      return {
        items: values.map((value, index) => ({
          value,
          label: resolved[index]?.known === true ? resolved[index].label : value,
        })),
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }
  async batchOrders(rawSupplier: string, actorUserId: string = resolveDataScopeActor()): Promise<PurchasePayableBatchOrdersDto> {
    const supplierValue = normalizeBatchSupplier(rawSupplier)
    const scope = await this.dataScope.resolve(actorUserId)
    return this.prisma.$transaction(async tx => {
      const rows = await tx.purchaseOrder.findMany({ where: { ...this.outstandingOrderWhere(scope, actorUserId), productMode: 'CATALOG', supplierValue }, include,
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }] })
      const supplierValues = rows.flatMap(row => row.supplierValue === null ? [] : [row.supplierValue])
      const [supplierResolutions, recipientsByOrderId] = await Promise.all([
        this.dictionary.resolveStoredValuesInTransaction(tx, {
          dictionaryCode: 'service_provider.supplier',
          values: supplierValues,
        }),
        this.recipients.getForOrders(tx, rows),
      ])
      const supplierByValue = new Map(supplierValues.map((value, index) => [
        value,
        supplierResolutions[index],
      ] as const))
      return {
        items: rows.map(row => this.map(
          row,
          row.supplierValue === null ? undefined : supplierByValue.get(row.supplierValue),
          recipientsByOrderId.get(row.id) ?? null,
        )),
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }
  /**
   * SELF 下待付采购单必须含有归当前用户的应付款；ALL 保持原全量谓词。
   * 应付归属使用 ownerUserId，而不是采购单出单人，因为 STOCK 应付归公司且无销售来源。
   */
  private outstandingOrderWhere(scope: DataScope, actorUserId: string = resolveDataScopeActor()): Prisma.PurchaseOrderWhereInput {
    return {
      ...outstandingOrders,
      payables: { some: { closedAt: null, dueAmount: { gt: 0 }, ...purchaseOrderPayableScopeWhere(scope, actorUserId) } },
    }
  }
  /** 单条详情仍按需读取；列表与批量页走 getForOrders 一次取回。 */
  private async mapOrder(
    tx: Prisma.TransactionClient,
    row: Order,
  ): Promise<PurchasePayableOrderDto> {
    const supplier = row.supplierValue === null
      ? undefined
      : await this.dictionary.resolveStoredValueInTransaction(tx, {
          dictionaryCode: 'service_provider.supplier',
          value: row.supplierValue,
        })
    return this.map(row, supplier, await this.recipients.getForOrder(tx, row))
  }

  private map(
    row: Order,
    supplier: StoredDictionaryValueResolution | undefined,
    paymentRecipientProfile: PaymentRecipientProfileDto | null,
  ): PurchasePayableOrderDto {
    const payables = [...row.payables].sort((a, b) => a.paymentType === b.paymentType ? 0 : a.paymentType === 'DEPOSIT' ? -1 : 1)
    const owner = payables[0]
    if (!owner || payables.length !== 2) return payableFailure('PURCHASE_PAYABLE_NOT_AVAILABLE', '采购应付款记录不完整，请核对')
    return {
      paymentRecipientProfile,
      id: row.id, orderNo: row.orderNo, orderDate: row.orderDate.toISOString().slice(0, 10), purchaseType: row.purchaseType,
      supplierName: row.customSupplierName ?? (supplier?.known ? supplier.label : row.supplierValue ?? '—'),
      salesOrderNo: row.salesOrder?.orderNo ?? null, purchaseTotalAmount: row.purchaseTotalAmount.toFixed(2), currencyCode: 'CNY',
      accountOwnerType: owner.accountOwnerType, owner: owner.owner ? toPayablePerson(owner.owner) : null,
      items: payables.map(payable => {
        const last = payable.payments[0]
        const document = last?.documents[0]
        const recipient = last?.recipientSnapshot as unknown as PaymentRecipientAccountDto | null
        return { paymentReceipt: last ? { recipient: recipient ?? null, voucher: document ? {
            id: document.id, mediaAssetId: document.mediaAssetId, title: document.title,
            contentUrl: `/purchase-order-payables/${payable.id}/vouchers/${document.id}/content`,
          } : null } : null,
          id: payable.id, paymentType: payable.paymentType as 'DEPOSIT' | 'BALANCE', dueAmount: payable.dueAmount.toFixed(2),
          ...summarizePayable(payable.dueAmount.toFixed(2), payable.payments.map(payment => payment.amount.toFixed(2)), payable.closedAt !== null),
          version: payable.version, paidAt: last?.paidAt.toISOString() ?? null,
          paidBy: last ? toPayablePerson(last.createdBy) : null }
      }),
    }
  }
  async getOrder(id: string, actorUserId: string = resolveDataScopeActor()): Promise<PurchasePayableOrderDto> {
    const scope = await this.dataScope.resolve(actorUserId)
    return this.prisma.$transaction(async tx => {
      const order = await tx.purchaseOrder.findFirst({
        where: {
          id,
          // 应付详情按阶段归属判断可见性；SELF 下没有本人应付的阶段与不存在同样返回 404。
          ...(scope === 'SELF' ? { payables: { some: purchaseOrderPayableScopeWhere(scope, actorUserId) } } : {}),
        },
        include,
      })
      if (!order || !order.payables.length) return payableFailure('PURCHASE_PAYABLE_NOT_FOUND', '采购应付款不存在', 404)
      return this.mapOrder(tx, order)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }
  async getByPayableId(id: string, actorUserId: string = resolveDataScopeActor()): Promise<PurchasePayableOrderDto> {
    const scope = await this.dataScope.resolve(actorUserId)
    return this.prisma.$transaction(async tx => {
      // 付款链接绑定具体阶段；已付、取消及零金额仍须显示原状态，不套用待办列表条件。
      const payable = await tx.purchaseOrderPayable.findFirst({
        where: { id, ...purchaseOrderPayableScopeWhere(scope, actorUserId) },
        select: { purchaseOrder: { include } },
      })
      if (!payable) return payableFailure('PURCHASE_PAYABLE_NOT_FOUND', '采购应付款不存在', 404)
      return this.mapOrder(tx, payable.purchaseOrder)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }
  async list(input: PurchasePayableListQueryDto, actorUserId: string = resolveDataScopeActor()): Promise<PurchasePayableOrderPageDto> {
    const page = input.page ?? 1, pageSize = input.pageSize ?? 20, keyword = input.keyword?.trim()
    const scope = await this.dataScope.resolve(actorUserId)
    // 付款状态由有效付款汇总维护，并由数据库约束核对；零总额同样为 PAID。
    // 先排除已处理采购单再分页，让组数、页码和付款作废后的重新出现保持一致。
    const where: Prisma.PurchaseOrderWhereInput = {
      ...this.outstandingOrderWhere(scope, actorUserId),
      ...(keyword ? { OR: [
        { orderNo: { contains: keyword, mode: 'insensitive' } }, { customSupplierName: { contains: keyword, mode: 'insensitive' } },
        { salesOrder: { orderNo: { contains: keyword, mode: 'insensitive' } } },
      ] } : {}),
    }
    // 按父采购单分页，再读取完整定金/尾款；同一快照内取得组数和明细，避免跨页拆单。
    return this.prisma.$transaction(async tx => {
      const [rows, total] = await Promise.all([
        tx.purchaseOrder.findMany({ where, include, orderBy: [{ orderDate: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
        tx.purchaseOrder.count({ where }),
      ])
      const supplierValues = rows.flatMap(row => row.supplierValue === null ? [] : [row.supplierValue])
      const [supplierResolutions, recipientsByOrderId] = await Promise.all([
        this.dictionary.resolveStoredValuesInTransaction(tx, {
          dictionaryCode: 'service_provider.supplier',
          values: supplierValues,
        }),
        this.recipients.getForOrders(tx, rows),
      ])
      const supplierByValue = new Map(supplierValues.map((value, index) => [
        value,
        supplierResolutions[index],
      ] as const))
      return {
        items: rows.map(row => this.map(
          row,
          row.supplierValue === null ? undefined : supplierByValue.get(row.supplierValue),
          recipientsByOrderId.get(row.id) ?? null,
        )),
        total,
        page,
        pageSize,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }
}
