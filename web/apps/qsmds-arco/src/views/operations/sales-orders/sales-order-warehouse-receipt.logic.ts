import type {
  SalesOrderWarehouseReceiptContextDto,
  SalesOrderWarehouseReceiptRequestDto,
  SalesOrderWarehouseReceiptResultDto,
} from '../../../api/generated/types.gen'

const CANONICAL_UTC_ISO_PATTERN
  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u

export interface WarehouseReceiptProductView {
  readonly purchaseOrderLineId: string
  readonly lineNumber: number
  readonly quantity: number
  readonly productName: string | null
  readonly productNo: string | null
  readonly description: string | null
  readonly imageSrc: string | null
}

export interface WarehouseReceiptPartView {
  readonly id: string
  readonly shipmentNo: string | null
  readonly partNumber: number
  readonly shippingMarkText: string | null
  readonly shippedAt: string
  readonly trackingNo: string | null
  readonly products: readonly WarehouseReceiptProductView[]
}

export interface WarehouseReceiptOrderView {
  readonly id: string
  readonly orderNo: string
  readonly supplierLabel: string
  readonly receivedPartCount: number
  readonly parts: readonly WarehouseReceiptPartView[]
}

export interface SalesWarehouseReceiptIntent {
  readonly targets: readonly {
    readonly purchaseOrderId: string
    readonly expectedVersion: number
    readonly partIds: readonly string[]
  }[]
  readonly receivedAt: string
  readonly remark?: string
}

export type SalesWarehouseReceiptValidationError
  = | 'remark'
    | 'selection'
    | 'time'
    | 'timeRange'

/** 按采购单分组只保留展示所需字段；产品信息通过 lineSummary.previews 回填。 */
export function createWarehouseReceiptOrders(
  context: SalesOrderWarehouseReceiptContextDto | null,
): readonly WarehouseReceiptOrderView[] {
  if (context === null) {
    return []
  }
  return context.purchaseOrders.map((order) => {
    const previews = new Map(order.lineSummary.previews.map(preview => [preview.lineId, preview]))
    return {
      id: order.id,
      orderNo: order.orderNo,
      supplierLabel: order.supplier.label,
      receivedPartCount: order.receivedPartCount,
      parts: [...order.parts]
        .sort((left, right) => left.partNumber - right.partNumber)
        .map(part => ({
          id: part.id,
          shipmentNo: part.shipmentNo,
          partNumber: part.partNumber,
          shippingMarkText: part.shippingMarkText,
          // 服务端上下文只返回已发货且未入仓的货件，shippedAt 必然存在。
          shippedAt: part.shippedAt!,
          trackingNo: part.trackingNo,
          products: [...part.items]
            .sort((left, right) => left.lineNumber - right.lineNumber)
            .map((item) => {
              const preview = previews.get(item.purchaseOrderLineId)
              return {
                purchaseOrderLineId: item.purchaseOrderLineId,
                lineNumber: item.lineNumber,
                quantity: item.quantity,
                productName: preview?.productName ?? null,
                productNo: preview?.productNo ?? null,
                description: preview?.description ?? null,
                imageSrc: preview?.mainImage?.contentUrl ?? null,
              }
            }),
        })),
    }
  })
}

export function countWarehouseReceiptParts(
  orders: readonly WarehouseReceiptOrderView[],
): number {
  return orders.reduce((sum, order) => sum + order.parts.length, 0)
}

export function defaultWarehouseReceiptSelection(
  orders: readonly WarehouseReceiptOrderView[],
): string[] {
  const parts = orders.flatMap(order => order.parts)
  return parts.length === 1 ? [parts[0]!.id] : []
}

/** 入仓时间必须不早于所有已选货件的发货时间，因此下限取最大值而不是最小值。 */
export function warehouseReceiptMinimumReceivedAt(
  orders: readonly WarehouseReceiptOrderView[],
  selectedIds: readonly string[],
): string | undefined {
  const selected = new Set(selectedIds)
  const timestamps = orders
    .flatMap(order => order.parts)
    .filter(part => selected.has(part.id))
    .map(part => Date.parse(part.shippedAt))
    .filter(value => Number.isFinite(value))
  if (timestamps.length === 0) {
    return undefined
  }
  return new Date(Math.max(...timestamps)).toISOString()
}

export function buildSalesWarehouseReceiptIntent(input: {
  readonly orders: readonly WarehouseReceiptOrderView[]
  readonly context: SalesOrderWarehouseReceiptContextDto
  readonly selectedIds: readonly string[]
  readonly receivedAt: string
  readonly remark: string
  readonly now: Date
}): { valid: true, request: SalesWarehouseReceiptIntent } | { valid: false, error: SalesWarehouseReceiptValidationError } {
  const selected = new Set(input.selectedIds)
  const selectedParts = input.orders.flatMap(order => order.parts.filter(part => selected.has(part.id)))
  if (selectedParts.length === 0 || selectedParts.length !== input.selectedIds.length) {
    return { valid: false, error: 'selection' }
  }
  const date = new Date(input.receivedAt)
  if (
    !CANONICAL_UTC_ISO_PATTERN.test(input.receivedAt)
    || !Number.isFinite(date.getTime())
    || date.toISOString() !== input.receivedAt
  ) {
    return { valid: false, error: 'time' }
  }
  if (
    date.getTime() > input.now.getTime()
    || selectedParts.some(part => date.getTime() < Date.parse(part.shippedAt))
  ) {
    return { valid: false, error: 'timeRange' }
  }
  const remark = input.remark.trim()
  if ([...remark].length > 500) {
    return { valid: false, error: 'remark' }
  }
  const versionById = new Map(
    input.context.purchaseOrders.map(order => [order.id, order.version]),
  )
  const targets = input.orders
    .map(order => ({
      purchaseOrderId: order.id,
      expectedVersion: versionById.get(order.id) ?? 0,
      partIds: order.parts
        .filter(part => selected.has(part.id))
        .map(part => part.id)
        .sort(),
    }))
    .filter(target => target.partIds.length > 0)
    .sort((left, right) => left.purchaseOrderId.localeCompare(right.purchaseOrderId))
  if (targets.some(target => target.expectedVersion < 1)) {
    return { valid: false, error: 'selection' }
  }
  return {
    valid: true,
    request: {
      targets,
      receivedAt: input.receivedAt,
      ...(remark === '' ? {} : { remark }),
    },
  }
}

export function toWarehouseReceiptRequest(
  intent: SalesWarehouseReceiptIntent,
): SalesOrderWarehouseReceiptRequestDto {
  return {
    targets: intent.targets.map(target => ({
      purchaseOrderId: target.purchaseOrderId,
      expectedVersion: target.expectedVersion,
      partIds: [...target.partIds],
    })),
    receivedAt: intent.receivedAt,
    ...(intent.remark === undefined ? {} : { remark: intent.remark }),
  }
}

/** 销售履约只由服务端推进；这里只翻译结果，不推断覆盖关系。 */
export function formatSalesWarehouseReceiptSuccess(
  result: SalesOrderWarehouseReceiptResultDto,
): string {
  if (result.changedPurchaseOrderCount === 0) {
    return '所选货件已入仓，未重复处理'
  }
  const base = `已完成 ${result.changedPurchaseOrderCount} 张采购单共 ${result.receivedPartCount} 件货件入仓`
  if (result.salesOrder.advancedToWarehouseArrived) {
    return `${base}，销售订单已进入待装柜`
  }
  return result.remainingPendingReceiptCount > 0
    ? `${base}，仍有 ${result.remainingPendingReceiptCount} 件待入仓`
    : base
}
