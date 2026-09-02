import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  DictionaryLookupService,
} from '../dictionaries/dictionary-lookup.service'
import { normalizeDictionaryItemValue } from '../dictionaries/dictionary.normalizer'
import {
  PURCHASE_ORDER_SOURCE_FULFILLMENT_STATUSES,
  type PurchaseOrderSourceSalesOrderView,
} from './domain/purchase-order-source-sales-order-view'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'

export interface PurchaseOrderProductOptionsInput {
  readonly supplierValue: string
  readonly keyword?: string
  readonly page?: number
  readonly pageSize?: number
}

export interface PurchaseOrderSourceSalesOrdersInput {
  readonly view: PurchaseOrderSourceSalesOrderView
  readonly keyword?: string
  readonly page?: number
  readonly pageSize?: number
}

function sourceSalesOrderWhere(
  view: PurchaseOrderSourceSalesOrderView,
  baseWhere: Prisma.SalesOrderWhereInput,
): Prisma.SalesOrderWhereInput {
  return {
    ...baseWhere,
    fulfillmentStatus: {
      in: [...PURCHASE_ORDER_SOURCE_FULFILLMENT_STATUSES[view]],
    },
  }
}

function fixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
}

function attributes(value: unknown): readonly Record<string, unknown>[] {
  if (
    !Array.isArray(value)
    || value.some(item => (
      typeof item !== 'object' || item === null || Array.isArray(item)
    ))
  ) {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'PURCHASE_ORDER_STATE_CHANGED',
      '产品属性状态已变化，请重试',
    )
  }
  return value as readonly Record<string, unknown>[]
}

function unavailableSupplier(): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'PURCHASE_ORDER_SUPPLIER_UNAVAILABLE',
    '供应商当前不可用',
  )
}

@Injectable()
export class PurchaseOrderSourceQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryLookup: DictionaryLookupService,
  ) {}

  async productOptions(input: PurchaseOrderProductOptionsInput) {
    let supplierValue: string
    try {
      supplierValue = normalizeDictionaryItemValue(input.supplierValue)
    }
    catch {
      return unavailableSupplier()
    }
    const supplier = await this.dictionaryLookup.resolveStoredValue({
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      value: supplierValue,
    })
    if (supplier.known !== true || !supplier.effectiveEnabled) {
      return unavailableSupplier()
    }
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const keyword = input.keyword?.trim().normalize('NFKC')
    const where: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      supplierValue,
      purchaseCostAmount: { not: null },
      purchaseCostCurrency: 'CNY',
      ...(keyword === undefined || keyword.length === 0
        ? {}
        : { OR: [
            { productNo: { contains: keyword, mode: 'insensitive' } },
            { name: { contains: keyword, mode: 'insensitive' } },
          ] }),
    }
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          productNo: true,
          name: true,
          attributes: true,
          supplierValue: true,
          purchaseCostAmount: true,
          purchaseCostCurrency: true,
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
    return {
      items: rows.map((row) => {
        if (row.purchaseCostAmount === null) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'PURCHASE_ORDER_STATE_CHANGED',
            '产品采购成本已变化，请重试',
          )
        }
        if (row.media.length > 1) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'PURCHASE_ORDER_STATE_CHANGED',
            '产品主图状态已变化，请重试',
          )
        }
        const mainImage = row.media[0]
        return {
          id: row.id,
          productNo: row.productNo,
          name: row.name,
          attributes: attributes(row.attributes),
          supplierValue: row.supplierValue as string,
          referencePurchaseUnitPriceAmount: fixed4(row.purchaseCostAmount),
          currencyCode: 'CNY' as const,
          mainImage: mainImage === undefined
            ? null
            : {
                id: mainImage.id,
                contentUrl:
                  `/api/purchase-orders/product-options/${row.id}/main-image/${mainImage.id}/content`,
              },
        }
      }),
      page,
      pageSize,
      total,
    }
  }

  async salesOrders(input: PurchaseOrderSourceSalesOrdersInput) {
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const keyword = input.keyword?.trim().normalize('NFKC')
    const baseWhere: Prisma.SalesOrderWhereInput = {
      orderStatus: 'CONFIRMED',
      ...(keyword === undefined || keyword.length === 0
        ? {}
        : { OR: [
            { orderNo: { contains: keyword, mode: 'insensitive' } },
            { customerName: { contains: keyword, mode: 'insensitive' } },
          ] }),
    }
    const where = sourceSalesOrderWhere(input.view, baseWhere)
    const initialPurchaseWhere = sourceSalesOrderWhere('INITIAL_PURCHASE', baseWhere)
    const supplementalPurchaseWhere = sourceSalesOrderWhere(
      'SUPPLEMENTAL_PURCHASE',
      baseWhere,
    )
    const [initialPurchaseCount, supplementalPurchaseCount, rows] = await Promise.all([
      this.prisma.salesOrder.count({ where: initialPurchaseWhere }),
      this.prisma.salesOrder.count({ where: supplementalPurchaseWhere }),
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
          customerName: true,
          lineSubtotalAmount: true,
          orderStatus: true,
          fulfillmentStatus: true,
          paymentStatus: true,
          lines: {
            orderBy: { lineNumber: 'asc' },
            select: {
              id: true,
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
            },
          },
        },
      }),
    ])
    const counts = [
      { value: 'INITIAL_PURCHASE' as const, count: initialPurchaseCount },
      { value: 'SUPPLEMENTAL_PURCHASE' as const, count: supplementalPurchaseCount },
    ]
    return {
      view: input.view,
      counts,
      items: rows.map((row) => {
        // 图片 URL 必须留在采购权限域，不能复用要求 sales-orders:read 的销售列表内容端点。
        // CUSTOM 行没有目录产品，或目录产品当前没有有效主图时，明确返回 null 供公共组件降级展示。
        const previews = row.lines.map((line) => {
          const mainImage = line.product?.media[0]
          return {
            lineId: line.id,
            productName: line.productNameSnapshot,
            mainImage: line.productId === null || mainImage === undefined
              ? null
              : {
                  id: mainImage.id,
                  contentUrl:
                    `/api/purchase-orders/source-sales-orders/${row.id}/lines/${line.id}/main-image/${mainImage.id}/content`,
                },
          }
        })
        return {
          id: row.id,
          orderNo: row.orderNo,
          orderDate: row.orderDate.toISOString().slice(0, 10),
          issuer: row.issuer,
          customerName: row.customerName,
          salesTotalAmount: fixed4(row.lineSubtotalAmount),
          orderStatus: row.orderStatus,
          fulfillmentStatus: row.fulfillmentStatus,
          paymentStatus: row.paymentStatus,
          lineSummary: {
            lineCount: row.lines.length,
            totalQuantity: row.lines.reduce((sum, line) => sum + line.quantity, 0),
            previews,
          },
        }
      }),
      page,
      pageSize,
      total: input.view === 'INITIAL_PURCHASE'
        ? initialPurchaseCount
        : supplementalPurchaseCount,
    }
  }

  async salesOrderLines(salesOrderId: string) {
    const salesOrder = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, orderStatus: 'CONFIRMED' },
      select: { id: true, orderNo: true, customerName: true },
    })
    if (salesOrder === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'PURCHASE_ORDER_SOURCE_ORDER_NOT_FOUND',
        '销售来源订单不存在或当前不可用',
      )
    }
    const lines = await this.prisma.salesOrderLine.findMany({
      where: { salesOrderId },
      orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        lineNumber: true,
        lineType: true,
        productId: true,
        productNoSnapshot: true,
        productNameSnapshot: true,
        productAttributesSnapshot: true,
        descriptionSnapshot: true,
        quantity: true,
      },
    })
    const sourceIds = lines.map(line => line.id)
    const purchasedRows = sourceIds.length === 0
      ? []
      : await this.prisma.purchaseOrderLine.findMany({
          where: {
            sourceSalesOrderLineId: { in: sourceIds },
            purchaseOrder: { orderStatus: { not: 'CANCELLED' } },
          },
          orderBy: [
            { purchaseOrder: { createdAt: 'asc' } },
            { purchaseOrderId: 'asc' },
            { lineNumber: 'asc' },
            { id: 'asc' },
          ],
          select: {
            id: true,
            sourceSalesOrderLineId: true,
            referencePurchaseUnitPriceAmount: true,
            actualPurchaseUnitPriceAmount: true,
            quantity: true,
            lineTotalAmount: true,
            descriptionSnapshot: true,
          },
        })
    const purchasedBySource = new Map<string, typeof purchasedRows>()
    for (const row of purchasedRows) {
      if (row.sourceSalesOrderLineId === null) {
        continue
      }
      const rows = purchasedBySource.get(row.sourceSalesOrderLineId) ?? []
      rows.push(row)
      purchasedBySource.set(row.sourceSalesOrderLineId, rows)
    }
    return {
      salesOrder,
      items: lines.map((line) => {
        const purchasedLines = purchasedBySource.get(line.id) ?? []
        const purchasedQuantity = purchasedLines.reduce(
          (sum, purchasedLine) => sum + purchasedLine.quantity,
          0,
        )
        return {
          id: line.id,
          lineNumber: line.lineNumber,
          lineType: line.lineType,
          productId: line.productId,
          productNo: line.productNoSnapshot,
          productName: line.productNameSnapshot,
          productAttributes: attributes(line.productAttributesSnapshot),
          description: line.descriptionSnapshot,
          quantity: line.quantity,
          purchasedQuantity,
          remainingQuantity: Math.max(0, line.quantity - purchasedQuantity),
          purchasedLines: purchasedLines.map(purchasedLine => ({
            id: purchasedLine.id,
            referencePurchaseUnitPriceAmount:
              fixed4(purchasedLine.referencePurchaseUnitPriceAmount),
            actualPurchaseUnitPriceAmount:
              fixed4(purchasedLine.actualPurchaseUnitPriceAmount),
            quantity: purchasedLine.quantity,
            lineTotalAmount: fixed4(purchasedLine.lineTotalAmount),
            description: purchasedLine.descriptionSnapshot,
          })),
        }
      }),
    }
  }
}
