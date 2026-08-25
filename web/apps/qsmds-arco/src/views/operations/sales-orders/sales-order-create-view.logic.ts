import type { SalesOrderFormModel } from './sales-order-create.logic'
import type { QsSalesOrderDescViewModel } from '@/components/business/QsSalesOrderDesc/types'

import { calculateSalesOrderLineSubtotal } from './sales-order-create.logic'

export interface SalesOrderCreateDescContext {
  readonly amountPrecision: number
  readonly documentPreviewByKey: ReadonlyMap<string, string>
  readonly fullAddress: string
  readonly issuerName: string
  readonly lineSubtotalAmount: null | string
}

function optionalDisplayText(value: null | string | undefined): null | string {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

/**
 * 将新增表单的可编辑状态映射为独立的只读详情模型。
 *
 * mapper 不复用表单对象和数组引用，也不改写上传预览映射；创建页仍负责持有并
 * 回收 Object URL，QsSalesOrderDesc 只消费已经准备好的展示数据。
 */
export function mapSalesOrderCreateFormToDesc(
  model: Readonly<SalesOrderFormModel>,
  context: Readonly<SalesOrderCreateDescContext>,
): QsSalesOrderDescViewModel {
  return {
    amounts: {
      agreedTotalAmount: optionalDisplayText(model.agreedTotalAmount),
      balanceDueAmount: optionalDisplayText(model.balanceDueAmount),
      depositDueAmount: optionalDisplayText(model.depositDueAmount),
      lineSubtotalAmount: optionalDisplayText(context.lineSubtotalAmount),
    },
    currencyCode: model.currencyCode,
    customer: {
      fullAddress: optionalDisplayText(context.fullAddress),
      name: optionalDisplayText(model.customerName),
      phone: optionalDisplayText(model.customerPhone),
      regionNames: model.regionNames.flatMap((name) => {
        const normalized = optionalDisplayText(name)
        return normalized === null ? [] : [normalized]
      }),
    },
    documents: model.issuanceVoucher === null
      ? []
      : [model.issuanceVoucher].map((document) => {
          const imagePreview = document.mediaType === 'IMAGE'
            ? optionalDisplayText(context.documentPreviewByKey.get(document.key))
            : null
          return {
            documentType: 'ORDER_ISSUANCE_VOUCHER' as const,
            key: document.key,
            mediaType: document.mediaType,
            originalFilename: document.originalFilename,
            previewSrc: imagePreview,
            thumbnailSrc: imagePreview,
            title: optionalDisplayText(document.title),
          }
        }),
    issuerName: optionalDisplayText(context.issuerName),
    lines: model.lines.map(line => ({
      actualUnitPriceAmount: optionalDisplayText(line.actualUnitPriceAmount),
      key: line.key,
      lineSubtotalAmount: calculateSalesOrderLineSubtotal(
        [line],
        context.amountPrecision,
      ),
      lineType: line.lineType,
      productName: optionalDisplayText(line.name),
      productNo: optionalDisplayText(line.productNo),
      quantity: optionalDisplayText(line.quantity),
    })),
    orderDate: optionalDisplayText(model.orderDate),
    orderNo: null,
  }
}
