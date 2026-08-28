import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  DictionaryLookupService,
} from '../dictionaries/dictionary-lookup.service'
import { normalizeDictionaryItemValue } from '../dictionaries/dictionary.normalizer'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'

export interface PurchaseOrderProductOptionsInput {
  readonly supplierValue: string
  readonly keyword?: string
  readonly page?: number
  readonly pageSize?: number
}

export interface PurchaseOrderSourceSalesOrdersInput {
  readonly keyword?: string
  readonly page?: number
  readonly pageSize?: number
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
    const where: Prisma.SalesOrderWhereInput = {
      orderStatus: 'CONFIRMED',
      ...(keyword === undefined || keyword.length === 0
        ? {}
        : { OR: [
            { orderNo: { contains: keyword, mode: 'insensitive' } },
            { customerName: { contains: keyword, mode: 'insensitive' } },
          ] }),
    }
    const [total, rows] = await Promise.all([
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
          customerName: true,
          lineSubtotalAmount: true,
        },
      }),
    ])
    return {
      items: rows.map(row => ({
        id: row.id,
        orderNo: row.orderNo,
        orderDate: row.orderDate.toISOString().slice(0, 10),
        customerName: row.customerName,
        salesTotalAmount: fixed4(row.lineSubtotalAmount),
      })),
      page,
      pageSize,
      total,
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
      : await this.prisma.purchaseOrderLine.groupBy({
          by: ['sourceSalesOrderLineId'],
          where: {
            sourceSalesOrderLineId: { in: sourceIds },
            purchaseOrder: { orderStatus: { not: 'CANCELLED' } },
          },
          _sum: { quantity: true },
        })
    const purchasedBySource = new Map(purchasedRows.map(row => [
      row.sourceSalesOrderLineId,
      row._sum.quantity ?? 0,
    ]))
    return {
      salesOrder,
      items: lines.map((line) => {
        const purchasedQuantity = purchasedBySource.get(line.id) ?? 0
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
        }
      }),
    }
  }
}
