import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import type {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderPaymentStatus,
  PurchaseOrderStatus,
  PurchaseOrderType,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  DictionaryLookupService,
  type StoredDictionaryValueResolution,
} from '../dictionaries/dictionary-lookup.service'
import {
  formatPurchaseOrderAmountUnits,
  parsePurchaseOrderAmountUnits,
} from './domain/purchase-order-decimal'
import type { PurchaseOrderPendingTask } from './dto/purchase-order-query.dto'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'

const PURCHASE_ORDER_LIST_SELECT = {
  id: true,
  orderNo: true,
  purchaseType: true,
  supplierValue: true,
  orderDate: true,
  currencyCode: true,
  purchaseTotalAmount: true,
  depositDueAmount: true,
  balanceDueAmount: true,
  orderStatus: true,
  fulfillmentStatus: true,
  paymentStatus: true,
  remark: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  salesOrder: {
    select: { id: true, orderNo: true, customerName: true },
  },
} as const satisfies Prisma.PurchaseOrderSelect

const PURCHASE_ORDER_DETAIL_SELECT = {
  ...PURCHASE_ORDER_LIST_SELECT,
  shippingMarkText: true,
  lineSubtotalAmount: true,
  createdBy: { select: { id: true, displayName: true } },
  lines: {
    orderBy: [{ lineNumber: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      lineNumber: true,
      lineType: true,
      productId: true,
      sourceSalesOrderLineId: true,
      productNoSnapshot: true,
      productNameSnapshot: true,
      productAttributesSnapshot: true,
      descriptionSnapshot: true,
      referencePurchaseUnitPriceAmount: true,
      actualPurchaseUnitPriceAmount: true,
      quantity: true,
      lineTotalAmount: true,
    },
  },
  payments: {
    orderBy: [{ paidAt: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true,
      paymentType: true,
      amount: true,
      paidAt: true,
      paymentMethod: true,
      remark: true,
      createdAt: true,
      voidedAt: true,
      voidReason: true,
      createdBy: { select: { id: true, displayName: true } },
      voidedBy: { select: { id: true, displayName: true } },
    },
  },
  documents: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true,
      mediaAssetId: true,
      paymentId: true,
      documentType: true,
      title: true,
      remark: true,
      createdAt: true,
      detachedAt: true,
      mediaAsset: {
        select: {
          originalFilename: true,
          mimeType: true,
          mediaType: true,
          sizeBytes: true,
        },
      },
      createdBy: { select: { id: true, displayName: true } },
      detachedBy: { select: { id: true, displayName: true } },
    },
  },
  statusHistory: {
    orderBy: [{ changedAt: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true,
      dimension: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      changedAt: true,
      changedBy: { select: { id: true, displayName: true } },
    },
  },
} as const satisfies Prisma.PurchaseOrderSelect

type PurchaseOrderListRow = Prisma.PurchaseOrderGetPayload<{
  select: typeof PURCHASE_ORDER_LIST_SELECT
}>
export interface PurchaseOrderListQueryInput {
  readonly view: 'all' | 'pending'
  readonly page?: number
  readonly pageSize?: number
  readonly keyword?: string
  readonly supplierValue?: string
  readonly purchaseType?: PurchaseOrderType
  readonly orderStatus?: PurchaseOrderStatus
  readonly fulfillmentStatus?: PurchaseOrderFulfillmentStatus
  readonly paymentStatus?: PurchaseOrderPaymentStatus
  readonly pendingTask?: PurchaseOrderPendingTask
  readonly orderDateFrom?: string
  readonly orderDateTo?: string
}

export interface PurchaseOrderSupplier {
  readonly value: string
  readonly label: string
  readonly tone: string
  readonly known: boolean
  readonly effectiveEnabled: boolean
}

export interface PurchaseOrderListItem {
  readonly id: string
  readonly orderNo: string
  readonly purchaseType: PurchaseOrderType
  readonly salesOrderNo: string | null
  readonly customerName: string | null
  readonly supplier: PurchaseOrderSupplier
  readonly orderDate: string
  readonly currencyCode: string
  readonly purchaseTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
  readonly paidAmount: string
  readonly outstandingAmount: string
  readonly orderStatus: PurchaseOrderStatus
  readonly fulfillmentStatus: PurchaseOrderFulfillmentStatus
  readonly paymentStatus: PurchaseOrderPaymentStatus
  readonly remark: string | null
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PurchaseOrderPage {
  readonly items: readonly PurchaseOrderListItem[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface PurchaseOrderDetail extends PurchaseOrderListItem {
  readonly sourceSalesOrder: {
    readonly id: string
    readonly orderNo: string
    readonly customerName: string
  } | null
  readonly shippingMarkText: string | null
  readonly amounts: {
    readonly lineSubtotalAmount: string
    readonly purchaseTotalAmount: string
    readonly depositDueAmount: string
    readonly balanceDueAmount: string
    readonly paidAmount: string
    readonly outstandingAmount: string
  }
  readonly createdBy: { readonly id: string, readonly displayName: string }
  readonly lines: readonly Record<string, unknown>[]
  readonly payments: readonly Record<string, unknown>[]
  readonly documents: readonly Record<string, unknown>[]
  readonly statusHistory: readonly Record<string, unknown>[]
}

function decimalToFixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
}

function supplierFromResolution(
  value: string,
  resolution: StoredDictionaryValueResolution | undefined,
): PurchaseOrderSupplier {
  if (resolution?.known === true) {
    return {
      value,
      label: resolution.label,
      tone: resolution.tone,
      known: true,
      effectiveEnabled: resolution.effectiveEnabled,
    }
  }
  return {
    value,
    label: value,
    tone: 'DEFAULT',
    known: false,
    effectiveEnabled: false,
  }
}

function actor(value: { readonly id: string, readonly displayName: string } | null) {
  return value === null ? null : { id: value.id, displayName: value.displayName }
}

function paidUnits(value: { toFixed(decimalPlaces: number): string } | null): bigint {
  return value === null ? 0n : parsePurchaseOrderAmountUnits(decimalToFixed4(value))
}

function mapListItem(
  row: PurchaseOrderListRow,
  supplier: PurchaseOrderSupplier,
  activePaidUnits: bigint,
): PurchaseOrderListItem {
  const totalUnits = parsePurchaseOrderAmountUnits(
    decimalToFixed4(row.purchaseTotalAmount),
  )
  return {
    id: row.id,
    orderNo: row.orderNo,
    purchaseType: row.purchaseType,
    salesOrderNo: row.salesOrder?.orderNo ?? null,
    customerName: row.salesOrder?.customerName ?? null,
    supplier,
    orderDate: row.orderDate.toISOString().slice(0, 10),
    currencyCode: row.currencyCode,
    purchaseTotalAmount: formatPurchaseOrderAmountUnits(totalUnits),
    depositDueAmount: decimalToFixed4(row.depositDueAmount),
    balanceDueAmount: decimalToFixed4(row.balanceDueAmount),
    paidAmount: formatPurchaseOrderAmountUnits(activePaidUnits),
    outstandingAmount: formatPurchaseOrderAmountUnits(totalUnits - activePaidUnits),
    orderStatus: row.orderStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    paymentStatus: row.paymentStatus,
    remark: row.remark,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

@Injectable()
export class PurchaseOrderQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryLookup: DictionaryLookupService,
  ) {}

  async list(input: PurchaseOrderListQueryInput): Promise<PurchaseOrderPage> {
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const keyword = input.keyword?.trim().normalize('NFKC')
    // 待办任务允许交叉归类，因此直接由当前任务生成服务端谓词，而不在页面合并结果。
    const taskClauseByType: Readonly<Record<
      PurchaseOrderPendingTask,
      Prisma.PurchaseOrderWhereInput
    >> = {
      AWAITING_PAYMENT: {
        paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
      },
      AWAITING_SHIPMENT: {
        fulfillmentStatus: { in: ['ORDERED', 'PREPARING'] },
      },
      AWAITING_WAREHOUSE: { fulfillmentStatus: 'SHIPPED' },
    }
    const pendingClause: Prisma.PurchaseOrderWhereInput | undefined =
      input.view !== 'pending'
        ? undefined
        : input.pendingTask === undefined
          ? { OR: [
              { fulfillmentStatus: { not: 'SIGNED' } },
              { paymentStatus: { not: 'PAID' } },
            ] }
          : taskClauseByType[input.pendingTask]
    const explicitOrderStatus = input.view === 'pending' && input.orderStatus !== undefined
      ? { orderStatus: input.orderStatus }
      : undefined
    const where: Prisma.PurchaseOrderWhereInput = {
      orderStatus: input.view === 'pending'
        ? { not: 'CANCELLED' }
        : input.orderStatus,
      fulfillmentStatus: input.fulfillmentStatus,
      paymentStatus: input.paymentStatus,
      purchaseType: input.purchaseType,
      supplierValue: input.supplierValue,
      AND: [pendingClause, explicitOrderStatus].filter(
        (value): value is Prisma.PurchaseOrderWhereInput => value !== undefined,
      ),
      orderDate: input.orderDateFrom === undefined && input.orderDateTo === undefined
        ? undefined
        : {
            gte: input.orderDateFrom === undefined
              ? undefined
              : new Date(`${input.orderDateFrom}T00:00:00.000Z`),
            lte: input.orderDateTo === undefined
              ? undefined
              : new Date(`${input.orderDateTo}T00:00:00.000Z`),
          },
      ...(keyword === undefined || keyword.length === 0
        ? {}
        : { OR: [
            { orderNo: { contains: keyword, mode: 'insensitive' } },
            { salesOrder: { is: {
              orderNo: { contains: keyword, mode: 'insensitive' },
            } } },
            { salesOrder: { is: {
              customerName: { contains: keyword, mode: 'insensitive' },
            } } },
          ] }),
    }
    const [total, rows] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: PURCHASE_ORDER_LIST_SELECT,
      }),
    ])
    const ids = rows.map(row => row.id)
    const [paymentRows, supplierResolutions] = await Promise.all([
      ids.length === 0
        ? []
        : this.prisma.purchaseOrderPayment.groupBy({
            by: ['purchaseOrderId'],
            where: { purchaseOrderId: { in: ids }, voidedAt: null },
            _sum: { amount: true },
          }),
      this.dictionaryLookup.resolveStoredValues({
        dictionaryCode: SUPPLIER_DICTIONARY_CODE,
        values: rows.map(row => row.supplierValue),
      }),
    ])
    const paidByOrder = new Map(paymentRows.map(row => [
      row.purchaseOrderId,
      paidUnits(row._sum.amount),
    ]))
    return {
      items: rows.map((row, index) => mapListItem(
        row,
        supplierFromResolution(row.supplierValue, supplierResolutions[index]),
        paidByOrder.get(row.id) ?? 0n,
      )),
      page,
      pageSize,
      total,
    }
  }

  async getById(purchaseOrderId: string): Promise<PurchaseOrderDetail> {
    const row = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: PURCHASE_ORDER_DETAIL_SELECT,
    })
    if (row === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'PURCHASE_ORDER_NOT_FOUND',
        '采购订单不存在',
      )
    }
    const resolution = await this.dictionaryLookup.resolveStoredValue({
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      value: row.supplierValue,
    })
    const activePaidUnits = row.payments.reduce(
      (sum, payment) => payment.voidedAt === null
        ? sum + parsePurchaseOrderAmountUnits(decimalToFixed4(payment.amount))
        : sum,
      0n,
    )
    const summary = mapListItem(
      row,
      supplierFromResolution(row.supplierValue, resolution),
      activePaidUnits,
    )
    const totalUnits = parsePurchaseOrderAmountUnits(
      decimalToFixed4(row.purchaseTotalAmount),
    )
    return {
      ...summary,
      sourceSalesOrder: row.salesOrder,
      shippingMarkText: row.shippingMarkText,
      amounts: {
        lineSubtotalAmount: decimalToFixed4(row.lineSubtotalAmount),
        purchaseTotalAmount: formatPurchaseOrderAmountUnits(totalUnits),
        depositDueAmount: decimalToFixed4(row.depositDueAmount),
        balanceDueAmount: decimalToFixed4(row.balanceDueAmount),
        paidAmount: formatPurchaseOrderAmountUnits(activePaidUnits),
        outstandingAmount: formatPurchaseOrderAmountUnits(
          totalUnits - activePaidUnits,
        ),
      },
      createdBy: row.createdBy,
      lines: row.lines.map(line => ({
        id: line.id,
        lineNumber: line.lineNumber,
        lineType: line.lineType,
        productId: line.productId,
        sourceSalesOrderLineId: line.sourceSalesOrderLineId,
        productNo: line.productNoSnapshot,
        productName: line.productNameSnapshot,
        productAttributes: line.productAttributesSnapshot,
        description: line.descriptionSnapshot,
        referencePurchaseUnitPriceAmount: decimalToFixed4(
          line.referencePurchaseUnitPriceAmount,
        ),
        actualPurchaseUnitPriceAmount: decimalToFixed4(
          line.actualPurchaseUnitPriceAmount,
        ),
        quantity: line.quantity,
        lineTotalAmount: decimalToFixed4(line.lineTotalAmount),
      })),
      payments: row.payments.map(payment => ({
        id: payment.id,
        paymentType: payment.paymentType,
        amount: decimalToFixed4(payment.amount),
        paidAt: payment.paidAt.toISOString(),
        paymentMethod: payment.paymentMethod,
        remark: payment.remark,
        createdBy: actor(payment.createdBy),
        createdAt: payment.createdAt.toISOString(),
        voidedAt: payment.voidedAt?.toISOString() ?? null,
        voidedBy: actor(payment.voidedBy),
        voidReason: payment.voidReason,
      })),
      documents: row.documents.map(document => ({
        id: document.id,
        mediaAssetId: document.mediaAssetId,
        paymentId: document.paymentId,
        documentType: document.documentType,
        title: document.title,
        remark: document.remark,
        originalFilename: document.mediaAsset.originalFilename,
        mimeType: document.mediaAsset.mimeType,
        mediaType: document.mediaAsset.mediaType,
        sizeBytes: document.mediaAsset.sizeBytes?.toString() ?? null,
        contentUrl:
          `/api/purchase-orders/${row.id}/documents/${document.id}/content`,
        createdBy: actor(document.createdBy),
        createdAt: document.createdAt.toISOString(),
        detachedAt: document.detachedAt?.toISOString() ?? null,
        detachedBy: actor(document.detachedBy),
      })),
      statusHistory: row.statusHistory.map(history => ({
        id: history.id,
        dimension: history.dimension,
        fromStatus: history.fromStatus,
        toStatus: history.toStatus,
        reason: history.reason,
        changedBy: actor(history.changedBy),
        changedAt: history.changedAt.toISOString(),
      })),
    }
  }
}
