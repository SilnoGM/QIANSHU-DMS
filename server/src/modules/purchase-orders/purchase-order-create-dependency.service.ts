import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma, type Prisma as PrismaTypes } from '../../generated/prisma/client'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AccessControlService } from '../access-control/access-control.service'
import {
  DictionaryLookupService,
  DictionaryValueUnavailableError,
} from '../dictionaries/dictionary-lookup.service'
import type {
  NormalizedPurchaseOrderCatalogLine,
  NormalizedPurchaseOrderCreateCommand,
} from './purchase-order-command.normalizer'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const STOCK_CREATE_PERMISSION = 'purchase-orders:create-stock'

interface SalesLineSnapshot {
  readonly id: string
  readonly salesOrderId: string
  readonly lineType: 'CATALOG' | 'CUSTOM'
  readonly productId: string | null
  readonly productNoSnapshot: string | null
  readonly productNameSnapshot: string
  readonly productAttributesSnapshot: unknown
  readonly descriptionSnapshot: string | null
  readonly quantity: number
}

interface ProductSnapshot {
  readonly id: string
  readonly productNo: string
  readonly name: string
  readonly attributes: unknown
  readonly status: 'DRAFT' | 'ACTIVE' | 'DISABLED'
  readonly supplierValue: string | null
  readonly purchaseCostAmount: {
    toFixed(decimalPlaces: number): string
  } | null
  readonly purchaseCostCurrency: string
}

export interface EffectivePurchaseOrderLine {
  readonly lineNumber: number
  readonly lineType: 'CATALOG' | 'CUSTOM'
  readonly productId: string | null
  readonly sourceSalesOrderLineId: string | null
  readonly productNoSnapshot: string | null
  readonly productNameSnapshot: string
  readonly productAttributesSnapshot: PrismaTypes.InputJsonValue
  readonly descriptionSnapshot: string | null
  readonly referencePurchaseUnitPriceAmount: string
  readonly actualPurchaseUnitPriceAmount: string
  readonly quantity: number
  readonly lineTotalAmount: string
}

export interface EffectivePurchaseOrderCreateDependencies {
  readonly lines: readonly EffectivePurchaseOrderLine[]
}

function purchaseDependencyFailure(
  code: string,
  message: string,
  status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
): never {
  throw new ApiException(status, code, message)
}

function normalizeAttributes(value: unknown): PrismaTypes.InputJsonValue {
  if (!Array.isArray(value)) {
    return purchaseDependencyFailure(
      'PURCHASE_ORDER_PRODUCT_SNAPSHOT_INVALID',
      '采购产品快照当前不可用',
    )
  }
  return value as PrismaTypes.InputJsonValue
}

function fixedPurchaseCost(product: ProductSnapshot): string {
  if (
    product.purchaseCostAmount === null
    || product.purchaseCostCurrency !== 'CNY'
  ) {
    return purchaseDependencyFailure(
      'PURCHASE_ORDER_PRODUCT_COST_UNAVAILABLE',
      '所选产品缺少有效的人民币采购成本',
    )
  }
  try {
    return product.purchaseCostAmount.toFixed(4)
  }
  catch {
    return purchaseDependencyFailure(
      'PURCHASE_ORDER_PRODUCT_COST_UNAVAILABLE',
      '所选产品缺少有效的人民币采购成本',
    )
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

@Injectable()
export class PurchaseOrderCreateDependencyService {
  constructor(
    private readonly dictionaryLookup: DictionaryLookupService,
    private readonly accessControl: AccessControlService,
  ) {}

  async requireDependencies(
    transaction: PrismaTypes.TransactionClient,
    command: NormalizedPurchaseOrderCreateCommand,
    actorUserId: string,
    options: { readonly lockSalesLines: boolean },
  ): Promise<EffectivePurchaseOrderCreateDependencies> {
    await this.requireSupplier(transaction, command.supplierValue)
    await this.requireCurrency(transaction)
    if (command.purchaseType === 'STOCK') {
      await this.requireStockPermission(transaction, actorUserId)
    }

    const sourceIds = uniqueSorted(command.lines.flatMap(line => (
      line.sourceSalesOrderLineId === null
        ? []
        : [line.sourceSalesOrderLineId]
    )))
    if (options.lockSalesLines && sourceIds.length > 0) {
      await this.lockSalesLines(transaction, sourceIds)
    }

    const salesLinesById = await this.loadSalesLines(
      transaction,
      command,
      sourceIds,
    )
    const productsById = await this.loadProducts(transaction, command)
    if (command.purchaseType === 'SALES_LINKED') {
      await this.assertRemainingQuantities(
        transaction,
        command,
        salesLinesById,
      )
    }
    const lines = command.lines.map(line => this.resolveLine(
      command,
      line,
      salesLinesById,
      productsById,
    ))
    return Object.freeze({ lines: Object.freeze(lines) })
  }

  private async requireSupplier(
    transaction: PrismaTypes.TransactionClient,
    supplierValue: string,
  ): Promise<void> {
    try {
      await this.dictionaryLookup.requireEffectiveValue(transaction, {
        dictionaryCode: SUPPLIER_DICTIONARY_CODE,
        value: supplierValue,
      })
    }
    catch (error) {
      if (error instanceof DictionaryValueUnavailableError) {
        return purchaseDependencyFailure(
          'PURCHASE_ORDER_SUPPLIER_UNAVAILABLE',
          '供应商当前不可用',
        )
      }
      throw error
    }
  }

  private async requireCurrency(
    transaction: PrismaTypes.TransactionClient,
  ): Promise<void> {
    const currency = await transaction.currency.findFirst({
      where: { code: 'CNY', enabled: true },
      select: { code: true },
    })
    if (currency === null) {
      return purchaseDependencyFailure(
        'PURCHASE_ORDER_CURRENCY_UNAVAILABLE',
        '人民币币种当前不可用',
      )
    }
  }

  private async requireStockPermission(
    transaction: PrismaTypes.TransactionClient,
    actorUserId: string,
  ): Promise<void> {
    const granted = await this.accessControl.getPermissionCodesInTransaction(
      transaction,
      actorUserId,
    )
    if (!this.accessControl.hasAll(granted, [STOCK_CREATE_PERMISSION])) {
      return purchaseDependencyFailure(
        'FORBIDDEN',
        '无权创建备货采购订单',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  private async lockSalesLines(
    transaction: PrismaTypes.TransactionClient,
    sourceIds: readonly string[],
  ): Promise<void> {
    const ids = sourceIds.map(id => Prisma.sql`CAST(${id} AS uuid)`)
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "sales_order_lines"
      WHERE "id" IN (${Prisma.join(ids)})
        AND "removed_at" IS NULL
      ORDER BY "id"
      FOR UPDATE
    `)
    if (rows.length !== sourceIds.length) {
      return purchaseDependencyFailure(
        'PURCHASE_ORDER_SOURCE_LINE_INVALID',
        '销售来源明细当前不可用',
      )
    }
  }

  private async loadSalesLines(
    transaction: PrismaTypes.TransactionClient,
    command: NormalizedPurchaseOrderCreateCommand,
    sourceIds: readonly string[],
  ): Promise<ReadonlyMap<string, SalesLineSnapshot>> {
    if (command.purchaseType === 'STOCK') return new Map()
    const salesOrder = await transaction.salesOrder.findFirst({
      where: {
        id: command.salesOrderId ?? undefined,
        orderStatus: 'CONFIRMED',
      },
      select: { id: true },
    })
    if (salesOrder === null) {
      return purchaseDependencyFailure(
        'PURCHASE_ORDER_SOURCE_ORDER_INVALID',
        '销售来源订单当前不可用',
      )
    }
    const rows = await transaction.salesOrderLine.findMany({
      where: { id: { in: [...sourceIds] }, removedAt: null },
      select: {
        id: true,
        salesOrderId: true,
        lineType: true,
        productId: true,
        productNoSnapshot: true,
        productNameSnapshot: true,
        productAttributesSnapshot: true,
        descriptionSnapshot: true,
        quantity: true,
      },
    })
    if (rows.length !== sourceIds.length) {
      return purchaseDependencyFailure(
        'PURCHASE_ORDER_SOURCE_LINE_INVALID',
        '销售来源明细当前不可用',
      )
    }
    return new Map(rows.map(row => [row.id, row as SalesLineSnapshot]))
  }

  private async loadProducts(
    transaction: PrismaTypes.TransactionClient,
    command: NormalizedPurchaseOrderCreateCommand,
  ): Promise<ReadonlyMap<string, ProductSnapshot>> {
    const catalogLines = command.lines.filter(
      (line): line is NormalizedPurchaseOrderCatalogLine => (
        line.lineType === 'CATALOG'
      ),
    )
    const productIds = uniqueSorted(catalogLines.map(line => line.productId))
    if (productIds.length === 0) return new Map()
    const rows = await transaction.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        productNo: true,
        name: true,
        attributes: true,
        status: true,
        supplierValue: true,
        purchaseCostAmount: true,
        purchaseCostCurrency: true,
      },
    })
    if (rows.length !== productIds.length) {
      return purchaseDependencyFailure(
        'PURCHASE_ORDER_PRODUCT_UNAVAILABLE',
        '所选产品已停用或不存在',
      )
    }
    return new Map(rows.map(row => [row.id, row as ProductSnapshot]))
  }

  private async assertRemainingQuantities(
    transaction: PrismaTypes.TransactionClient,
    command: NormalizedPurchaseOrderCreateCommand,
    salesLinesById: ReadonlyMap<string, SalesLineSnapshot>,
  ): Promise<void> {
    const requestedBySource = new Map<string, number>()
    for (const line of command.lines) {
      const sourceId = line.sourceSalesOrderLineId
      if (sourceId === null) {
        return purchaseDependencyFailure(
          'PURCHASE_ORDER_SOURCE_LINE_INVALID',
          '销售来源明细当前不可用',
        )
      }
      requestedBySource.set(
        sourceId,
        (requestedBySource.get(sourceId) ?? 0) + line.quantity,
      )
    }
    const activeRows = await transaction.purchaseOrderLine.groupBy({
      by: ['sourceSalesOrderLineId'],
      where: {
        sourceSalesOrderLineId: { in: [...requestedBySource.keys()] },
        purchaseOrder: { orderStatus: { not: 'CANCELLED' } },
      },
      _sum: { quantity: true },
    })
    const activeBySource = new Map(activeRows.map(row => [
      row.sourceSalesOrderLineId,
      row._sum.quantity ?? 0,
    ]))
    for (const [sourceId, requested] of requestedBySource) {
      const source = salesLinesById.get(sourceId)
      if (
        source === undefined
        || (activeBySource.get(sourceId) ?? 0) + requested > source.quantity
      ) {
        return purchaseDependencyFailure(
          'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED',
          '采购数量超过销售明细剩余可采购数量',
        )
      }
    }
  }

  private resolveLine(
    command: NormalizedPurchaseOrderCreateCommand,
    line: NormalizedPurchaseOrderCreateCommand['lines'][number],
    salesLinesById: ReadonlyMap<string, SalesLineSnapshot>,
    productsById: ReadonlyMap<string, ProductSnapshot>,
  ): EffectivePurchaseOrderLine {
    const source = line.sourceSalesOrderLineId === null
      ? null
      : salesLinesById.get(line.sourceSalesOrderLineId) ?? null
    if (
      command.purchaseType === 'SALES_LINKED'
      && (
        source === null
        || source.salesOrderId !== command.salesOrderId
        || source.lineType !== line.lineType
        || (
          line.lineType === 'CATALOG'
          && source.productId !== line.productId
        )
      )
    ) {
      return purchaseDependencyFailure(
        'PURCHASE_ORDER_SOURCE_LINE_INVALID',
        '销售来源明细与采购产品不匹配',
      )
    }

    if (line.lineType === 'CUSTOM') {
      return Object.freeze({
        lineNumber: line.lineNumber,
        lineType: line.lineType,
        productId: null,
        sourceSalesOrderLineId: line.sourceSalesOrderLineId,
        productNoSnapshot: null,
        // CUSTOM 允许采购侧修订名称和描述；销售明细仅作为来源、类型和数量的可信约束。
        productNameSnapshot: line.name,
        productAttributesSnapshot: source === null
          ? []
          : normalizeAttributes(source.productAttributesSnapshot),
        descriptionSnapshot: line.description,
        referencePurchaseUnitPriceAmount:
          line.referencePurchaseUnitPriceAmount,
        actualPurchaseUnitPriceAmount: line.actualPurchaseUnitPriceAmount,
        quantity: line.quantity,
        lineTotalAmount: line.lineTotalAmount,
      })
    }

    const product = productsById.get(line.productId)
    if (product === undefined || product.status !== 'ACTIVE') {
      return purchaseDependencyFailure(
        'PURCHASE_ORDER_PRODUCT_UNAVAILABLE',
        '所选产品已停用或不存在',
      )
    }
    if (product.supplierValue !== command.supplierValue) {
      return purchaseDependencyFailure(
        'PURCHASE_ORDER_PRODUCT_SUPPLIER_MISMATCH',
        '所选产品不属于当前采购供应商',
      )
    }
    const referencePurchaseUnitPriceAmount = fixedPurchaseCost(product)
    return Object.freeze({
      lineNumber: line.lineNumber,
      lineType: line.lineType,
      productId: product.id,
      sourceSalesOrderLineId: line.sourceSalesOrderLineId,
      productNoSnapshot: source?.productNoSnapshot ?? product.productNo,
      productNameSnapshot: source?.productNameSnapshot ?? product.name,
      productAttributesSnapshot: normalizeAttributes(
        source?.productAttributesSnapshot ?? product.attributes,
      ),
      descriptionSnapshot: source?.descriptionSnapshot ?? null,
      referencePurchaseUnitPriceAmount,
      actualPurchaseUnitPriceAmount: line.actualPurchaseUnitPriceAmount,
      quantity: line.quantity,
      lineTotalAmount: line.lineTotalAmount,
    })
  }
}
