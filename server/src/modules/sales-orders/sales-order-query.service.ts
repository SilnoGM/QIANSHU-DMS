import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import type {
  MediaType,
  SalesOrderDocumentType,
  SalesOrderFulfillmentStatus,
  SalesOrderPaymentStatus,
  SalesOrderStatus,
  UserStatus,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  formatSalesOrderAmountUnits,
  parseSalesOrderAmountUnits,
  sumSalesOrderReceivedUnits,
} from './domain/sales-order-decimal'
import {
  readSalesOrderReconciliationStates,
  resolveSalesOrderCompletionHold,
  type SalesOrderCompletionHold,
} from './domain/sales-order-reconciliation-state'
import { mapSalesOrderProductOption } from './products/sales-order-product-option.mapper'
import {
  readProductOptionCategoryFacets,
  type ProductOptionCategoryFacet,
} from '../products/product-option-category-facets'

const SALES_ORDER_DETAIL_INCLUDE = {
  issuer: { select: { id: true, displayName: true } },
  lines: { where: { removedAt: null }, orderBy: { lineNumber: 'asc' } },
  payments: {
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    include: {
      createdBy: { select: { id: true, displayName: true } },
      voidedBy: { select: { id: true, displayName: true } },
    },
  },
  documents: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      mediaAsset: {
        select: {
          id: true,
          mediaType: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
      createdBy: { select: { id: true, displayName: true } },
      detachedBy: { select: { id: true, displayName: true } },
    },
  },
  statusHistory: {
    orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    include: {
      changedBy: { select: { id: true, displayName: true } },
    },
  },
  amountRevisions: {
    orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    include: {
      changedBy: { select: { id: true, displayName: true } },
    },
  },
} satisfies Prisma.SalesOrderInclude

type SalesOrderDetailRow = Prisma.SalesOrderGetPayload<{
  include: typeof SALES_ORDER_DETAIL_INCLUDE
}>

const SALES_ORDER_DOCUMENT_PREVIEW_LIMIT = 3
const SALES_ORDER_LIST_SELECT = {
  id: true,
  orderNo: true,
  orderDate: true,
  issuer: { select: { id: true, displayName: true } },
  currencyCode: true,
  customerName: true,
  customerPhone: true,
  customerProvinceStateNameSnapshot: true,
  customerCityNameSnapshot: true,
  customerFullAddressSnapshot: true,
  lineSubtotalAmount: true,
  agreedTotalAmount: true,
  depositDueAmount: true,
  balanceDueAmount: true,
  remark: true,
  orderStatus: true,
  fulfillmentStatus: true,
  paymentStatus: true,
  // 金额汇总仍只读取有效收款；关系计数保留全部收款，确保已作废记录也进入记录总数。
  _count: {
    select: {
      payments: true,
      statusHistory: true,
      amountRevisions: true,
    },
  },
  version: true,
  createdAt: true,
  updatedAt: true,
  payments: {
    where: { voidedAt: null },
    select: { amount: true },
  },
  lines: {
    where: { removedAt: null },
    orderBy: { lineNumber: 'asc' },
    select: {
      id: true,
      lineType: true,
      productId: true,
      productNameSnapshot: true,
      standardUnitPriceAmount: true,
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
    },
  },
  documents: {
    where: { detachedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      mediaAssetId: true,
      documentType: true,
      title: true,
      mediaAsset: { select: { mediaType: true } },
    },
  },
} satisfies Prisma.SalesOrderSelect

type SalesOrderListRow = Prisma.SalesOrderGetPayload<{
  select: typeof SALES_ORDER_LIST_SELECT
}>

interface SalesOrderActor {
  readonly id: string
  readonly displayName: string
}

export interface SalesOrderDetail {
  readonly id: string
  readonly orderNo: string
  readonly orderDate: string
  readonly issuer: SalesOrderActor
  readonly currencyCode: string
  readonly customer: {
    readonly name: string
    readonly phone: string
    readonly countryRegion: { readonly id: string; readonly code: string; readonly name: string }
    readonly provinceState: { readonly id: string; readonly code: string; readonly name: string }
    readonly city: { readonly id: string; readonly code: string; readonly name: string }
    readonly addressDetail: string
    readonly fullAddress: string
  }
  readonly amounts: {
    readonly lineSubtotalAmount: string
    readonly agreedTotalAmount: string
    readonly depositDueAmount: string
    readonly balanceDueAmount: string
    readonly receivedAmount: string
    readonly outstandingAmount: string
  }
  readonly orderStatus: SalesOrderDetailRow['orderStatus']
  readonly fulfillmentStatus: SalesOrderDetailRow['fulfillmentStatus']
  readonly paymentStatus: SalesOrderDetailRow['paymentStatus']
  readonly completionHold: SalesOrderCompletionHold | null
  readonly remark: string | null
  readonly version: number
  readonly lines: readonly Record<string, unknown>[]
  readonly payments: readonly Record<string, unknown>[]
  readonly documents: readonly Record<string, unknown>[]
  readonly statusHistory: readonly Record<string, unknown>[]
  readonly amountRevisions: readonly Record<string, unknown>[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SalesOrderListQueryInput {
  readonly page?: number
  readonly pageSize?: number
  readonly keyword?: string
  readonly currencyCode?: 'TWD' | 'MYR'
  readonly issuerUserId?: string
  readonly orderStatus?: SalesOrderStatus
  readonly fulfillmentStatus?: SalesOrderFulfillmentStatus
  readonly paymentStatus?: SalesOrderPaymentStatus
  readonly orderDateFrom?: string
  readonly orderDateTo?: string
}

export type SalesOrderStatusCountValue
  = | 'ALL'
    | 'CANCELLED'
    | 'COMPLETED'
    | 'CONFIRMED'
    | 'LAND_TRANSIT'
    | 'PENDING'
    | 'PENDING_RECONCILIATION'
    | 'PREPARING'
    | 'SEA_TRANSIT'
    | 'WAITING_PAYMENT'
    | 'WAREHOUSE_ARRIVED'

export interface SalesOrderStatusCountsQueryInput extends Omit<
  SalesOrderListQueryInput,
  'fulfillmentStatus' | 'orderStatus' | 'page' | 'pageSize'
> {
  readonly view: 'all' | 'pending'
}

export interface SalesOrderStatusCounts {
  readonly view: 'all' | 'pending'
  readonly items: readonly {
    readonly value: SalesOrderStatusCountValue
    readonly count: number
  }[]
}

export interface SalesOrderIssuerOptions {
  readonly items: readonly {
    readonly id: string
    readonly displayName: string
    readonly status: UserStatus
  }[]
}

export interface SalesOrderListItem {
  readonly id: string
  readonly orderNo: string
  readonly orderDate: string
  readonly issuer: SalesOrderActor
  readonly currencyCode: string
  readonly customerName: string
  readonly customerPhone: string
  readonly customerProvinceStateName: string
  readonly customerCityName: string
  readonly customerFullAddress: string
  readonly standardSubtotalAmount: string
  readonly lineSubtotalAmount: string
  readonly agreedTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
  readonly receivedAmount: string
  readonly outstandingAmount: string
  readonly remark: string | null
  readonly orderStatus: SalesOrderStatus
  readonly fulfillmentStatus: SalesOrderFulfillmentStatus
  readonly paymentStatus: SalesOrderPaymentStatus
  readonly completionHold: SalesOrderCompletionHold | null
  readonly paymentRecordCount: number
  readonly statusChangeRecordCount: number
  readonly amountChangeRecordCount: number
  readonly version: number
  readonly lineSummary: {
    readonly lineCount: number
    readonly totalQuantity: number
    readonly catalogCount: number
    readonly customCount: number
    readonly previews: readonly {
      readonly lineId: string
      readonly productName: string
      readonly mainImage: {
        readonly id: string
        readonly contentUrl: string
      } | null
    }[]
  }
  readonly documentSummary: {
    readonly count: number
    readonly imageCount: number
    readonly previews: readonly {
      readonly id: string
      readonly documentType: SalesOrderDocumentType
      readonly title: string | null
      readonly mediaType: MediaType
      readonly contentUrl: string
    }[]
  }
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SalesOrderCurrencySummary {
  readonly currencyCode: 'TWD' | 'MYR'
  readonly orderCount: number
  readonly standardSubtotalAmount: string
  readonly agreedTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
  readonly receivedAmount: string
  readonly outstandingAmount: string
}

export interface SalesOrderPage {
  readonly items: readonly SalesOrderListItem[]
  readonly summariesByCurrency: readonly SalesOrderCurrencySummary[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface SalesOrderProductOption {
  readonly id: string
  readonly productNo: string
  readonly name: string
  readonly categoryName: string | null
  readonly productHeadName: string | null
  readonly supplierValue: string
  readonly attributes: readonly Record<string, unknown>[]
  readonly standardUnitPriceAmount: string | null
  readonly currencyCode: 'TWD' | 'MYR'
  readonly mainImage: {
    readonly id: string
    readonly contentUrl: string
  } | null
}

export interface SalesOrderProductOptionsQueryInput {
  readonly currencyCode: 'TWD' | 'MYR'
  readonly keyword?: string
  readonly supplierValue: string
  readonly categoryName?: string
  readonly productHeadName?: string
  readonly unclassified?: boolean
  readonly page?: number
  readonly pageSize?: number
}

export interface SalesOrderProductOptionsPage {
  readonly items: readonly SalesOrderProductOption[]
  readonly categories: readonly ProductOptionCategoryFacet[]
  readonly unclassifiedCount: number
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

function decimalToFixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
}

function nullableAmountUnits(
  value: { toFixed(decimalPlaces: number): string } | null | undefined,
): bigint {
  return value === null || value === undefined
    ? 0n
    : parseSalesOrderAmountUnits(decimalToFixed4(value))
}

function standardSubtotalUnits(
  lines: readonly {
    readonly standardUnitPriceAmount: {
      toFixed(decimalPlaces: number): string
    } | null
    readonly quantity: number
  }[],
): bigint {
  // 标准价缺失是允许状态；与产品明细编辑器一致，仅累计具备标准价快照的明细。
  return lines.reduce((sum, line) => (
    line.standardUnitPriceAmount === null
      ? sum
      : sum
        + parseSalesOrderAmountUnits(decimalToFixed4(line.standardUnitPriceAmount))
        * BigInt(line.quantity)
  ), 0n)
}

function listCurrencyWhere(
  where: Prisma.SalesOrderWhereInput,
  currencyCode: 'TWD' | 'MYR',
): Prisma.SalesOrderWhereInput {
  // 使用 AND 保留用户的币种筛选；当筛选币种不一致时，另一币种自然得到零条结果。
  return { AND: [where, { currencyCode }] }
}

/**
 * 列表与状态计数必须共享搜索、日期和非工具栏筛选语义。状态字段由各调用方
 * 单独叠加，避免当前工具栏选择污染其他分类的计数。
 */
function buildSalesOrderBaseWhere(
  input: Omit<SalesOrderListQueryInput, 'fulfillmentStatus' | 'orderStatus'>,
): Prisma.SalesOrderWhereInput {
  const keyword = input.keyword?.trim().normalize('NFKC')
  return {
    currencyCode: input.currencyCode,
    issuerUserId: input.issuerUserId,
    paymentStatus: input.paymentStatus,
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
      : {
          OR: [
            { orderNo: { contains: keyword, mode: 'insensitive' } },
            { customerName: { contains: keyword, mode: 'insensitive' } },
            { customerPhone: { contains: keyword } },
          ],
        }),
  }
}

function groupedCount<T extends string>(
  rows: readonly { readonly value: string, readonly count: number }[],
  values: readonly T[],
): ReadonlyMap<T, number> {
  const countByValue = new Map(rows.map(row => [row.value, row.count] as const))
  return new Map(values.map(value => [value, countByValue.get(value) ?? 0] as const))
}

function mapLineSummary(row: SalesOrderListRow): SalesOrderListItem['lineSummary'] {
  return {
    lineCount: row.lines.length,
    totalQuantity: row.lines.reduce((sum, line) => sum + line.quantity, 0),
    catalogCount: row.lines.filter(line => line.lineType === 'CATALOG').length,
    customCount: row.lines.filter(line => line.lineType === 'CUSTOM').length,
    // 列表查询已经一次性取得当前订单的全部明细；完整返回预览，前端才能按实际有图产品计算 ImageGroup 的折叠数量。
    previews: row.lines.map((line) => {
      const mainImage = line.product?.media[0]
      return {
        lineId: line.id,
        productName: line.productNameSnapshot,
        mainImage: line.productId === null || mainImage === undefined
          ? null
          : {
              id: mainImage.id,
              contentUrl: `/api/sales-orders/${row.id}/lines/${line.id}/main-image/${mainImage.id}/content`,
            },
      }
    }),
  }
}

function mapDocumentSummary(
  row: SalesOrderListRow,
): SalesOrderListItem['documentSummary'] {
  return {
    count: row.documents.length,
    imageCount: row.documents.filter(
      document => document.mediaAsset.mediaType === 'IMAGE',
    ).length,
    previews: row.documents
      .slice(0, SALES_ORDER_DOCUMENT_PREVIEW_LIMIT)
      .map(document => ({
        id: document.id,
        documentType: document.documentType,
        title: document.title,
        mediaType: document.mediaAsset.mediaType,
        contentUrl: `/api/sales-orders/${row.id}/documents/${document.id}/content`,
      })),
  }
}

function mapCurrencySummary(
  currencyCode: 'TWD' | 'MYR',
  orderAggregate: {
    readonly _count: { readonly _all: number }
    readonly _sum: {
      readonly agreedTotalAmount: {
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
  standardPriceLines: readonly {
    readonly standardUnitPriceAmount: {
      toFixed(decimalPlaces: number): string
    } | null
    readonly quantity: number
  }[],
  paymentAggregate: {
    readonly _sum: {
      readonly amount: { toFixed(decimalPlaces: number): string } | null
    }
  },
): SalesOrderCurrencySummary | null {
  if (orderAggregate._count._all === 0) return null
  const agreedUnits = nullableAmountUnits(orderAggregate._sum.agreedTotalAmount)
  const receivedUnits = nullableAmountUnits(paymentAggregate._sum.amount)
  return {
    currencyCode,
    orderCount: orderAggregate._count._all,
    standardSubtotalAmount: formatSalesOrderAmountUnits(
      standardSubtotalUnits(standardPriceLines),
    ),
    agreedTotalAmount: formatSalesOrderAmountUnits(agreedUnits),
    depositDueAmount: formatSalesOrderAmountUnits(
      nullableAmountUnits(orderAggregate._sum.depositDueAmount),
    ),
    balanceDueAmount: formatSalesOrderAmountUnits(
      nullableAmountUnits(orderAggregate._sum.balanceDueAmount),
    ),
    receivedAmount: formatSalesOrderAmountUnits(receivedUnits),
    outstandingAmount: formatSalesOrderAmountUnits(agreedUnits - receivedUnits),
  }
}

function mapActor(actor: SalesOrderActor | null): SalesOrderActor | null {
  return actor === null ? null : { id: actor.id, displayName: actor.displayName }
}

function mapDetailDocument(
  salesOrderId: string,
  document: SalesOrderDetailRow['documents'][number],
): Record<string, unknown> {
  return {
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
    contentUrl: `/api/sales-orders/${salesOrderId}/documents/${document.id}/content`,
    createdBy: mapActor(document.createdBy),
    createdAt: document.createdAt.toISOString(),
    detachedAt: document.detachedAt?.toISOString() ?? null,
    detachedBy: mapActor(document.detachedBy),
  }
}

function mapSalesOrderDetail(
  row: SalesOrderDetailRow,
  completionHold: SalesOrderCompletionHold | null,
): SalesOrderDetail {
  // 实际已收款口径下沉到领域模块：详情、列表与对账读取共用同一处累加规则。
  const receivedUnits = sumSalesOrderReceivedUnits(row.payments)
  const agreedUnits = parseSalesOrderAmountUnits(
    decimalToFixed4(row.agreedTotalAmount),
  )
  return {
    id: row.id,
    orderNo: row.orderNo,
    orderDate: row.orderDate.toISOString().slice(0, 10),
    issuer: mapActor(row.issuer) as SalesOrderActor,
    currencyCode: row.currencyCode,
    customer: {
      name: row.customerName,
      phone: row.customerPhone,
      countryRegion: {
        id: row.customerCountryRegionId,
        code: row.customerCountryRegionCodeSnapshot,
        name: row.customerCountryRegionNameSnapshot,
      },
      provinceState: {
        id: row.customerProvinceStateId,
        code: row.customerProvinceStateCodeSnapshot,
        name: row.customerProvinceStateNameSnapshot,
      },
      city: {
        id: row.customerCityId,
        code: row.customerCityCodeSnapshot,
        name: row.customerCityNameSnapshot,
      },
      addressDetail: row.customerAddressDetail,
      fullAddress: row.customerFullAddressSnapshot,
    },
    amounts: {
      lineSubtotalAmount: decimalToFixed4(row.lineSubtotalAmount),
      agreedTotalAmount: formatSalesOrderAmountUnits(agreedUnits),
      depositDueAmount: decimalToFixed4(row.depositDueAmount),
      balanceDueAmount: decimalToFixed4(row.balanceDueAmount),
      receivedAmount: formatSalesOrderAmountUnits(receivedUnits),
      outstandingAmount: formatSalesOrderAmountUnits(agreedUnits - receivedUnits),
    },
    orderStatus: row.orderStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    paymentStatus: row.paymentStatus,
    completionHold,
    remark: row.remark,
    version: row.version,
    lines: row.lines.map(line => ({
      id: line.id,
      lineNumber: line.lineNumber,
      lineType: line.lineType,
      productId: line.productId,
      productNo: line.productNoSnapshot,
      productName: line.productNameSnapshot,
      productAttributes: line.productAttributesSnapshot,
      description: line.descriptionSnapshot,
      standardUnitPriceAmount: line.standardUnitPriceAmount === null
        ? null
        : decimalToFixed4(line.standardUnitPriceAmount),
      actualUnitPriceAmount: decimalToFixed4(line.actualUnitPriceAmount),
      quantity: line.quantity,
      lineTotalAmount: decimalToFixed4(line.lineTotalAmount),
    })),
    payments: row.payments.map((payment) => {
      const voucher = row.documents.find(document => (
        document.paymentId === payment.id
        && document.documentType === 'PAYMENT_VOUCHER'
      ))
      // 代收回填收款没有凭证文件（凭证即对应的结算记录）；其余来源缺凭证属于脏数据，维持拒绝。
      if (voucher === undefined && payment.origin !== 'COD_SETTLEMENT') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'SALES_ORDER_STATE_CHANGED',
          '收款凭证状态已变化，请刷新后重试',
        )
      }
      return {
        id: payment.id,
        paymentType: payment.paymentType,
        origin: payment.origin,
        fundPostingBatchId: payment.fundPostingBatchId,
        fundReversalBatchId: payment.fundReversalBatchId,
        foreignUnitsPerCnySnapshot: payment.foreignUnitsPerCnySnapshot?.toFixed(12) ?? null,
        exchangeRateCapturedAt: payment.exchangeRateCapturedAt?.toISOString() ?? null,
        amount: decimalToFixed4(payment.amount),
        receivedAt: payment.receivedAt.toISOString(),
        paymentMethod: payment.paymentMethod,
        remark: payment.remark,
        createdBy: mapActor(payment.createdBy),
        createdAt: payment.createdAt.toISOString(),
        voidedAt: payment.voidedAt?.toISOString() ?? null,
        voidedBy: mapActor(payment.voidedBy),
        voidReason: payment.voidReason,
        voucher: voucher === undefined ? null : mapDetailDocument(row.id, voucher),
      }
    }),
    documents: row.documents.map(document => mapDetailDocument(row.id, document)),
    statusHistory: row.statusHistory.map(history => ({
      id: history.id,
      dimension: history.dimension,
      fromStatus: history.fromStatus,
      toStatus: history.toStatus,
      reason: history.reason,
      changedBy: mapActor(history.changedBy),
      changedAt: history.changedAt.toISOString(),
    })),
    amountRevisions: row.amountRevisions.map(revision => ({
      id: revision.id,
      oldLineSubtotalAmount: decimalToFixed4(revision.oldLineSubtotalAmount),
      oldAgreedTotalAmount: decimalToFixed4(revision.oldAgreedTotalAmount),
      oldDepositDueAmount: decimalToFixed4(revision.oldDepositDueAmount),
      oldBalanceDueAmount: decimalToFixed4(revision.oldBalanceDueAmount),
      newLineSubtotalAmount: decimalToFixed4(revision.newLineSubtotalAmount),
      newAgreedTotalAmount: decimalToFixed4(revision.newAgreedTotalAmount),
      newDepositDueAmount: decimalToFixed4(revision.newDepositDueAmount),
      newBalanceDueAmount: decimalToFixed4(revision.newBalanceDueAmount),
      reason: revision.reason,
      changedBy: mapActor(revision.changedBy),
      changedAt: revision.changedAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

@Injectable()
export class SalesOrderQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 出单人选项直接读取用户主表，并保留停用账号以支持历史订单筛选。该接口只暴露
   * 展示所需的最小身份信息，不要求销售人员额外拥有用户管理权限。
   */
  async issuerOptions(): Promise<SalesOrderIssuerOptions> {
    const users = await this.prisma.user.findMany({
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }, { id: 'asc' }],
      select: { id: true, displayName: true, status: true },
    })
    return { items: users }
  }

  async list(input: SalesOrderListQueryInput): Promise<SalesOrderPage> {
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const where: Prisma.SalesOrderWhereInput = {
      ...buildSalesOrderBaseWhere(input),
      orderStatus: input.orderStatus,
      fulfillmentStatus: input.fulfillmentStatus,
    }
    const twdWhere = listCurrencyWhere(where, 'TWD')
    const myrWhere = listCurrencyWhere(where, 'MYR')
    // 支持币种固定为 TWD/MYR，因此使用固定数量聚合查询，避免随列表行数增长的 N+1 查询。
    const [
      total,
      rows,
      twdOrders,
      twdStandardPriceLines,
      twdPayments,
      myrOrders,
      myrStandardPriceLines,
      myrPayments,
    ] = await this.prisma.$transaction([
      this.prisma.salesOrder.count({ where }),
      this.prisma.salesOrder.findMany({
        where,
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: SALES_ORDER_LIST_SELECT,
      }),
      this.prisma.salesOrder.aggregate({
        where: twdWhere,
        _count: { _all: true },
        _sum: {
          agreedTotalAmount: true,
          depositDueAmount: true,
          balanceDueAmount: true,
        },
      }),
      this.prisma.salesOrderLine.findMany({
        where: {
          removedAt: null,
          standardUnitPriceAmount: { not: null },
          salesOrder: { is: twdWhere },
        },
        select: { standardUnitPriceAmount: true, quantity: true },
      }),
      this.prisma.salesOrderPayment.aggregate({
        where: {
          voidedAt: null,
          salesOrder: { is: twdWhere },
        },
        _sum: { amount: true },
      }),
      this.prisma.salesOrder.aggregate({
        where: myrWhere,
        _count: { _all: true },
        _sum: {
          agreedTotalAmount: true,
          depositDueAmount: true,
          balanceDueAmount: true,
        },
      }),
      this.prisma.salesOrderLine.findMany({
        where: {
          removedAt: null,
          standardUnitPriceAmount: { not: null },
          salesOrder: { is: myrWhere },
        },
        select: { standardUnitPriceAmount: true, quantity: true },
      }),
      this.prisma.salesOrderPayment.aggregate({
        where: {
          voidedAt: null,
          salesOrder: { is: myrWhere },
        },
        _sum: { amount: true },
      }),
    ])
    const summariesByCurrency = [
      mapCurrencySummary('TWD', twdOrders, twdStandardPriceLines, twdPayments),
      mapCurrencySummary('MYR', myrOrders, myrStandardPriceLines, myrPayments),
    ].filter(summary => summary !== null)
    // 停留原因只对待对账订单有意义：一次读取当页全部待对账订单的对账状态（口径 R3），
    // 避免逐行查询；其它状态的订单不参与读取。
    const reconciliationStates = await readSalesOrderReconciliationStates(
      this.prisma,
      rows
        .filter(row => row.orderStatus === 'PENDING_RECONCILIATION')
        .map(row => row.id),
    )
    return {
      items: rows.map((row) => {
        const agreedUnits = parseSalesOrderAmountUnits(
          decimalToFixed4(row.agreedTotalAmount),
        )
        const receivedUnits = sumSalesOrderReceivedUnits(row.payments)
        return {
          id: row.id,
          orderNo: row.orderNo,
          orderDate: row.orderDate.toISOString().slice(0, 10),
          issuer: row.issuer,
          currencyCode: row.currencyCode,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          customerProvinceStateName: row.customerProvinceStateNameSnapshot,
          customerCityName: row.customerCityNameSnapshot,
          customerFullAddress: row.customerFullAddressSnapshot,
          standardSubtotalAmount: formatSalesOrderAmountUnits(
            standardSubtotalUnits(row.lines),
          ),
          lineSubtotalAmount: decimalToFixed4(row.lineSubtotalAmount),
          agreedTotalAmount: formatSalesOrderAmountUnits(agreedUnits),
          depositDueAmount: decimalToFixed4(row.depositDueAmount),
          balanceDueAmount: decimalToFixed4(row.balanceDueAmount),
          receivedAmount: formatSalesOrderAmountUnits(receivedUnits),
          outstandingAmount: formatSalesOrderAmountUnits(
            agreedUnits - receivedUnits,
          ),
          remark: row.remark,
          orderStatus: row.orderStatus,
          fulfillmentStatus: row.fulfillmentStatus,
          paymentStatus: row.paymentStatus,
          completionHold: resolveSalesOrderCompletionHold(row, reconciliationStates.get(row.id)),
          paymentRecordCount: row._count.payments,
          statusChangeRecordCount: row._count.statusHistory,
          amountChangeRecordCount: row._count.amountRevisions,
          version: row.version,
          lineSummary: mapLineSummary(row),
          documentSummary: mapDocumentSummary(row),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }
      }),
      summariesByCurrency,
      page,
      pageSize,
      total,
    }
  }

  async statusCounts(
    input: SalesOrderStatusCountsQueryInput,
  ): Promise<SalesOrderStatusCounts> {
    const baseWhere = buildSalesOrderBaseWhere(input)

    if (input.view === 'all') {
      const statuses = [
        'CONFIRMED',
        'PENDING_RECONCILIATION',
        'CANCELLED',
        'COMPLETED',
      ] as const
      const rows = await this.prisma.salesOrder.groupBy({
        by: ['orderStatus'] as const,
        where: { AND: [baseWhere, { orderStatus: { in: [...statuses] } }] },
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

    const fulfillmentStatuses = [
      'PENDING',
      'PREPARING',
      'LAND_TRANSIT',
      'WAREHOUSE_ARRIVED',
      'SEA_TRANSIT',
    ] as const
    const paymentStatuses = ['UNPAID', 'PARTIALLY_PAID'] as const
    const pendingBaseWhere: Prisma.SalesOrderWhereInput = {
      AND: [baseWhere, { orderStatus: 'CONFIRMED' }],
    }
    const { fulfillmentRows, paymentRows, allCount } = await this.prisma.$transaction(
      async (transaction) => {
        const fulfillmentRows = await transaction.salesOrder.groupBy({
          by: ['fulfillmentStatus'],
          where: pendingBaseWhere,
          _count: { _all: true },
        })
        const paymentRows = await transaction.salesOrder.groupBy({
          by: ['paymentStatus'],
          where: pendingBaseWhere,
          _count: { _all: true },
        })
        const allCount = await transaction.salesOrder.count({
          where: {
            AND: [
              pendingBaseWhere,
              { OR: [
                { fulfillmentStatus: { in: [...fulfillmentStatuses] } },
                { paymentStatus: { in: [...paymentStatuses] } },
              ] },
            ],
          },
        })
        return { fulfillmentRows, paymentRows, allCount }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
    const fulfillmentCounts = groupedCount(
      fulfillmentRows.map(row => ({
        value: row.fulfillmentStatus,
        count: row._count._all,
      })),
      fulfillmentStatuses,
    )
    const paymentCounts = groupedCount(
      paymentRows.map(row => ({
        value: row.paymentStatus,
        count: row._count._all,
      })),
      paymentStatuses,
    )

    return {
      view: 'pending',
      items: [
        { value: 'ALL', count: allCount },
        ...fulfillmentStatuses.map(value => ({
          value,
          count: fulfillmentCounts.get(value) ?? 0,
        })),
        {
          value: 'WAITING_PAYMENT',
          count: paymentStatuses.reduce(
            (sum, value) => sum + (paymentCounts.get(value) ?? 0),
            0,
          ),
        },
      ],
    }
  }

  async productOptions(
    input: SalesOrderProductOptionsQueryInput,
  ): Promise<SalesOrderProductOptionsPage> {
    if (
      input.unclassified === true
      && (input.categoryName !== undefined || input.productHeadName !== undefined)
    ) {
      throw new ApiException(
        422,
        'VALIDATION_FAILED',
        '请求参数校验失败',
        { categoryName: ['未分类筛选不能与分类/产品头筛选同时使用'] },
      )
    }
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const normalizedKeyword = input.keyword?.trim().normalize('NFKC')
    const facetWhere: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      supplierValue: input.supplierValue,
    }
    const where: Prisma.ProductWhereInput = {
      ...facetWhere,
      ...(input.categoryName === undefined
        ? {}
        : { category: { is: { name: input.categoryName } } }),
      ...(input.productHeadName === undefined
        ? {}
        : { productHead: { is: { name: input.productHeadName } } }),
      ...(input.unclassified === true ? { categoryId: null } : {}),
      ...(normalizedKeyword === undefined || normalizedKeyword.length === 0
        ? {}
        : {
            OR: [
              { productNo: { contains: normalizedKeyword, mode: 'insensitive' } },
              { name: { contains: normalizedKeyword, mode: 'insensitive' } },
            ],
          }),
    }
    const [total, rows, facets] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [
          { category: { name: 'asc' } },
          { productHead: { name: 'asc' } },
          { name: 'asc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          productNo: true,
          name: true,
          category: { select: { name: true } },
          productHead: { select: { name: true } },
          supplierValue: true,
          attributes: true,
          twdSalePriceAmount: true,
          myrSalePriceAmount: true,
          // 最多读取两张即可判断主图唯一性；不加载附图、视频或私有存储字段。
          media: {
            where: {
              kind: 'IMAGE',
              isPrimary: true,
              detachedAt: null,
              mediaAsset: { is: { status: 'READY' } },
            },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            take: 2,
            select: { id: true },
          },
        },
      }),
      readProductOptionCategoryFacets(this.prisma, {
        supplierValue: input.supplierValue,
        productWhere: facetWhere,
      }),
    ])
    const items = rows.map(row => mapSalesOrderProductOption(
      row,
      input.currencyCode,
      (productId, productMediaId) => (
        `/api/sales-orders/product-options/${productId}/main-image/${productMediaId}/content?currencyCode=${input.currencyCode}`
      ),
    ))
    return {
      items,
      page,
      pageSize,
      total,
      categories: facets.categories,
      unclassifiedCount: facets.unclassifiedCount,
    }
  }

  async getById(salesOrderId: string): Promise<SalesOrderDetail> {
    const row = await this.prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: SALES_ORDER_DETAIL_INCLUDE,
    })
    if (row === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SALES_ORDER_NOT_FOUND',
        '销售订单不存在',
      )
    }
    // 非待对账订单不读取对账状态（读取器对空入参直接返回空 Map）。
    const reconciliationStates = await readSalesOrderReconciliationStates(
      this.prisma,
      row.orderStatus === 'PENDING_RECONCILIATION' ? [salesOrderId] : [],
    )
    return mapSalesOrderDetail(
      row,
      resolveSalesOrderCompletionHold(row, reconciliationStates.get(salesOrderId)),
    )
  }
}
