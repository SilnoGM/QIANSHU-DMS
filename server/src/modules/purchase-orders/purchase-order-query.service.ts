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
  _count: { select: { payments: true, statusHistory: true, amountRevisions: true } },
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
  shippingMarkText: true,
  parts: { orderBy: { partNumber: 'asc' }, select: { shippingMarkText: true } },
  remark: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, displayName: true } },
  salesOrder: {
    select: { id: true, orderNo: true, customerName: true },
  },
  lines: {
    orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
    select: PURCHASE_ORDER_LINE_SUMMARY_SELECT,
  },
} as const satisfies Prisma.PurchaseOrderSelect

const PURCHASE_ORDER_DETAIL_SELECT = {
  ...PURCHASE_ORDER_LIST_SELECT,
  parts: {
    orderBy: { partNumber: 'asc' },
    select: {
      id: true, partNumber: true, shippingMarkText: true,
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
  amountRevisions: {
    orderBy: [{ changedAt: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true, reason: true, changedAt: true,
      oldLineSubtotalAmount: true, oldPurchaseTotalAmount: true,
      oldDepositDueAmount: true, oldBalanceDueAmount: true,
      newLineSubtotalAmount: true, newPurchaseTotalAmount: true,
      newDepositDueAmount: true, newBalanceDueAmount: true,
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
  readonly source: 'DICTIONARY' | 'CUSTOM_TEXT'
  readonly value: string | null
  readonly label: string
  readonly tone: string | null
  readonly known: boolean | null
  readonly effectiveEnabled: boolean | null
}

export interface PurchaseOrderListItem extends PurchaseOrderRecordSummaries {
  readonly id: string
  readonly orderNo: string
  readonly purchaseType: PurchaseOrderType
  readonly productMode: PurchaseOrderProductMode
  readonly salesOrderNo: string | null
  readonly customerName: string | null
  readonly supplier: PurchaseOrderSupplier
  readonly createdBy: { readonly id: string, readonly displayName: string }
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
  | PurchaseOrderStatus
  | PurchaseOrderPendingTask

export type PurchaseOrderStatusCountsQueryInput = Omit<
  PurchaseOrderListQueryInput,
  'orderStatus' | 'page' | 'pageSize' | 'pendingTask'
>

export interface PurchaseOrderStatusCounts {
  readonly view: 'all' | 'pending'
  readonly items: readonly {
    readonly value: PurchaseOrderStatusCountValue
    readonly count: number
  }[]
}

export interface PurchaseOrderDetail extends PurchaseOrderListItem {
  readonly parts: readonly {
    readonly id: string
    readonly partNumber: number
    readonly shippingMarkText: string
    readonly items: readonly { readonly purchaseOrderLineId: string, readonly lineNumber: number, readonly quantity: number }[]
  }[]
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
  readonly lines: readonly Record<string, unknown>[]
  readonly payments: readonly Record<string, unknown>[]
  readonly documents: readonly Record<string, unknown>[]
  readonly statusHistory: readonly Record<string, unknown>[]
  readonly amountRevisions: readonly Record<string, unknown>[]
}

function decimalToFixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
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

function actor(value: { readonly id: string, readonly displayName: string } | null) {
  return value === null ? null : { id: value.id, displayName: value.displayName }
}

function paidUnits(value: { toFixed(decimalPlaces: number): string } | null): bigint {
  return value === null ? 0n : parsePurchaseOrderAmountUnits(decimalToFixed4(value))
}

function referenceSubtotalUnits(lines: readonly {
  readonly quantity: number
  readonly referencePurchaseUnitPriceAmount: {
    toFixed(decimalPlaces: number): string
  }
}[]): bigint {
  return lines.reduce(
    (sum, line) => sum + parsePurchaseOrderAmountUnits(
      decimalToFixed4(line.referencePurchaseUnitPriceAmount),
    ) * BigInt(line.quantity),
    0n,
  )
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
  referencePriceLines: readonly {
    readonly quantity: number
    readonly referencePurchaseUnitPriceAmount: {
      toFixed(decimalPlaces: number): string
    }
  }[],
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
    referenceSubtotalAmount: formatPurchaseOrderAmountUnits(
      referenceSubtotalUnits(referencePriceLines),
    ),
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
    'orderStatus' | 'page' | 'pageSize' | 'pendingTask' | 'view'
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

function mapListItem(
  row: PurchaseOrderListRow,
  supplier: PurchaseOrderSupplier,
): PurchaseOrderListItem {
  const records = summarizePurchaseOrderRecords(row)
  const activePaidUnits = parsePurchaseOrderAmountUnits(records.paidAmount)
  const totalUnits = parsePurchaseOrderAmountUnits(
    decimalToFixed4(row.purchaseTotalAmount),
  )
  return {
    ...records,
    id: row.id,
    orderNo: row.orderNo,
    purchaseType: row.purchaseType,
    productMode: row.productMode,
    salesOrderNo: row.salesOrder?.orderNo ?? null,
    customerName: row.salesOrder?.customerName ?? null,
    supplier,
    createdBy: row.createdBy,
    lineSummary: mapLineSummary(row),
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
    shippingMarkText: row.shippingMarkText,
    shippingMarks: row.parts.map(part => part.shippingMarkText),
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
        fulfillmentStatus: { in: ['ORDERED', 'PREPARING'] },
      },
      AWAITING_WAREHOUSE: { orderStatus: 'CONFIRMED', fulfillmentStatus: 'SHIPPED' },
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
    const where: Prisma.PurchaseOrderWhereInput = {
      ...buildPurchaseOrderBaseWhere(input),
      orderStatus: input.orderStatus,
      AND: [pendingClause].filter(
        (value): value is Prisma.PurchaseOrderWhereInput => value !== undefined,
      ),
    }
    // 列表数量、当前页与金额汇总必须共享同一份筛选谓词，并在一个事务快照内读取，
    // 显式使用 RepeatableRead，避免默认 ReadCommitted 下并发付款或订单变更
    // 令“共 N 张”、分类付款与金额矩阵读到不同快照而出现瞬时错位。
    const [
      total,
      rows,
      orderAggregate,
      referencePriceLines,
      paymentAggregate,
    ] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: PURCHASE_ORDER_LIST_SELECT,
      }),
      this.prisma.purchaseOrder.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          purchaseTotalAmount: true,
          depositDueAmount: true,
          balanceDueAmount: true,
        },
      }),
      this.prisma.purchaseOrderLine.findMany({
        where: { purchaseOrder: { is: where } },
        select: {
          referencePurchaseUnitPriceAmount: true,
          quantity: true,
        },
      }),
      this.prisma.purchaseOrderPayment.aggregate({
        where: {
          voidedAt: null,
          purchaseOrder: { is: where },
        },
        _sum: { amount: true },
      }),
    ], { isolationLevel: 'RepeatableRead' })
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
      referencePriceLines,
      paymentAggregate,
    )
    return {
      items: rows.map(row => mapListItem(
        row,
        supplierByOrderId.get(row.id) ?? purchaseOrderSupplierFromSources(row, undefined),
      )),
      summariesByCurrency: currencySummary === null ? [] : [currencySummary],
      page,
      pageSize,
      total,
    }
  }

  async statusCounts(
    input: PurchaseOrderStatusCountsQueryInput,
  ): Promise<PurchaseOrderStatusCounts> {
    const baseWhere = buildPurchaseOrderBaseWhere(input)

    if (input.view === 'all') {
      const statuses = ['PENDING_REVIEW', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const
      const rows = await this.prisma.purchaseOrder.groupBy({
        by: ['orderStatus'] as const,
        where: baseWhere,
        _count: { _all: true } as const,
      })
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
        ],
      }
    }

    const pendingBaseWhere: Prisma.PurchaseOrderWhereInput = {
      AND: [baseWhere, { orderStatus: 'CONFIRMED' }],
    }
    const { reviewCount, fulfillmentRows, paymentRows } = await this.prisma.$transaction(
      async (transaction) => {
        // 审核中仍属待办，但必须与可发货、可付款的已确认订单分开统计。
        const reviewCount = await transaction.purchaseOrder.count({
          where: { AND: [baseWhere, { orderStatus: 'PENDING_REVIEW' }] },
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
        return { reviewCount, fulfillmentRows, paymentRows }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
    const fulfillmentStatuses = ['ORDERED', 'PREPARING', 'SHIPPED'] as const
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
          + (fulfillmentCounts.get('PREPARING') ?? 0),
      }, {
        value: 'AWAITING_WAREHOUSE',
        count: fulfillmentCounts.get('SHIPPED') ?? 0,
      }, {
        value: 'AWAITING_PAYMENT',
        count: paymentStatuses.reduce(
          (sum, value) => sum + (paymentCounts.get(value) ?? 0),
          0,
        ),
      }],
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
    const resolution = row.supplierValue === null
      ? undefined
      : await this.dictionaryLookup.resolveStoredValue({
          dictionaryCode: SUPPLIER_DICTIONARY_CODE,
          value: row.supplierValue,
        })
    const summary = mapListItem(
      row,
      purchaseOrderSupplierFromSources(row, resolution),
    )
    const activePaidUnits = parsePurchaseOrderAmountUnits(summary.paidAmount)
    const totalUnits = parsePurchaseOrderAmountUnits(
      decimalToFixed4(row.purchaseTotalAmount),
    )
    return {
      ...summary,
      sourceSalesOrder: row.salesOrder,
      parts: row.parts.map(part => ({
        id: part.id, partNumber: part.partNumber, shippingMarkText: part.shippingMarkText,
        items: part.items.map(item => ({
          purchaseOrderLineId: item.purchaseOrderLineId, lineNumber: item.line.lineNumber, quantity: item.quantity,
        })),
      })),
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
