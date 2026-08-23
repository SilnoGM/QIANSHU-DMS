import { HttpStatus, Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import type {
  SalesOrderFulfillmentStatus,
  SalesOrderPaymentStatus,
  SalesOrderStatus,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  formatSalesOrderAmountUnits,
  parseSalesOrderAmountUnits,
} from './domain/sales-order-decimal'

const SALES_ORDER_DETAIL_INCLUDE = {
  issuer: { select: { id: true, displayName: true } },
  lines: { orderBy: { lineNumber: 'asc' } },
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
  readonly orderStatus?: SalesOrderStatus
  readonly fulfillmentStatus?: SalesOrderFulfillmentStatus
  readonly paymentStatus?: SalesOrderPaymentStatus
  readonly orderDateFrom?: string
  readonly orderDateTo?: string
}

export interface SalesOrderListItem {
  readonly id: string
  readonly orderNo: string
  readonly orderDate: string
  readonly issuer: SalesOrderActor
  readonly currencyCode: string
  readonly customerName: string
  readonly customerPhone: string
  readonly customerCityName: string
  readonly agreedTotalAmount: string
  readonly receivedAmount: string
  readonly outstandingAmount: string
  readonly orderStatus: SalesOrderStatus
  readonly fulfillmentStatus: SalesOrderFulfillmentStatus
  readonly paymentStatus: SalesOrderPaymentStatus
  readonly updatedAt: string
}

export interface SalesOrderPage {
  readonly items: readonly SalesOrderListItem[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface SalesOrderProductOption {
  readonly id: string
  readonly productNo: string
  readonly name: string
  readonly supplierValue: string | null
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
  readonly supplierValue?: string
  readonly page?: number
  readonly pageSize?: number
}

export interface SalesOrderProductOptionsPage {
  readonly items: readonly SalesOrderProductOption[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

function decimalToFixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
}

function productOptionAttributes(
  value: unknown,
): readonly Record<string, unknown>[] {
  if (
    !Array.isArray(value)
    || value.some(item => typeof item !== 'object' || item === null || Array.isArray(item))
  ) {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'SALES_ORDER_STATE_CHANGED',
      '产品属性状态已变化，请重试',
    )
  }
  return value as readonly Record<string, unknown>[]
}

function mapActor(actor: SalesOrderActor | null): SalesOrderActor | null {
  return actor === null ? null : { id: actor.id, displayName: actor.displayName }
}

function mapSalesOrderDetail(row: SalesOrderDetailRow): SalesOrderDetail {
  const receivedUnits = row.payments.reduce(
    (sum, payment) => payment.voidedAt === null
      ? sum + parseSalesOrderAmountUnits(decimalToFixed4(payment.amount))
      : sum,
    0n,
  )
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
    payments: row.payments.map(payment => ({
      id: payment.id,
      paymentType: payment.paymentType,
      amount: decimalToFixed4(payment.amount),
      receivedAt: payment.receivedAt.toISOString(),
      paymentMethod: payment.paymentMethod,
      referenceNo: payment.referenceNo,
      remark: payment.remark,
      createdBy: mapActor(payment.createdBy),
      createdAt: payment.createdAt.toISOString(),
      voidedAt: payment.voidedAt?.toISOString() ?? null,
      voidedBy: mapActor(payment.voidedBy),
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
      contentUrl: `/api/sales-orders/${row.id}/documents/${document.id}/content`,
      createdBy: mapActor(document.createdBy),
      createdAt: document.createdAt.toISOString(),
      detachedAt: document.detachedAt?.toISOString() ?? null,
      detachedBy: mapActor(document.detachedBy),
    })),
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

  async list(input: SalesOrderListQueryInput): Promise<SalesOrderPage> {
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const keyword = input.keyword?.trim().normalize('NFKC')
    const where: Prisma.SalesOrderWhereInput = {
      currencyCode: input.currencyCode,
      orderStatus: input.orderStatus,
      fulfillmentStatus: input.fulfillmentStatus,
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
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesOrder.count({ where }),
      this.prisma.salesOrder.findMany({
        where,
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderNo: true,
          orderDate: true,
          issuer: { select: { id: true, displayName: true } },
          currencyCode: true,
          customerName: true,
          customerPhone: true,
          customerCityNameSnapshot: true,
          agreedTotalAmount: true,
          orderStatus: true,
          fulfillmentStatus: true,
          paymentStatus: true,
          updatedAt: true,
          payments: {
            where: { voidedAt: null },
            select: { amount: true },
          },
        },
      }),
    ])
    return {
      items: rows.map((row) => {
        const agreedUnits = parseSalesOrderAmountUnits(
          decimalToFixed4(row.agreedTotalAmount),
        )
        const receivedUnits = row.payments.reduce(
          (sum, payment) => sum + parseSalesOrderAmountUnits(
            decimalToFixed4(payment.amount),
          ),
          0n,
        )
        return {
          id: row.id,
          orderNo: row.orderNo,
          orderDate: row.orderDate.toISOString().slice(0, 10),
          issuer: row.issuer,
          currencyCode: row.currencyCode,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          customerCityName: row.customerCityNameSnapshot,
          agreedTotalAmount: formatSalesOrderAmountUnits(agreedUnits),
          receivedAmount: formatSalesOrderAmountUnits(receivedUnits),
          outstandingAmount: formatSalesOrderAmountUnits(
            agreedUnits - receivedUnits,
          ),
          orderStatus: row.orderStatus,
          fulfillmentStatus: row.fulfillmentStatus,
          paymentStatus: row.paymentStatus,
          updatedAt: row.updatedAt.toISOString(),
        }
      }),
      page,
      pageSize,
      total,
    }
  }

  async productOptions(
    input: SalesOrderProductOptionsQueryInput,
  ): Promise<SalesOrderProductOptionsPage> {
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const normalizedKeyword = input.keyword?.trim().normalize('NFKC')
    const where: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      ...(input.supplierValue === undefined
        ? {}
        : { supplierValue: input.supplierValue }),
      ...(normalizedKeyword === undefined || normalizedKeyword.length === 0
        ? {}
        : {
            OR: [
              { productNo: { contains: normalizedKeyword, mode: 'insensitive' } },
              { name: { contains: normalizedKeyword, mode: 'insensitive' } },
            ],
          }),
    }
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          productNo: true,
          name: true,
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
    ])
    const items = rows.map((row) => {
      const standardPrice = input.currencyCode === 'TWD'
        ? row.twdSalePriceAmount
        : row.myrSalePriceAmount
      if (row.media.length > 1) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'SALES_ORDER_STATE_CHANGED',
          '产品状态已变化，请重试',
        )
      }
      const mainImage = row.media[0]
      return {
        id: row.id,
        productNo: row.productNo,
        name: row.name,
        supplierValue: row.supplierValue,
        attributes: productOptionAttributes(row.attributes),
        standardUnitPriceAmount: standardPrice === null
          ? null
          : decimalToFixed4(standardPrice),
        currencyCode: input.currencyCode,
        mainImage: mainImage === undefined
          ? null
          : {
              id: mainImage.id,
              contentUrl: `/api/sales-orders/product-options/${row.id}/main-image/${mainImage.id}/content?currencyCode=${input.currencyCode}`,
            },
      }
    })
    return { items, page, pageSize, total }
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
    return mapSalesOrderDetail(row)
  }
}
