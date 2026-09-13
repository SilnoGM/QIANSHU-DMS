import type {
  PurchaseOrderDetailDto,
  PurchaseOrderLinePreviewDto,
  PurchaseOrderSourceSalesOrderListItemDto,
} from '@/api/generated/types.gen'
import type { OrderProductLineModel } from '@/components/business/QsOrderProductLineEditor/types'
import type { QsPurchaseOrderDescViewModel } from '@/components/business/QsPurchaseOrderDesc/types'

import Decimal from 'decimal.js'

import { validateMoneyString } from '../../../components/base/MoneyInput/logic'
import { calculatePurchaseOrderDraftTotal } from './purchase-order-create.logic'
import {
  fulfillmentStatusLabel,
  orderStatusLabel,
  paymentStatusLabel,
  purchaseTypeLabel,
} from './purchase-order-list.logic'

const FULFILLMENT_STATUS_TONES = {
  ORDERED: 'info',
  PREPARING: 'warning',
  PARTIALLY_SHIPPED: 'warning',
  SHIPPED: 'info',
  SIGNED: 'success',
} as const

const PAYMENT_STATUS_TONES = {
  PAID: 'success',
  PARTIALLY_PAID: 'warning',
  UNPAID: 'danger',
} as const

export interface PurchaseOrderCreateDescSource {
  readonly balanceDueAmount: null | string
  readonly depositDueAmount: null | string
  readonly issuerName: string
  readonly lines: readonly OrderProductLineModel[]
  readonly orderDate: string
  readonly purchaseTotalAmount: null | string
  readonly purchaseType: 'SALES_LINKED' | 'STOCK'
  readonly remark: string
  readonly salesOrder: null | Readonly<PurchaseOrderSourceSalesOrderListItemDto>
  readonly shippingMarkText: string
  readonly supplierLabel: string
}

function optionalDisplayText(value: null | string | undefined): null | string {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

/**
 * 新增页只展示当前认证用户，不允许业务人员改选采购经办人。认证刷新期间显示名
 * 可能为空，因此与全局账户语义一致，优先显示名、其次账号，最后给出稳定降级。
 */
export function resolvePurchaseOrderIssuerLabel(
  displayName: string,
  username: string,
): string {
  return optionalDisplayText(displayName)
    ?? optionalDisplayText(username)
    ?? '当前用户资料不可用'
}

/**
 * 将采购创建草稿复制并整理为组件专用只读模型。
 *
 * 行小计复用创建域既有的整数分单位计算，组件本身不接触金额算法；产品主图仅
 * 转换为 ImageGroup 所需的已授权地址，不持有图片或请求生命周期。
 */
export function mapPurchaseOrderCreateToDesc(
  source: Readonly<PurchaseOrderCreateDescSource>,
): QsPurchaseOrderDescViewModel {
  const purchaseTotalAmount = optionalDisplayText(source.purchaseTotalAmount)
  const total = validateMoneyString(purchaseTotalAmount, { precision: 4 })
  // 新单实际付款为零；零总价已付清，未填写或非法草稿不能被隐式当作零总价。
  const paymentStatus = total.valid && total.normalizedValue !== null
    && new Decimal(total.normalizedValue).isZero()
    ? 'PAID'
    : 'UNPAID'
  return {
    amounts: {
      balanceDueAmount: optionalDisplayText(source.balanceDueAmount),
      depositDueAmount: optionalDisplayText(source.depositDueAmount),
      lineSubtotalAmount: purchaseTotalAmount,
      outstandingAmount: null,
      paidAmount: null,
      purchaseTotalAmount,
    },
    createdAt: null,
    currencyCode: 'CNY',
    issuerName: optionalDisplayText(source.issuerName),
    lines: source.lines.map(line => ({
      actualPurchaseUnitPriceAmount: optionalDisplayText(line.actualUnitPriceAmount),
      description: optionalDisplayText(line.description),
      key: line.key,
      lineSubtotalAmount: calculatePurchaseOrderDraftTotal([line]),
      lineType: line.lineType,
      mainImage: line.mainImage === null
        ? null
        : {
            alt: optionalDisplayText(line.name) ?? '采购产品主图',
            src: line.mainImage.contentUrl,
          },
      productName: optionalDisplayText(line.name),
      productNo: optionalDisplayText(line.productNo),
      quantity: optionalDisplayText(line.quantity),
      referencePurchaseUnitPriceAmount: optionalDisplayText(line.standardUnitPriceAmount),
    })),
    orderDate: optionalDisplayText(source.orderDate),
    orderNo: null,
    purchaseTypeLabel: purchaseTypeLabel(source.purchaseType),
    remark: optionalDisplayText(source.remark),
    shippingMarkText: optionalDisplayText(source.shippingMarkText),
    source: {
      customerName: optionalDisplayText(source.salesOrder?.customerName),
      salesOrderNo: optionalDisplayText(source.salesOrder?.orderNo),
    },
    statuses: [
      { key: 'ORDER', label: '订单状态', tone: 'warning', value: orderStatusLabel('PENDING_REVIEW') },
      { key: 'FULFILLMENT', label: '履约状态', tone: 'info', value: fulfillmentStatusLabel('ORDERED') },
      { key: 'PAYMENT', label: '付款状态', tone: PAYMENT_STATUS_TONES[paymentStatus], value: paymentStatusLabel(paymentStatus) },
    ],
    supplierLabel: optionalDisplayText(source.supplierLabel),
    updatedAt: null,
  }
}

/** 正式详情 DTO 在页面边界映射，避免共享组件依赖 API 生成类型。 */
export function mapPurchaseOrderDetailToDesc(
  detail: Readonly<PurchaseOrderDetailDto>,
  linePreviews: readonly Readonly<PurchaseOrderLinePreviewDto>[] = [],
): QsPurchaseOrderDescViewModel {
  const mainImageByLineId = new Map(linePreviews.map(preview => [
    preview.lineId,
    preview.mainImage,
  ] as const))

  return {
    amounts: {
      balanceDueAmount: optionalDisplayText(detail.amounts.balanceDueAmount),
      depositDueAmount: optionalDisplayText(detail.amounts.depositDueAmount),
      lineSubtotalAmount: optionalDisplayText(detail.amounts.lineSubtotalAmount),
      outstandingAmount: optionalDisplayText(detail.amounts.outstandingAmount),
      paidAmount: optionalDisplayText(detail.amounts.paidAmount),
      purchaseTotalAmount: optionalDisplayText(detail.amounts.purchaseTotalAmount),
    },
    createdAt: optionalDisplayText(detail.createdAt),
    currencyCode: detail.currencyCode,
    issuerName: optionalDisplayText(detail.createdBy.displayName),
    lines: detail.lines.map((line) => {
      const mainImageSrc = optionalDisplayText(mainImageByLineId.get(line.id)?.contentUrl)
      return {
        actualPurchaseUnitPriceAmount: optionalDisplayText(line.actualPurchaseUnitPriceAmount),
        description: optionalDisplayText(line.description),
        key: line.id,
        lineSubtotalAmount: optionalDisplayText(line.lineTotalAmount),
        lineType: line.lineType,
        // 正式详情契约不含产品媒体，按行 ID 使用列表已经返回的同订单授权地址。
        mainImage: mainImageSrc === null
          ? null
          : {
              alt: optionalDisplayText(line.productName) ?? '采购产品主图',
              src: mainImageSrc,
            },
        productName: optionalDisplayText(line.productName),
        productNo: optionalDisplayText(line.productNo),
        quantity: String(line.quantity),
        referencePurchaseUnitPriceAmount: optionalDisplayText(line.referencePurchaseUnitPriceAmount),
      }
    }),
    orderDate: optionalDisplayText(detail.orderDate),
    orderNo: optionalDisplayText(detail.orderNo),
    purchaseTypeLabel: purchaseTypeLabel(detail.purchaseType),
    remark: optionalDisplayText(detail.remark),
    shippingMarkText: optionalDisplayText(detail.shippingMarkText),
    source: {
      customerName: optionalDisplayText(
        detail.sourceSalesOrder?.customerName ?? detail.customerName,
      ),
      salesOrderNo: optionalDisplayText(
        detail.sourceSalesOrder?.orderNo ?? detail.salesOrderNo,
      ),
    },
    statuses: [
      {
        key: 'ORDER',
        label: '订单状态',
        tone: detail.orderStatus === 'CANCELLED' ? 'danger' : detail.orderStatus === 'PENDING_REVIEW' ? 'warning' : 'success',
        value: orderStatusLabel(detail.orderStatus),
      },
      {
        key: 'FULFILLMENT',
        label: '履约状态',
        tone: FULFILLMENT_STATUS_TONES[detail.fulfillmentStatus],
        value: fulfillmentStatusLabel(detail.fulfillmentStatus),
      },
      {
        key: 'PAYMENT',
        label: '付款状态',
        tone: PAYMENT_STATUS_TONES[detail.paymentStatus],
        value: paymentStatusLabel(detail.paymentStatus),
      },
    ],
    supplierLabel: optionalDisplayText(detail.supplier.label),
    updatedAt: optionalDisplayText(detail.updatedAt),
  }
}
