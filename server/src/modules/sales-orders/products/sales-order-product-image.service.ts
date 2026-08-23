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
    'SALES_ORDER_PRODUCT_IMAGE_NOT_FOUND',
    '产品主图不存在或当前不可用',
  )
}

/**
 * 录单主图是销售候选资格的一部分，不等于产品媒体管理读取权限。每次内容请求都
 * 重新校验产品、币种价格和主图关系，再把可信内容交给既有媒体交付服务处理。
 */
@Injectable()
export class SalesOrderProductImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ProductMediaContentService,
  ) {}

  async resolve(
    productId: string,
    productMediaId: string,
    currencyCode: 'TWD' | 'MYR',
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
              ...(currencyCode === 'TWD'
                ? { twdSalePriceAmount: { not: null } }
                : { myrSalePriceAmount: { not: null } }),
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
}
