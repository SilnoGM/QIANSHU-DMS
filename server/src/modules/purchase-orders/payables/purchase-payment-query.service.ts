import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import {
  PERSON_REFERENCE_SELECT,
  toNullablePersonReference,
  toPersonReference,
} from '../../../infrastructure/database/person-reference'
import {
  DataScopeService,
  dataScopeFallback,
  resolveDataScopeActor,
} from '../../access-control/data-scope.service'
import {
  DictionaryLookupService,
  type StoredDictionaryValueResolution,
} from '../../dictionaries/dictionary-lookup.service'
import { purchaseOrderScopeWhere } from '../purchase-order-access'
import type {
  PurchasePaymentListQueryDto,
  PurchasePaymentRecordDto,
  PurchasePaymentRecordPageDto,
} from './purchase-payment.dto'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'

const PAYMENT_RECORD_SELECT = {
  id: true,
  payableId: true,
  paymentType: true,
  amount: true,
  paidAt: true,
  paymentMethod: true,
  remark: true,
  createdAt: true,
  voidedAt: true,
  voidReason: true,
  createdBy: { select: PERSON_REFERENCE_SELECT },
  voidedBy: { select: PERSON_REFERENCE_SELECT },
  purchaseOrder: {
    select: {
      id: true,
      orderNo: true,
      orderDate: true,
      purchaseType: true,
      orderStatus: true,
      fulfillmentStatus: true,
      supplierValue: true,
      customSupplierName: true,
      salesOrder: { select: { orderNo: true } },
    },
  },
} as const satisfies Prisma.PurchaseOrderPaymentSelect

type PaymentRecordRow = Prisma.PurchaseOrderPaymentGetPayload<{
  select: typeof PAYMENT_RECORD_SELECT
}>

@Injectable()
export class PurchasePaymentQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionary: DictionaryLookupService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  async list(
    input: PurchasePaymentListQueryDto,
    actorUserId: string = resolveDataScopeActor(),
  ): Promise<PurchasePaymentRecordPageDto> {
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const keyword = input.keyword?.trim()
    const status = input.status ?? 'ALL'

    return this.prisma.$transaction(async (transaction) => {
      const scope = await this.dataScope.resolveInTransaction(
        transaction,
        actorUserId,
      )
      const where: Prisma.PurchaseOrderPaymentWhereInput = {
        ...(status === 'ACTIVE'
          ? { voidedAt: null }
          : status === 'VOIDED'
            ? { voidedAt: { not: null } }
            : {}),
        AND: [
          // 付款归属按应付款 ownerUserId 判断；历史无应付款的付款退回采购单
          // 销售来源归属，避免 SELF 角色看到他人或公司付款。
          ...(scope === 'SELF'
            ? [{
                OR: [
                  { payable: { is: { ownerUserId: actorUserId } } },
                  {
                    payableId: null,
                    purchaseOrder: {
                      is: purchaseOrderScopeWhere(scope, actorUserId),
                    },
                  },
                ],
              } satisfies Prisma.PurchaseOrderPaymentWhereInput]
            : []),
          ...(keyword
            ? [{
                OR: [
                  { purchaseOrder: { is: { orderNo: { contains: keyword, mode: 'insensitive' } } } },
                  { purchaseOrder: { is: { customSupplierName: { contains: keyword, mode: 'insensitive' } } } },
                  { purchaseOrder: { is: { salesOrder: { is: { orderNo: { contains: keyword, mode: 'insensitive' } } } } } },
                  { remark: { contains: keyword, mode: 'insensitive' } },
                ],
              } satisfies Prisma.PurchaseOrderPaymentWhereInput]
            : []),
        ],
      }

      const [rows, total] = await Promise.all([
        transaction.purchaseOrderPayment.findMany({
          where,
          select: PAYMENT_RECORD_SELECT,
          orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        transaction.purchaseOrderPayment.count({ where }),
      ])

      const supplierValues = [...new Set(rows.flatMap(row => (
        row.purchaseOrder.supplierValue === null
          ? []
          : [row.purchaseOrder.supplierValue]
      )))]
      const resolutions = supplierValues.length === 0
        ? []
        : await this.dictionary.resolveStoredValuesInTransaction(
            transaction,
            {
              dictionaryCode: SUPPLIER_DICTIONARY_CODE,
              values: supplierValues,
            },
          )
      const resolutionByValue = new Map<string, StoredDictionaryValueResolution>()
      supplierValues.forEach((value, index) => {
        const resolution = resolutions[index]
        if (resolution !== undefined) {
          resolutionByValue.set(value, resolution)
        }
      })

      return {
        items: rows.map(row => this.map(row, resolutionByValue)),
        total,
        page,
        pageSize,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }

  private map(
    row: PaymentRecordRow,
    resolutionByValue: ReadonlyMap<string, StoredDictionaryValueResolution>,
  ): PurchasePaymentRecordDto {
    const order = row.purchaseOrder
    const supplier = order.supplierValue === null
      ? undefined
      : resolutionByValue.get(order.supplierValue)
    return {
      id: row.id,
      purchaseOrderId: order.id,
      payableId: row.payableId,
      orderNo: order.orderNo,
      orderDate: order.orderDate.toISOString().slice(0, 10),
      supplierName: order.customSupplierName
        ?? (supplier?.known === true ? supplier.label : order.supplierValue ?? '—'),
      purchaseType: order.purchaseType,
      orderStatus: order.orderStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      salesOrderNo: order.salesOrder?.orderNo ?? null,
      paymentType: row.paymentType,
      amount: row.amount.toFixed(2),
      paidAt: row.paidAt.toISOString(),
      paymentMethod: row.paymentMethod,
      remark: row.remark,
      createdBy: toPersonReference(row.createdBy),
      createdAt: row.createdAt.toISOString(),
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidedBy: toNullablePersonReference(row.voidedBy),
      voidReason: row.voidReason,
    }
  }
}
