import { Injectable } from '@nestjs/common'

import type { ProductMediaItem } from './product-media-query.mapper'
import type { ProductListItem } from '../product-query.mapper'
import { ProductQueryService } from '../product-query.service'
import type {
  ProductMediaDetachRequestDto,
  ProductMediaLayoutRequestDto,
} from '../dto/product-media.dto'
import type { ProductMediaCommandContext } from './product-media.command'
import { productMediaInternalError } from './product-media.errors'
import {
  ProductMediaMultipartParser,
  type ProductMediaMultipartRequest,
} from './product-media-multipart.parser'
import { ProductMediaService } from './product-media.service'

export interface ProductMediaUploadResponse {
  readonly product: ProductListItem
  readonly media: ProductMediaItem
}

/**
 * HTTP 编排层只负责 multipart、可信请求上下文和响应快照组合；版本、锁、
 * 数量、布局、MediaAsset 生命周期与 Audit 仍全部由 ProductMediaService 持有。
 */
@Injectable()
export class ProductMediaHttpService {
  constructor(
    private readonly domain: ProductMediaService,
    private readonly multipart: ProductMediaMultipartParser,
    private readonly products: ProductQueryService,
  ) {}

  upload(
    context: ProductMediaCommandContext,
    productId: string,
    request: ProductMediaMultipartRequest,
  ): Promise<ProductMediaUploadResponse> {
    return this.multipart.parse(request, async input => {
      const result = await this.domain.upload(context, productId, input)
      if (result.affectedProductMediaId === null) {
        throw productMediaInternalError()
      }

      const product = await this.products.getById(productId)
      const media = [...product.media.images, ...product.media.videos]
        .find(item => item.id === result.affectedProductMediaId)
      if (media === undefined) throw productMediaInternalError()
      return { product, media }
    })
  }

  async updateLayout(
    context: ProductMediaCommandContext,
    productId: string,
    input: ProductMediaLayoutRequestDto,
  ): Promise<ProductListItem> {
    await this.domain.updateLayout(context, productId, input)
    return this.products.getById(productId)
  }

  async detach(
    context: ProductMediaCommandContext,
    productId: string,
    productMediaId: string,
    input: ProductMediaDetachRequestDto,
  ): Promise<ProductListItem> {
    await this.domain.detach(context, productId, productMediaId, input)
    return this.products.getById(productId)
  }
}
