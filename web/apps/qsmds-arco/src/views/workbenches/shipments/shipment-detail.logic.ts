import type { PurchaseShipmentDetailDto } from '@/api/generated/types.gen'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'

type ShipmentItem = PurchaseShipmentDetailDto['items'][number]

function attributeText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value).trim()
    : ''
}

export function buildShipmentDetailProducts(items: readonly ShipmentItem[]) {
  return [...items].sort((left, right) => left.lineNumber - right.lineNumber).map((item) => {
    // 规格来自开单时保存的快照；仅渲染可读标量，保留 0 等有效历史值。
    const attributes = item.productAttributes
      .map(attribute => ({ title: attributeText(attribute.title), value: attributeText(attribute.value) }))
      .filter(attribute => attribute.title && attribute.value)
    const images: ImageGroupItem[] = item.mainImage?.contentUrl.trim()
      ? [{ key: item.purchaseOrderLineId, src: item.mainImage.contentUrl, alt: item.productName }]
      : []
    return { ...item, attributes, images }
  })
}

export function getShipmentMarkEmptyKey(status: PurchaseShipmentDetailDto['status']): string {
  return status === 'PENDING_REVIEW'
    ? 'purchaseShipmentDetail.pendingMark'
    : 'purchaseShipmentDetail.markNotRecorded'
}

export function getShipmentSourceEmptyKey(purchaseType: PurchaseShipmentDetailDto['purchaseOrder']['purchaseType']): string {
  return purchaseType === 'STOCK'
    ? 'purchaseShipmentDetail.stockSource'
    : 'purchaseShipmentDetail.sourceNotRecorded'
}
