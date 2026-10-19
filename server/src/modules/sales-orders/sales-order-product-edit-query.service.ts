import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  SALES_ORDER_PRE_SEA_FULFILLMENT_STATUSES,
} from '../purchase-orders/domain/purchase-order-source-sales-order-view'
import {
  formatSalesOrderAmountUnits,
  parseSalesOrderAmountUnits,
} from './domain/sales-order-decimal'
import { mapSalesOrderProductOption } from './products/sales-order-product-option.mapper'
import { readProductOptionCategoryFacets } from '../products/product-option-category-facets'

const MAX_SALES_ORDER_LINES = 100

function fixed2(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(2)
}

function productEditNotAllowed(): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'SALES_ORDER_PRODUCT_EDIT_NOT_ALLOWED',
    '销售订单当前不允许修改产品',
  )
}

@Injectable()
export class SalesOrderProductEditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async context(salesOrderId: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      select: {
        id: true,
        orderNo: true,
        customerName: true,
        currencyCode: true,
        orderStatus: true,
        fulfillmentStatus: true,
        paymentStatus: true,
        version: true,
        lineSubtotalAmount: true,
        agreedTotalAmount: true,
        depositDueAmount: true,
        balanceDueAmount: true,
        lines: {
          where: { removedAt: null },
          orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            lineNumber: true,
            lineType: true,
            productId: true,
            productNoSnapshot: true,
            productNameSnapshot: true,
            descriptionSnapshot: true,
            standardUnitPriceAmount: true,
            actualUnitPriceAmount: true,
            quantity: true,
            lineTotalAmount: true,
            product: {
              select: {
                supplierValue: true,
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
        payments: {
          where: { voidedAt: null },
          select: { amount: true },
        },
      },
    })
    if (order === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SALES_ORDER_NOT_FOUND',
        '销售订单不存在',
      )
    }
    if (
      order.orderStatus !== 'CONFIRMED'
      || !SALES_ORDER_PRE_SEA_FULFILLMENT_STATUSES.includes(
        order.fulfillmentStatus as typeof SALES_ORDER_PRE_SEA_FULFILLMENT_STATUSES[number],
      )
    ) {
      return productEditNotAllowed()
    }

    const sourceLineIds = order.lines.map(line => line.id)
    const purchasedRows = sourceLineIds.length === 0
      ? []
      : await this.prisma.purchaseOrderLine.findMany({
          where: {
            sourceSalesOrderLineId: { in: sourceLineIds },
            purchaseOrder: { is: {
              purchaseType: 'SALES_LINKED',
              salesOrderId,
              orderStatus: { not: 'CANCELLED' },
            } },
          },
          select: { sourceSalesOrderLineId: true, quantity: true },
        })
    const purchasedByLine = new Map<string, number>()
    for (const row of purchasedRows) {
      if (row.sourceSalesOrderLineId === null) continue
      purchasedByLine.set(
        row.sourceSalesOrderLineId,
        (purchasedByLine.get(row.sourceSalesOrderLineId) ?? 0) + row.quantity,
      )
    }
    const paidUnits = order.payments.reduce((sum, payment) => (
      sum + parseSalesOrderAmountUnits(fixed2(payment.amount))
    ), 0n)
    const agreedUnits = parseSalesOrderAmountUnits(fixed2(order.agreedTotalAmount))

    return {
      salesOrder: {
        id: order.id,
        orderNo: order.orderNo,
        customerName: order.customerName,
        currencyCode: order.currencyCode as 'TWD' | 'MYR',
        orderStatus: order.orderStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        paymentStatus: order.paymentStatus,
        version: order.version,
      },
      amounts: {
        lineSubtotalAmount: fixed2(order.lineSubtotalAmount),
        agreedTotalAmount: fixed2(order.agreedTotalAmount),
        depositDueAmount: fixed2(order.depositDueAmount),
        balanceDueAmount: fixed2(order.balanceDueAmount),
        paidAmount: formatSalesOrderAmountUnits(paidUnits),
        outstandingAmount: formatSalesOrderAmountUnits(agreedUnits - paidUnits),
      },
      existingLines: order.lines.map((line) => {
        const mainImage = line.product?.media[0]
        const activePurchasedQuantity = purchasedByLine.get(line.id) ?? 0
        return {
          id: line.id,
          lineNumber: line.lineNumber,
          lineType: line.lineType,
          productId: line.productId,
          productNo: line.productNoSnapshot,
          productName: line.productNameSnapshot,
          supplierValue: line.product?.supplierValue ?? null,
          description: line.descriptionSnapshot,
          standardUnitPriceAmount: line.standardUnitPriceAmount === null
            ? null
            : fixed2(line.standardUnitPriceAmount),
          actualUnitPriceAmount: fixed2(line.actualUnitPriceAmount),
          quantity: line.quantity,
          lineTotalAmount: fixed2(line.lineTotalAmount),
          activePurchasedQuantity,
          canDecrease: activePurchasedQuantity < line.quantity,
          mainImage: line.productId === null || mainImage === undefined
            ? null
            : {
                id: mainImage.id,
                contentUrl: `/api/sales-orders/${order.id}/lines/${line.id}/main-image/${mainImage.id}/content`,
              },
        }
      }),
      availableLineCapacity: Math.max(0, MAX_SALES_ORDER_LINES - order.lines.length),
    }
  }

  async productOptions(
    salesOrderId: string,
    input: {
      readonly keyword?: string
      readonly supplierValue: string
      readonly categoryName?: string
      readonly productHeadName?: string
      readonly unclassified?: boolean
      readonly page?: number
      readonly pageSize?: number
    },
  ) {
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
    const context = await this.context(salesOrderId)
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const keyword = input.keyword?.trim().normalize('NFKC')
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
      ...(keyword === undefined || keyword.length === 0
        ? {}
        : { OR: [
            { productNo: { contains: keyword, mode: 'insensitive' } },
            { name: { contains: keyword, mode: 'insensitive' } },
          ] }),
    }
    const [total, rows, facets] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [
          { category: { sortOrder: 'asc' } },
          { category: { name: 'asc' } },
          { productHead: { sortOrder: 'asc' } },
          { productHead: { name: 'asc' } },
          { sortOrder: 'asc' },
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
      context.salesOrder.currencyCode,
      (productId, productMediaId) => (
        `/api/sales-orders/${salesOrderId}/product-edit-options/${productId}/main-image/${productMediaId}/content`
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
}
