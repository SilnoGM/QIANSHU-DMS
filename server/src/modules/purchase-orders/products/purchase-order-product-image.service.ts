import { HttpStatus, Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import {
  ProductMediaContentService,
  type ProductMediaContentResponse,
} from '../../products/media/product-media-content.service'

function productImageNotFound(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    'PURCHASE_ORDER_PRODUCT_IMAGE_NOT_FOUND',
    '产品主图不存在或当前不可用',
  )
}

/**
 * 采购录单主图使用 purchase-orders:create 授权，不要求操作员同时具备产品媒体权限。
 * 每次读取内容都重新校验产品仍可采购且关系仍为当前主图，避免旧 URL 绕过候选资格。
 */
@Injectable()
export class PurchaseOrderProductImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ProductMediaContentService,
  ) {}

  async resolve(
    productId: string,
    productMediaId: string,
    ifNoneMatch: unknown,
    range: unknown,
    method: 'GET' | 'HEAD',
  ): Promise<ProductMediaContentResponse> {
    let row: { readonly id: string } | null
    try {
      row = await this.prisma.productMedia.findFirst({
        where: {
          id: productMediaId,
          productId,
          kind: 'IMAGE',
          isPrimary: true,
          detachedAt: null,
          mediaAsset: { is: { status: 'READY' } },
          product: {
            is: {
              status: 'ACTIVE',
              supplierValue: { not: null },
              purchaseCostAmount: { not: null },
              purchaseCostCurrency: 'CNY',
            },
          },
        },
        select: { id: true },
      })
    }
    catch {
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_ERROR',
        '服务器内部错误',
      )
    }
    if (row === null) throw productImageNotFound()

    return this.content.resolve(
      productId,
      productMediaId,
      ifNoneMatch,
      range,
      method,
    )
  }

  /**
   * 采购来源弹窗读取的是销售订单快照所引用目录产品的当前主图。授权边界属于
   * purchase-orders:create，因此每次内容请求都重新校验来源订单仍为已确认、
   * 明细仍指向该目录产品，并且媒体仍是当前 READY 主图，避免复用销售读取权限。
   */
  async resolveSourceLinePreview(
    salesOrderId: string,
    lineId: string,
    productMediaId: string,
    ifNoneMatch: unknown,
    range: unknown,
    method: 'GET' | 'HEAD',
  ): Promise<ProductMediaContentResponse> {
    let line: { readonly productId: string | null } | null
    try {
      line = await this.prisma.salesOrderLine.findFirst({
        where: {
          id: lineId,
          salesOrderId,
          lineType: 'CATALOG',
          productId: { not: null },
          salesOrder: { is: { orderStatus: 'CONFIRMED' } },
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
    catch {
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_ERROR',
        '服务器内部错误',
      )
    }
    if (line === null || line.productId === null) throw productImageNotFound()

    return this.content.resolve(
      line.productId,
      productMediaId,
      ifNoneMatch,
      range,
      method,
    )
  }
}
