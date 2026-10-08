import { HttpStatus, Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import {
  ProductMediaContentService,
  type ProductMediaContentResponse,
} from '../../products/media/product-media-content.service'
import { SalesOrderProductEditQueryService } from '../sales-order-product-edit-query.service'

function productImageNotFound(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    'SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND',
    '产品主图不存在或当前不可用',
  )
}

/**
 * 录单主图是销售候选资格的一部分，不等于产品媒体管理读取权限。每次内容请求都
 * 重新校验有效产品和主图关系，再把可信内容交给既有媒体交付服务处理。订单币种
 * 仅为既有内容 URL 的请求上下文，不再构成产品或主图的可选资格。
 */
@Injectable()
export class SalesOrderProductImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ProductMediaContentService,
    private readonly productEditQueries?: SalesOrderProductEditQueryService,
  ) {}

  async resolve(
    productId: string,
    productMediaId: string,
    currencyCode: 'TWD' | 'MYR',
    ifNoneMatch: unknown,
    range: unknown,
    method: 'GET' | 'HEAD',
    variant: unknown,
  ): Promise<ProductMediaContentResponse> {
    void currencyCode
    return this.resolveProductOptionImage(
      productId,
      productMediaId,
      ifNoneMatch,
      range,
      method,
      variant,
    )
  }

  /**
   * 已保存订单的列表摘要读取当前目录主图，但不能要求产品仍处于可销售状态；历史订单
   * 里的产品即使后来停用，具备 sales-orders:read 的用户仍应看到其当前有效主图。
   */
  async resolveListPreview(
    salesOrderId: string,
    lineId: string,
    productMediaId: string,
    ifNoneMatch: unknown,
    range: unknown,
    method: 'GET' | 'HEAD',
    variant: unknown,
  ): Promise<ProductMediaContentResponse> {
    let line: { readonly productId: string | null } | null
    try {
      line = await this.prisma.salesOrderLine.findFirst({
        where: {
          id: lineId,
          salesOrderId,
          removedAt: null,
          lineType: 'CATALOG',
          productId: { not: null },
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
      variant,
    )
  }

  async resolveProductEditOption(
    salesOrderId: string,
    productId: string,
    productMediaId: string,
    ifNoneMatch: unknown,
    range: unknown,
    method: 'GET' | 'HEAD',
    variant: unknown,
  ): Promise<ProductMediaContentResponse> {
    if (this.productEditQueries === undefined) {
      throw new Error('SalesOrderProductEditQueryService is not configured')
    }
    // 图片 URL 可能被长期缓存或复制，内容读取时必须重验订单修改资格与当前产品状态。
    await this.productEditQueries.context(salesOrderId)
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
          product: { is: { status: 'ACTIVE' } },
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
      variant,
    )
  }

  private async resolveProductOptionImage(
    productId: string,
    productMediaId: string,
    ifNoneMatch: unknown,
    range: unknown,
    method: 'GET' | 'HEAD',
    variant: unknown,
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
          product: { is: { status: 'ACTIVE' } },
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
      variant,
    )
  }
}
