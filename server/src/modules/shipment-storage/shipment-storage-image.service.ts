import { HttpStatus, Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { ProductMediaContentService, type ProductMediaContentResponse } from '../products/media/product-media-content.service'
import { readShipmentStorageAllocations } from './shipment-storage-allocation'

function storageProductImageNotFound(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    'SHIPMENT_STORAGE_PRODUCT_IMAGE_NOT_FOUND',
    '寄仓货件产品主图不存在或当前不可用',
  )
}

/**
 * 寄仓列表按 shipment-storage:read 可见，不能复用按采购单数据范围鉴权的采购图片接口。
 * 每次读取都重新校验寄仓快照、货件行关系和当前 READY 主图，避免 URL 成为越权入口。
 */
@Injectable()
export class ShipmentStorageImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ProductMediaContentService,
  ) {}

  async resolve(
    storageRecordId: string,
    lineId: string,
    productMediaId: string,
    ifNoneMatch: unknown,
    range: unknown,
    method: 'GET' | 'HEAD',
    variant: unknown,
  ): Promise<ProductMediaContentResponse> {
    let line: { readonly productId: string | null } | null
    try {
      const record = await this.prisma.shipmentStorageRecord.findUnique({
        where: { id: storageRecordId },
        select: {
          shipmentId: true,
          originPurchaseOrderId: true,
          originAllocations: true,
        },
      })
      const allocation = record === null
        ? undefined
        : readShipmentStorageAllocations(record.originAllocations)
          .find(item => item.lineId === lineId)
      if (record === null || allocation === undefined) {
        throw storageProductImageNotFound()
      }
      line = await this.prisma.purchaseOrderLine.findFirst({
        where: {
          id: lineId,
          purchaseOrderId: record.originPurchaseOrderId,
          lineType: 'CATALOG',
          productId: { not: null },
          partItems: { some: { purchaseOrderPartId: record.shipmentId } },
          product: {
            is: {
              media: {
                some: {
                  id: productMediaId,
                  kind: 'IMAGE',
                  isPrimary: true,
                  detachedAt: null,
                  mediaAsset: { is: { status: 'READY' } },
                },
              },
            },
          },
        },
        select: { productId: true },
      })
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_ERROR',
        '服务器内部错误',
      )
    }
    if (line === null || line.productId === null) throw storageProductImageNotFound()

    return this.content.resolve(
      line.productId,
      productMediaId,
      ifNoneMatch,
      range,
      method,
      variant,
    )
  }
}
