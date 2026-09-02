import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import { normalizeDictionaryItemValue } from '../dictionaries/dictionary.normalizer'
import { classifyPurchaseSourceView } from '../purchase-orders/domain/purchase-order-source-sales-order-view'
import {
  formatSalesOrderAmountUnits,
  parseSalesOrderAmountUnits,
} from './domain/sales-order-decimal'
import { mapSalesOrderProductOption } from './products/sales-order-product-option.mapper'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const MAX_SALES_ORDER_LINES = 100

function fixed4(value: { toFixed(decimalPlaces: number): string }): string {
  return value.toFixed(4)
}

function addOnNotAllowed(): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'SALES_ORDER_ADD_ON_NOT_ALLOWED',
    '销售订单当前不允许加购产品',
  )
}

function supplierUnavailable(): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'SALES_ORDER_ADD_ON_SUPPLIER_UNAVAILABLE',
    '加购供应商当前不可用',
  )
}

export interface SalesOrderAddOnProductOptionsInput {
  readonly supplierValue: string
  readonly keyword?: string
  readonly page?: number
  readonly pageSize?: number
}

@Injectable()
export class SalesOrderAddOnQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryLookup: DictionaryLookupService,
  ) {}

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
          orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            lineNumber: true,
            lineType: true,
            productNoSnapshot: true,
            productNameSnapshot: true,
            actualUnitPriceAmount: true,
            quantity: true,
            lineTotalAmount: true,
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

    const sourceLineIds = order.lines.map(line => line.id)
    const [activePurchaseOrderCount, purchasedRows] = await Promise.all([
      this.prisma.purchaseOrder.count({
        where: {
          purchaseType: 'SALES_LINKED',
          salesOrderId,
          orderStatus: { not: 'CANCELLED' },
        },
      }),
      sourceLineIds.length === 0
        ? Promise.resolve([])
        : this.prisma.purchaseOrderLine.findMany({
            where: {
              sourceSalesOrderLineId: { in: sourceLineIds },
              purchaseOrder: {
                is: {
                  purchaseType: 'SALES_LINKED',
                  salesOrderId,
                  orderStatus: { not: 'CANCELLED' },
                },
              },
            },
            select: { sourceSalesOrderLineId: true, quantity: true },
          }),
    ])
    const purchasedByLine = new Map<string, number>()
    for (const row of purchasedRows) {
      if (row.sourceSalesOrderLineId === null) continue
      purchasedByLine.set(
        row.sourceSalesOrderLineId,
        (purchasedByLine.get(row.sourceSalesOrderLineId) ?? 0) + row.quantity,
      )
    }
    const purchasedQuantity = [...purchasedByLine.values()]
      .reduce((sum, quantity) => sum + quantity, 0)
    const remainingQuantity = order.lines.reduce((sum, line) => (
      sum + Math.max(0, line.quantity - (purchasedByLine.get(line.id) ?? 0))
    ), 0)
    if (classifyPurchaseSourceView({
      orderStatus: order.orderStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      activePurchaseOrderCount,
      purchasedQuantity,
      remainingQuantity,
    }) !== 'COMPLETED_PURCHASE_ADD_ON') {
      return addOnNotAllowed()
    }

    const paidUnits = order.payments.reduce((sum, payment) => (
      sum + parseSalesOrderAmountUnits(fixed4(payment.amount))
    ), 0n)
    const agreedUnits = parseSalesOrderAmountUnits(fixed4(order.agreedTotalAmount))
    return {
      salesOrder: {
        id: order.id,
        orderNo: order.orderNo,
        customerName: order.customerName,
        currencyCode: order.currencyCode as 'TWD' | 'MYR',
        fulfillmentStatus: order.fulfillmentStatus,
        paymentStatus: order.paymentStatus,
        version: order.version,
      },
      amounts: {
        lineSubtotalAmount: fixed4(order.lineSubtotalAmount),
        agreedTotalAmount: fixed4(order.agreedTotalAmount),
        depositDueAmount: fixed4(order.depositDueAmount),
        balanceDueAmount: fixed4(order.balanceDueAmount),
        paidAmount: formatSalesOrderAmountUnits(paidUnits),
        outstandingAmount: formatSalesOrderAmountUnits(agreedUnits - paidUnits),
      },
      existingLines: order.lines.map(line => ({
        id: line.id,
        lineNumber: line.lineNumber,
        lineType: line.lineType,
        productNo: line.productNoSnapshot,
        productName: line.productNameSnapshot,
        actualUnitPriceAmount: fixed4(line.actualUnitPriceAmount),
        quantity: line.quantity,
        lineTotalAmount: fixed4(line.lineTotalAmount),
      })),
      availableLineCapacity: Math.max(0, MAX_SALES_ORDER_LINES - order.lines.length),
    }
  }

  async productOptions(
    salesOrderId: string,
    input: SalesOrderAddOnProductOptionsInput,
  ) {
    const context = await this.context(salesOrderId)
    const supplierValue = await this.assertEffectiveSupplier(input.supplierValue)

    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const keyword = input.keyword?.trim().normalize('NFKC')
    const where: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      supplierValue,
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
    const currencyCode = context.salesOrder.currencyCode
    const items = rows.map(row => mapSalesOrderProductOption(
      row,
      currencyCode,
      (productId, productMediaId) => (
        `/api/sales-orders/${salesOrderId}/add-on-product-options/${productId}/main-image/${productMediaId}/content?supplierValue=${encodeURIComponent(supplierValue)}`
      ),
    ))
    return { items, page, pageSize, total }
  }

  async assertEffectiveSupplier(input: string): Promise<string> {
    let supplierValue: string
    try {
      supplierValue = normalizeDictionaryItemValue(input)
    }
    catch {
      return supplierUnavailable()
    }
    const supplier = await this.dictionaryLookup.resolveStoredValue({
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      value: supplierValue,
    })
    if (supplier.known !== true || !supplier.effectiveEnabled) {
      return supplierUnavailable()
    }
    return supplierValue
  }
}
