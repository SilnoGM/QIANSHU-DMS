import type {
  SalesOrderDetailDto,
  SalesOrderLinePreviewDto,
} from '@/api/generated/types.gen'
import type { QsSalesOrderDescViewModel } from '@/components/business/QsSalesOrderDesc/types'

function optionalDisplayText(value: null | string | undefined): null | string {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

/**
 * 将服务端销售订单详情快照映射为展示组件的独立只读模型。
 *
 * 详情接口目前不提供产品媒体，主图按行 ID 从同一列表项的授权预览地址合并；附件
 * 只展示仍与订单保持关联的记录，避免已解除附件继续出现在当前订单快照中。
 */
export function mapSalesOrderDetailToDesc(
  detail: Readonly<SalesOrderDetailDto>,
  linePreviews: readonly Readonly<SalesOrderLinePreviewDto>[] = [],
): QsSalesOrderDescViewModel {
  const mainImageByLineId = new Map(linePreviews.map(preview => [
    preview.lineId,
    preview.mainImage,
  ] as const))

  return {
    amounts: {
      agreedTotalAmount: optionalDisplayText(detail.amounts.agreedTotalAmount),
      balanceDueAmount: optionalDisplayText(detail.amounts.balanceDueAmount),
      depositDueAmount: optionalDisplayText(detail.amounts.depositDueAmount),
      lineSubtotalAmount: optionalDisplayText(detail.amounts.lineSubtotalAmount),
    },
    currencyCode: detail.currencyCode,
    customer: {
      fullAddress: optionalDisplayText(detail.customer.fullAddress),
      name: optionalDisplayText(detail.customer.name),
      phone: optionalDisplayText(detail.customer.phone),
      regionNames: [
        detail.customer.countryRegion.name,
        detail.customer.provinceState.name,
        detail.customer.city.name,
      ].flatMap((name) => {
        const normalized = optionalDisplayText(name)
        return normalized === null ? [] : [normalized]
      }),
    },
    documents: detail.documents
      .filter(document => document.detachedAt === null)
      .map((document) => {
        const imageSource = document.mediaType === 'IMAGE'
          ? optionalDisplayText(document.contentUrl)
          : null
        return {
          documentType: document.documentType,
          key: document.id,
          mediaType: document.mediaType,
          originalFilename: document.originalFilename,
          previewSrc: imageSource,
          thumbnailSrc: imageSource,
          title: optionalDisplayText(document.title),
        }
      }),
    issuerName: optionalDisplayText(detail.issuer.displayName),
    lines: detail.lines.map((line) => {
      const mainImageSrc = optionalDisplayText(mainImageByLineId.get(line.id)?.contentUrl)
      return {
        actualUnitPriceAmount: optionalDisplayText(line.actualUnitPriceAmount),
        description: optionalDisplayText(line.description),
        key: line.id,
        lineSubtotalAmount: optionalDisplayText(line.lineTotalAmount),
        lineType: line.lineType,
        mainImage: mainImageSrc === null
          ? null
          : {
              alt: optionalDisplayText(line.productName) ?? '销售产品主图',
              src: mainImageSrc,
            },
        productName: optionalDisplayText(line.productName),
        productNo: optionalDisplayText(line.productNo),
        quantity: String(line.quantity),
      }
    }),
    orderDate: optionalDisplayText(detail.orderDate),
    orderNo: optionalDisplayText(detail.orderNo),
  }
}
