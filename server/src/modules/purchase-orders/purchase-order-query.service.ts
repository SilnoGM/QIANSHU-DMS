import { PaymentRecipientService } from '../payment-recipients/payment-recipient.service'
import type { PaymentRecipientProfileDto } from '../payment-recipients/payment-recipient.dto'
import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import type {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderPaymentStatus,
  PurchaseOrderProductMode,
  PurchaseOrderStatus,
  PurchaseOrderType,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  PERSON_REFERENCE_SELECT,
  toNullablePersonReference,
  toPersonReference,
  type PersonReference,
  type PersonReferenceRow,
} from '../../infrastructure/database/person-reference'
import { ApiException } from '../../infrastructure/http/api.exception'
import { DataScopeService, dataScopeFallback, resolveDataScopeActor } from '../access-control/data-scope.service'
import {
  DictionaryLookupService,
  type StoredDictionaryValueResolution,
} from '../dictionaries/dictionary-lookup.service'
import {
  formatPurchaseOrderAmountUnits,
  normalizePurchaseOrderSnapshotAmount,
  parsePurchaseOrderAmountUnits,
} from './domain/purchase-order-decimal'
import type { PurchaseOrderPendingTask, PurchaseOrderReviewView } from './dto/purchase-order-query.dto'
import { purchaseOrderScopeWhere } from './purchase-order-access'
import { summarizePurchaseOrderRecords, type PurchaseOrderRecordSummaries } from './purchase-order-record-summary'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'

const PURCHASE_ORDER_LINE_SUMMARY_SELECT = {
  id: true,
  lineType: true,
  productId: true,
  productNameSnapshot: true,
  quantity: true,
  product: {
    select: {
      media: {
        where: {
          kind: 'IMAGE',
          isPrimary: true,
          detachedAt: null,
          mediaAsset: { is: { status: 'READY' } },
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { id: true },
      },
    },
  },
} as const satisfies Prisma.PurchaseOrderLineSelect

const PURCHASE_ORDER_LIST_SELECT = {
  // Prisma 对当前页关系进行批量查询；不为每张采购单额外调用详情接口。
  payments: {
    where: { voidedAt: null },
    select: { paymentType: true, amount: true, voidedAt: true },
  },
  documents: {
    where: { detachedAt: null },
    select: { documentType: true, detachedAt: true },
  },
  _count: { select: { payments: true, statusHistory: true, amountRevisions: true, parts: true } },
  statusHistory: {
    take: 1, orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, changedAt: true, reason: true },
  },
  amountRevisions: {
    take: 1, orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, changedAt: true, reason: true },
  },
  id: true,
  orderNo: true,
  purchaseType: true,
  productMode: true,
  supplierValue: true,
  customSupplierName: true,
  orderDate: true,
  currencyCode: true,
  purchaseTotalAmount: true,
  depositDueAmount: true,
  balanceDueAmount: true,
  orderStatus: true,
  fulfillmentStatus: true,
  paymentStatus: true,
  rejectedAt: true,
  rejectionReason: true,
  rejectedBy: { select: PERSON_REFERENCE_SELECT },
  shippingMarkText: true,
  parts: { orderBy: { partNumber: 'asc' }, select: { shippingMarkText: true, shippedAt: true, warehouseReceivedAt: true, status: true } },
  remark: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: PERSON_REFERENCE_SELECT },
  salesOrder: {
    select: { id: true, orderNo: true, customerName: true },
  },
  lines: {
    orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
    select: PURCHASE_ORDER_LINE_SUMMARY_SELECT,
  },
} as const satisfies Prisma.PurchaseOrderSelect

// 待入仓按货件事实判断；部分发货且已发子集均已入仓的采购单不再计入此待办。
const AWAITING_WAREHOUSE_WHERE = {
  orderStatus: 'CONFIRMED', parts: { some: { status: 'ACTIVE', shippedAt: { not: null }, warehouseReceivedAt: null } },
} as const satisfies Prisma.PurchaseOrderWhereInput

const PURCHASE_ORDER_DETAIL_SELECT = {
  ...PURCHASE_ORDER_LIST_SELECT,
  salesOrder: {
    select: {
      id: true,
      orderNo: true,
      customerName: true,
      issuer: { select: { profile: { select: { issuerPrefix: true } } } },
    },
  },
  parts: {
    orderBy: { partNumber: 'asc' },
    select: {
      id: true, shipmentNo: true, partNumber: true, status: true, shippingMarkText: true,
      shippedAt: true, shippedById: true, shipmentRecordedAt: true, shipmentRemark: true, trackingNo: true, destinationWarehouseValue: true,
      shippedBy: { select: PERSON_REFERENCE_SELECT },
      warehouseReceivedAt: true, warehouseReceivedById: true, warehouseRecordedAt: true, warehouseRemark: true,
      warehouseReceivedBy: { select: PERSON_REFERENCE_SELECT },

      items: { orderBy: { line: { lineNumber: 'asc' } }, select: {
        purchaseOrderLineId: true, quantity: true, line: { select: { lineNumber: true } },
      } },
    },
  },
  lineSubtotalAmount: true,
  lines: {
    orderBy: [{ lineNumber: 'asc' as const }, { id: 'asc' as const }],
    select: {
      ...PURCHASE_ORDER_LINE_SUMMARY_SELECT,
      lineNumber: true,
      sourceSalesOrderLineId: true,
      productNoSnapshot: true,
      productAttributesSnapshot: true,
      descriptionSnapshot: true,
      referencePurchaseUnitPriceAmount: true,
      actualPurchaseUnitPriceAmount: true,
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
      createdBy: { select: PERSON_REFERENCE_SELECT },
      voidedBy: { select: PERSON_REFERENCE_SELECT },
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
      createdBy: { select: PERSON_REFERENCE_SELECT },
      detachedBy: { select: PERSON_REFERENCE_SELECT },
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
      changedBy: { select: PERSON_REFERENCE_SELECT },
    },
  },
  amountRevisions: {
    orderBy: [{ changedAt: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true, reason: true, changedAt: true,
      oldLineSubtotalAmount: true, oldPurchaseTotalAmount: true,
      oldDepositDueAmount: true, oldBalanceDueAmount: true,
      newLineSubtotalAmount: true, newPurchaseTotalAmount: true,
      newDepositDueAmount: true, newBalanceDueAmount: true,
      changedBy: { select: PERSON_REFERENCE_SELECT },
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
  readonly reviewView?: PurchaseOrderReviewView
  readonly fulfillmentStatus?: PurchaseOrderFulfillmentStatus
  readonly paymentStatus?: PurchaseOrderPaymentStatus
  readonly pendingTask?: PurchaseOrderPendingTask
  readonly orderDateFrom?: string
  readonly orderDateTo?: string
}

export interface PurchaseOrderSupplier {
  readonly source: 'DICTIONARY' | 'CUSTOM_TEXT'
  readonly value: string | null
  readonly label: string
  readonly tone: string | null
  readonly known: boolean | null
  readonly effectiveEnabled: boolean | null
}

export interface PurchaseOrderReviewSummary {
  readonly decision: 'APPROVED' | 'REJECTED'
  readonly reviewedAt: string
  readonly reviewedBy: PersonReference
  readonly reason: string | null
}

export interface PurchaseOrderRejection {
  readonly rejectedAt: string
  readonly rejectedBy: PersonReference
  readonly reason: string
}

export interface PurchaseOrderListItem extends PurchaseOrderRecordSummaries {
  readonly reviewSummary: PurchaseOrderReviewSummary | null
  readonly rejection: PurchaseOrderRejection | null
  readonly id: string
  readonly orderNo: string
  readonly purchaseType: PurchaseOrderType
  readonly productMode: PurchaseOrderProductMode
  readonly salesOrderNo: string | null
  readonly customerName: string | null
  readonly supplier: PurchaseOrderSupplier
  readonly createdBy: PersonReference
  readonly lineSummary: {
    readonly lineCount: number
    readonly totalQuantity: number
    readonly previews: readonly {
      readonly lineId: string
      readonly productName: string
      readonly mainImage: {
        readonly id: string
        readonly contentUrl: string
      } | null
    }[]
  }
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
  readonly shippingMarkText: string | null
  readonly shippingMarks: readonly string[]
  readonly partCount: number
  readonly shippedPartCount: number
  readonly pendingPartCount: number
  readonly warehouseReceivedPartCount: number
  readonly pendingWarehousePartCount: number
  readonly remark: string | null
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PurchaseOrderPage {
  readonly items: readonly PurchaseOrderListItem[]
  readonly summariesByCurrency: readonly PurchaseOrderCurrencySummary[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface PurchaseOrderCurrencySummary {
  readonly currencyCode: 'CNY'
  readonly orderCount: number
  readonly referenceSubtotalAmount: string
  readonly purchaseTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
  readonly paidAmount: string
  readonly outstandingAmount: string
}

export type PurchaseOrderStatusCountValue =
  | 'ALL'
  | 'REJECTED'
  | PurchaseOrderStatus
  | PurchaseOrderPendingTask

export type PurchaseOrderStatusCountsQueryInput = Omit<
  PurchaseOrderListQueryInput,
  'orderStatus' | 'page' | 'pageSize' | 'pendingTask' | 'reviewView'
>

export interface PurchaseOrderStatusCounts {
  readonly view: 'all' | 'pending'
  readonly items: readonly {
    readonly value: PurchaseOrderStatusCountValue
    readonly count: number
  }[]
}

export interface PurchaseOrderDetail extends PurchaseOrderListItem {
  readonly paymentRecipientProfile: PaymentRecipientProfileDto | null
  readonly parts: readonly {
    readonly id: string
    readonly shipmentNo: string | null
    readonly partNumber: number
    readonly status: 'PENDING_REVIEW' | 'ACTIVE' | 'CANCELLED'
    readonly shippingMarkText: string | null
    readonly shippedAt: string | null
    readonly shippedById: string | null
    readonly shipmentRecordedAt: string | null
    readonly shipmentRemark: string | null
    readonly trackingNo: string | null
    readonly destinationWarehouseValue: string | null
    readonly shippedBy: PersonReference | null
    readonly warehouseReceivedAt: string | null
    readonly warehouseReceivedById: string | null
    readonly warehouseRecordedAt: string | null
    readonly warehouseRemark: string | null
    readonly warehouseReceivedBy: PersonReference | null
    readonly items: readonly { readonly purchaseOrderLineId: string, readonly lineNumber: number, readonly quantity: number }[]
  }[]
  readonly sourceSalesOrder: {
    readonly id: string
    readonly orderNo: string
    readonly customerName: string
    readonly issuerPrefix: string | null
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
  readonly lines: readonly Record<string, unknown>[]
  readonly payments: readonly Record<string, unknown>[]
  readonly documents: readonly Record<string, unknown>[]
  readonly statusHistory: readonly Record<string, unknown>[]
  readonly amountRevisions: readonly Record<string, unknown>[]
}

function decimalToFixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
}

function decimalToFixed2(value: { toFixed(decimalPlaces: number): string }): string {
  return formatPurchaseOrderAmountUnits(parsePurchaseOrderAmountUnits(value.toFixed(4)))
}

export function purchaseOrderSupplierFromSources(
  sources: {
    readonly supplierValue: string | null
    readonly customSupplierName: string | null
  },
  resolution: StoredDictionaryValueResolution | undefined,
): PurchaseOrderSupplier {
  const value = sources.supplierValue
  if (value === null) {
    return {
      source: 'CUSTOM_TEXT',
      value: null,
      // 数据库互斥约束保证名称存在；兜底仅防止损坏的历史数据令读取接口崩溃。
      label: sources.customSupplierName ?? '—',
      tone: null,
      known: null,
      effectiveEnabled: null,
    }
  }
  if (resolution?.known === true) {
    return {
      source: 'DICTIONARY',
      value,
      label: resolution.label,
      tone: resolution.tone,
      known: true,
      effectiveEnabled: resolution.effectiveEnabled,
    }
  }
  return {
    source: 'DICTIONARY',
    value,
    label: value,
    tone: 'DEFAULT',
    known: false,
    effectiveEnabled: false,
  }
}

function actor(value: PersonReferenceRow | null) {
  return toNullablePersonReference(value)
}

function paidUnits(value: { toFixed(decimalPlaces: number): string } | null): bigint {
  return value === null ? 0n : parsePurchaseOrderAmountUnits(decimalToFixed4(value))
}

function mapCurrencySummary(
  orderAggregate: {
    readonly _count: { readonly _all: number }
    readonly _sum: {
      readonly purchaseTotalAmount: {
        toFixed(decimalPlaces: number): string
      } | null
      readonly depositDueAmount: {
        toFixed(decimalPlaces: number): string
      } | null
      readonly balanceDueAmount: {
        toFixed(decimalPlaces: number): string
      } | null
    }
  },
  referenceSubtotalAmountValue: string,
  paymentAggregate: {
    readonly _sum: {
      readonly amount: { toFixed(decimalPlaces: number): string } | null
    }
  },
): PurchaseOrderCurrencySummary | null {
  if (orderAggregate._count._all === 0) return null
  const purchaseTotalUnits = paidUnits(orderAggregate._sum.purchaseTotalAmount)
  const activePaidUnits = paidUnits(paymentAggregate._sum.amount)
  return {
    currencyCode: 'CNY',
    orderCount: orderAggregate._count._all,
    referenceSubtotalAmount: referenceSubtotalAmountValue,
    purchaseTotalAmount: formatPurchaseOrderAmountUnits(purchaseTotalUnits),
    depositDueAmount: formatPurchaseOrderAmountUnits(
      paidUnits(orderAggregate._sum.depositDueAmount),
    ),
    balanceDueAmount: formatPurchaseOrderAmountUnits(
      paidUnits(orderAggregate._sum.balanceDueAmount),
    ),
    paidAmount: formatPurchaseOrderAmountUnits(activePaidUnits),
    outstandingAmount: formatPurchaseOrderAmountUnits(
      purchaseTotalUnits - activePaidUnits,
    ),
  }
}

/**
 * 列表与状态计数共享非工具栏筛选语义。订单状态与待办任务由调用方单独叠加，
 * 防止当前选中的工具栏分类反向污染其他分类的计数。
 */
function buildPurchaseOrderBaseWhere(
  input: Omit<
    PurchaseOrderListQueryInput,
    'orderStatus' | 'page' | 'pageSize' | 'pendingTask' | 'reviewView' | 'view'
  >,
): Prisma.PurchaseOrderWhereInput {
  const keyword = input.keyword?.trim().normalize('NFKC')
  return {
    fulfillmentStatus: input.fulfillmentStatus,
    paymentStatus: input.paymentStatus,
    purchaseType: input.purchaseType,
    supplierValue: input.supplierValue,
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
          { shippingMarkText: { contains: keyword, mode: 'insensitive' } },
          { parts: { some: { shippingMarkText: { contains: keyword, mode: 'insensitive' } } } },
          { customSupplierName: { contains: keyword, mode: 'insensitive' } },
        ] }),
  }
}

function groupedCount<T extends string>(
  rows: readonly { readonly value: string, readonly count: number }[],
  values: readonly T[],
): ReadonlyMap<T, number> {
  const countByValue = new Map(rows.map(row => [row.value, row.count] as const))
  return new Map(values.map(value => [value, countByValue.get(value) ?? 0] as const))
}

function mapLineSummary(
  row: PurchaseOrderListRow,
): PurchaseOrderListItem['lineSummary'] {
  return {
    lineCount: row.lines.length,
    totalQuantity: row.lines.reduce((sum, line) => sum + line.quantity, 0),
    // 返回完整 preview，由 ImageGroup 依据真实有图项计算折叠数量；服务端不能预先截断。
    previews: row.lines.map((line) => {
      const mainImage = line.product?.media[0]
      return {
        lineId: line.id,
        productName: line.productNameSnapshot,
        mainImage: line.productId === null || mainImage === undefined
          ? null
          : {
              id: mainImage.id,
              contentUrl:
                `/api/purchase-orders/${row.id}/lines/${line.id}/main-image/${mainImage.id}/content`,
            },
      }
    }),
  }
}

function mapReviewSummary(history: {
  readonly changedAt: Date
  readonly changedBy: PersonReferenceRow
  readonly reason: string | null
} | undefined): PurchaseOrderReviewSummary | null {
  return history === undefined ? null : {
    decision: 'APPROVED',
    reviewedAt: history.changedAt.toISOString(),
    reviewedBy: toPersonReference(history.changedBy),
    reason: history.reason,
  }
}

function mapRejection(row: {
  readonly rejectedAt: Date | null | undefined
  readonly rejectedBy: PersonReferenceRow | null | undefined
  readonly rejectionReason: string | null | undefined
}): PurchaseOrderRejection | null {
  if (row.rejectedAt === null || row.rejectedAt === undefined
    || row.rejectedBy === null || row.rejectedBy === undefined
    || row.rejectionReason === null || row.rejectionReason === undefined) return null
  return {
    rejectedAt: row.rejectedAt.toISOString(),
    rejectedBy: toPersonReference(row.rejectedBy),
    reason: row.rejectionReason,
  }
}

function mapListItem(
  row: PurchaseOrderListRow,
  supplier: PurchaseOrderSupplier,
  approvedReviewSummary: PurchaseOrderReviewSummary | null,
): PurchaseOrderListItem {
  const rejection = mapRejection(row)
  const reviewSummary = rejection === null
    ? approvedReviewSummary
    : {
        decision: 'REJECTED' as const,
        reviewedAt: rejection.rejectedAt,
        reviewedBy: rejection.rejectedBy,
        reason: rejection.reason,
      }
  const records = summarizePurchaseOrderRecords(row)
  const activePaidUnits = parsePurchaseOrderAmountUnits(records.paidAmount)
  const totalUnits = parsePurchaseOrderAmountUnits(
    decimalToFixed2(row.purchaseTotalAmount),
  )
  return {
    ...records,
    reviewSummary,
    rejection,
    id: row.id,
    orderNo: row.orderNo,
    purchaseType: row.purchaseType,
    productMode: row.productMode,
    salesOrderNo: row.salesOrder?.orderNo ?? null,
    customerName: row.salesOrder?.customerName ?? null,
    supplier,
    createdBy: toPersonReference(row.createdBy),
    lineSummary: mapLineSummary(row),
    partCount: row._count.parts,
    shippedPartCount: row.parts.filter(part => part.shippedAt != null).length,
    pendingPartCount: row.parts.filter(part => part.status === 'ACTIVE' && part.shippedAt == null).length,
    warehouseReceivedPartCount: row.parts.filter(part => part.status === 'ACTIVE' && part.warehouseReceivedAt != null).length,
    pendingWarehousePartCount: row.parts.filter(part => part.status === 'ACTIVE' && part.shippedAt != null && part.warehouseReceivedAt == null).length,
    orderDate: row.orderDate.toISOString().slice(0, 10),
    currencyCode: row.currencyCode,
    purchaseTotalAmount: formatPurchaseOrderAmountUnits(totalUnits),
    depositDueAmount: decimalToFixed2(row.depositDueAmount),
    balanceDueAmount: decimalToFixed2(row.balanceDueAmount),
    paidAmount: formatPurchaseOrderAmountUnits(activePaidUnits),
    outstandingAmount: formatPurchaseOrderAmountUnits(totalUnits - activePaidUnits),
    orderStatus: row.orderStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    paymentStatus: row.paymentStatus,
    shippingMarkText: row.shippingMarkText,
    shippingMarks: row.parts.flatMap(part => part.shippingMarkText === null ? [] : [part.shippingMarkText]),
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
    private readonly recipients: PaymentRecipientService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  /**
   * 参考价小计在数据库内求和，避免把过滤集全部采购明细读入 Node。
   * 采购买卖历史保留四位精度，分块执行防止大规模筛选生成超长 SQL。
   */
  private async sumReferenceSubtotal(
    client: Prisma.TransactionClient,
    where: Prisma.PurchaseOrderWhereInput,
  ): Promise<string> {
    const orders = await client.purchaseOrder.findMany({
      where,
      select: { id: true },
    })
    if (orders.length === 0) {
      return '0.0000'
    }

    let totalUnits = 0n
    for (let offset = 0; offset < orders.length; offset += 500) {
      const ids = orders
        .slice(offset, offset + 500)
        .map(row => row.id)
      const rows = await client.$queryRaw<Array<{
        total: { toFixed: (decimalPlaces: number) => string } | null
      }>>(Prisma.sql`
        SELECT COALESCE(SUM(line."quantity"::numeric * line."reference_purchase_unit_price_amount"), 0) AS "total"
        FROM "purchase_order_lines" AS line
        WHERE line."purchase_order_id" IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
      `)
      const [integer, fraction] = normalizePurchaseOrderSnapshotAmount(
        rows[0]?.total?.toFixed(4) ?? '0.0000',
      ).split('.')
      totalUnits += BigInt(integer) * 10_000n + BigInt(fraction)
    }
    return normalizePurchaseOrderSnapshotAmount(
      `${totalUnits / 10_000n}.${(totalUnits % 10_000n).toString().padStart(4, '0')}`,
    )
  }

  async list(
    input: PurchaseOrderListQueryInput,
    actorUserId: string = resolveDataScopeActor(),
  ): Promise<PurchaseOrderPage> {
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const scope = await this.dataScope.resolve(actorUserId)
    // 待办任务允许交叉归类，因此直接由当前任务生成服务端谓词，而不在页面合并结果。
    const taskClauseByType: Readonly<Record<
      PurchaseOrderPendingTask,
      Prisma.PurchaseOrderWhereInput
    >> = {
      AWAITING_REVIEW: { orderStatus: 'PENDING_REVIEW' },
      AWAITING_PAYMENT: {
        orderStatus: 'CONFIRMED',
        paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
      },
      AWAITING_SHIPMENT: {
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: { in: ['ORDERED', 'PREPARING', 'PARTIALLY_SHIPPED'] },
      },
      AWAITING_WAREHOUSE: AWAITING_WAREHOUSE_WHERE,
    }
    const pendingClause: Prisma.PurchaseOrderWhereInput | undefined =
      input.view !== 'pending'
        ? undefined
        : input.pendingTask === undefined
          ? { OR: [
              { orderStatus: 'PENDING_REVIEW' },
              { orderStatus: 'CONFIRMED', OR: [
                { fulfillmentStatus: { not: 'SIGNED' } },
                { paymentStatus: { not: 'PAID' } },
              ] },
            ] }
          : taskClauseByType[input.pendingTask]
    // 审核分类由服务端生成，与显式状态及待办条件取交集，避免组合筛选扩大结果范围。
    const reviewClause: Prisma.PurchaseOrderWhereInput | undefined =
      input.reviewView === undefined
        ? undefined
        : input.reviewView === 'APPROVED'
          ? { orderStatus: { in: ['CONFIRMED', 'COMPLETED'] } }
          : input.reviewView === 'REJECTED'
            ? { orderStatus: 'CANCELLED', rejectedAt: { not: null } }
            : input.reviewView === 'CANCELLED'
              ? { orderStatus: 'CANCELLED', rejectedAt: null }
              : { orderStatus: input.reviewView }
    const where: Prisma.PurchaseOrderWhereInput = {
      ...buildPurchaseOrderBaseWhere(input),
      // 数据范围与筛选共用同一谓词，保证总数、当前页与金额汇总口径一致。
      ...purchaseOrderScopeWhere(scope, actorUserId),
      orderStatus: input.orderStatus,
      AND: [pendingClause, reviewClause].filter(
        (value): value is Prisma.PurchaseOrderWhereInput => value !== undefined,
      ),
    }
    // 列表数量、当前页与金额汇总必须共享同一份筛选谓词，并在一个事务快照内读取，
    // 显式使用 RepeatableRead，避免默认 ReadCommitted 下并发付款或订单变更
    // 令“共 N 张”、分类付款与金额矩阵读到不同快照而出现瞬时错位。
    const [total, rows, orderAggregate, referenceSubtotalAmount, paymentAggregate, reviewByOrderId]
      = await this.prisma.$transaction(async transaction => {
        const [total, rows, orderAggregate, referenceSubtotalAmount, paymentAggregate] = await Promise.all([
          transaction.purchaseOrder.count({ where }),
          transaction.purchaseOrder.findMany({
            where,
            orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: PURCHASE_ORDER_LIST_SELECT,
          }),
          transaction.purchaseOrder.aggregate({
            where,
            _count: { _all: true },
            _sum: {
              purchaseTotalAmount: true,
              depositDueAmount: true,
              balanceDueAmount: true,
            },
          }),
          this.sumReferenceSubtotal(transaction, where),
          transaction.purchaseOrderPayment.aggregate({
            where: {
              voidedAt: null,
              purchaseOrder: { is: where },
            },
            _sum: { amount: true },
          }),
        ])
        // 最新变更与审核事实是两种记录：保留原 take:1 摘要，仅批量查询当前页的
        // 精确审核转换；同一事务快照防止列表状态与审核结果读到不同时间点。
        const reviewHistory = rows.length === 0 ? [] : await transaction.purchaseOrderStatusHistory.findMany({
          where: {
            purchaseOrderId: { in: rows.map(row => row.id) },
            dimension: 'ORDER', fromStatus: 'PENDING_REVIEW', toStatus: 'CONFIRMED',
          },
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
          distinct: ['purchaseOrderId'],
          select: {
            purchaseOrderId: true, changedAt: true, reason: true,
            changedBy: { select: PERSON_REFERENCE_SELECT },
          },
        })
        return [total, rows, orderAggregate, referenceSubtotalAmount, paymentAggregate,
          new Map(reviewHistory.map(history => [history.purchaseOrderId, mapReviewSummary(history)])),
        ] as const
      }, { isolationLevel: 'RepeatableRead' })
    const dictionarySupplierRows = rows.filter(
      (row): row is typeof row & { readonly supplierValue: string } =>
        row.supplierValue !== null,
    )
    const supplierResolutions = await this.dictionaryLookup.resolveStoredValues({
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      values: dictionarySupplierRows.map(row => row.supplierValue),
    })
    const supplierByOrderId = new Map(dictionarySupplierRows.map((row, index) => [
      row.id,
      purchaseOrderSupplierFromSources(row, supplierResolutions[index]),
    ]))
    const currencySummary = mapCurrencySummary(
      orderAggregate,
      referenceSubtotalAmount,
      paymentAggregate,
    )
    return {
      items: rows.map(row => mapListItem(
        row,
        supplierByOrderId.get(row.id) ?? purchaseOrderSupplierFromSources(row, undefined),
        reviewByOrderId.get(row.id) ?? null,
      )),
      summariesByCurrency: currencySummary === null ? [] : [currencySummary],
      page,
      pageSize,
      total,
    }
  }

  async statusCounts(
    input: PurchaseOrderStatusCountsQueryInput,
    actorUserId: string = resolveDataScopeActor(),
  ): Promise<PurchaseOrderStatusCounts> {
    const scope = await this.dataScope.resolve(actorUserId)
    const baseWhere: Prisma.PurchaseOrderWhereInput = {
      ...buildPurchaseOrderBaseWhere(input),
      ...purchaseOrderScopeWhere(scope, actorUserId),
    }

    if (input.view === 'all') {
      const statuses = ['PENDING_REVIEW', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const
      const [rows, rejectedCount] = await Promise.all([
        this.prisma.purchaseOrder.groupBy({
          by: ['orderStatus'] as const,
          where: baseWhere,
          _count: { _all: true } as const,
        }),
        this.prisma.purchaseOrder.count({
          where: {
            AND: [baseWhere, { orderStatus: 'CANCELLED', rejectedAt: { not: null } }],
          },
        }),
      ])
      const counts = groupedCount(rows.map(row => ({
        value: row.orderStatus,
        count: row._count._all,
      })), statuses)
      const items = statuses.map(value => ({ value, count: counts.get(value) ?? 0 }))
      return {
        view: 'all',
        items: [
          { value: 'ALL', count: items.reduce((sum, item) => sum + item.count, 0) },
          ...items,
          // 已驳回是 CANCELLED 的派生过滤，单独计数供审核工作台页签使用；
          // ALL 仍只累加真实订单状态，避免重复计数。
          { value: 'REJECTED', count: rejectedCount },
        ],
      }
    }

    const pendingBaseWhere: Prisma.PurchaseOrderWhereInput = {
      AND: [baseWhere, { orderStatus: 'CONFIRMED' }],
    }
    const { reviewCount, warehouseCount, fulfillmentRows, paymentRows } = await this.prisma.$transaction(
      async (transaction) => {
        // 审核中仍属待办，但必须与可发货、可付款的已确认订单分开统计。
        const reviewCount = await transaction.purchaseOrder.count({
          where: { AND: [baseWhere, { orderStatus: 'PENDING_REVIEW' }] },
        })
        const warehouseCount = await transaction.purchaseOrder.count({
          where: { AND: [baseWhere, AWAITING_WAREHOUSE_WHERE] },
        })
        const fulfillmentRows = await transaction.purchaseOrder.groupBy({
          by: ['fulfillmentStatus'],
          where: pendingBaseWhere,
          _count: { _all: true },
        })
        const paymentRows = await transaction.purchaseOrder.groupBy({
          by: ['paymentStatus'],
          where: pendingBaseWhere,
          _count: { _all: true },
        })
        return { reviewCount, warehouseCount, fulfillmentRows, paymentRows }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
    const fulfillmentStatuses = ['ORDERED', 'PREPARING', 'PARTIALLY_SHIPPED', 'SHIPPED'] as const
    const fulfillmentCounts = groupedCount(
      fulfillmentRows.map(row => ({
        value: row.fulfillmentStatus,
        count: row._count._all,
      })),
      fulfillmentStatuses,
    )
    const paymentStatuses = ['UNPAID', 'PARTIALLY_PAID'] as const
    const paymentCounts = groupedCount(
      paymentRows.map(row => ({
        value: row.paymentStatus,
        count: row._count._all,
      })),
      paymentStatuses,
    )

    return {
      view: 'pending',
      items: [{
        value: 'AWAITING_REVIEW',
        count: reviewCount,
      }, {
        value: 'AWAITING_SHIPMENT',
        count: (fulfillmentCounts.get('ORDERED') ?? 0)
          + (fulfillmentCounts.get('PREPARING') ?? 0)
          + (fulfillmentCounts.get('PARTIALLY_SHIPPED') ?? 0),
      }, {
        value: 'AWAITING_WAREHOUSE',
        count: warehouseCount,
      }, {
        value: 'AWAITING_PAYMENT',
        count: paymentStatuses.reduce(
          (sum, value) => sum + (paymentCounts.get(value) ?? 0),
          0,
        ),
      }],
    }
  }

  async getById(
    purchaseOrderId: string,
    actorUserId: string = resolveDataScopeActor(),
    transaction?: Prisma.TransactionClient,
  ): Promise<PurchaseOrderDetail> {
    const scope = transaction === undefined
      ? await this.dataScope.resolve(actorUserId)
      : await this.dataScope.resolveInTransaction(transaction, actorUserId)
    const row = await (transaction ?? this.prisma).purchaseOrder.findFirst({
      // 不可见资源与不存在统一返回既有 404，避免数据范围探测。
      where: { id: purchaseOrderId, ...purchaseOrderScopeWhere(scope, actorUserId) },
      select: PURCHASE_ORDER_DETAIL_SELECT,
    })
    if (row === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'PURCHASE_ORDER_NOT_FOUND',
        '采购订单不存在',
      )
    }
    const resolution = row.supplierValue === null
      ? undefined
      : await (transaction
          ? this.dictionaryLookup.resolveStoredValueInTransaction(transaction, {
              dictionaryCode: SUPPLIER_DICTIONARY_CODE, value: row.supplierValue,
            })
          : this.dictionaryLookup.resolveStoredValue({
          dictionaryCode: SUPPLIER_DICTIONARY_CODE,
          value: row.supplierValue,
        }))
    const summary = mapListItem(
      row,
      purchaseOrderSupplierFromSources(row, resolution),
      mapReviewSummary(row.statusHistory.find(history => history.dimension === 'ORDER'
        && history.fromStatus === 'PENDING_REVIEW' && history.toStatus === 'CONFIRMED')),
    )
    const activePaidUnits = parsePurchaseOrderAmountUnits(summary.paidAmount)
    const totalUnits = parsePurchaseOrderAmountUnits(
      decimalToFixed2(row.purchaseTotalAmount),
    )
    return {
      ...summary,
      paymentRecipientProfile: await this.recipients.getForOrder(transaction ?? this.prisma, row),
      sourceSalesOrder: row.salesOrder === null ? null : {
        id: row.salesOrder.id,
        orderNo: row.salesOrder.orderNo,
        customerName: row.salesOrder.customerName,
        issuerPrefix: row.salesOrder.issuer.profile?.issuerPrefix ?? null,
      },
      parts: row.parts.map(part => ({
        id: part.id, shipmentNo: part.shipmentNo, partNumber: part.partNumber, status: part.status, shippingMarkText: part.shippingMarkText,
        shippedAt: part.shippedAt?.toISOString() ?? null,
        shippedById: part.shippedById ?? null,
        shipmentRecordedAt: part.shipmentRecordedAt?.toISOString() ?? null,
        shipmentRemark: part.shipmentRemark ?? null,
        trackingNo: part.trackingNo ?? null,
        destinationWarehouseValue: part.destinationWarehouseValue ?? null,
        shippedBy: toNullablePersonReference(part.shippedBy),
        warehouseReceivedAt: part.warehouseReceivedAt?.toISOString() ?? null,
        warehouseReceivedById: part.warehouseReceivedById ?? null,
        warehouseRecordedAt: part.warehouseRecordedAt?.toISOString() ?? null,
        warehouseRemark: part.warehouseRemark ?? null,
        warehouseReceivedBy: toNullablePersonReference(part.warehouseReceivedBy),

        items: part.items.map(item => ({
          purchaseOrderLineId: item.purchaseOrderLineId, lineNumber: item.line.lineNumber, quantity: item.quantity,
        })),
      })),
      shippingMarkText: row.shippingMarkText,
      amounts: {
        lineSubtotalAmount: decimalToFixed2(row.lineSubtotalAmount),
        purchaseTotalAmount: formatPurchaseOrderAmountUnits(totalUnits),
        depositDueAmount: decimalToFixed2(row.depositDueAmount),
        balanceDueAmount: decimalToFixed2(row.balanceDueAmount),
        paidAmount: formatPurchaseOrderAmountUnits(activePaidUnits),
        outstandingAmount: formatPurchaseOrderAmountUnits(
          totalUnits - activePaidUnits,
        ),
      },
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
        actualPurchaseUnitPriceAmount: decimalToFixed2(
          line.actualPurchaseUnitPriceAmount,
        ),
        quantity: line.quantity,
        lineTotalAmount: decimalToFixed2(line.lineTotalAmount),
      })),
      payments: row.payments.map(payment => ({
        id: payment.id,
        paymentType: payment.paymentType,
        amount: decimalToFixed2(payment.amount),
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
      // 金额快照只读取已存储事实；付款录入不生成约定金额修订，也不拼接推测历史。
      amountRevisions: row.amountRevisions.map(revision => ({
        id: revision.id,
        oldLineSubtotalAmount: decimalToFixed4(revision.oldLineSubtotalAmount),
        oldPurchaseTotalAmount: decimalToFixed4(revision.oldPurchaseTotalAmount),
        oldDepositDueAmount: decimalToFixed4(revision.oldDepositDueAmount),
        oldBalanceDueAmount: decimalToFixed4(revision.oldBalanceDueAmount),
        newLineSubtotalAmount: decimalToFixed4(revision.newLineSubtotalAmount),
        newPurchaseTotalAmount: decimalToFixed4(revision.newPurchaseTotalAmount),
        newDepositDueAmount: decimalToFixed4(revision.newDepositDueAmount),
        newBalanceDueAmount: decimalToFixed4(revision.newBalanceDueAmount),
        reason: revision.reason,
        changedBy: actor(revision.changedBy),
        changedAt: revision.changedAt.toISOString(),
      })),
    }
  }
}
