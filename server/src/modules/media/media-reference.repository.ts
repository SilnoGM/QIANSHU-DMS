import type { Prisma } from '../../generated/prisma/client'

/**
 * 当前系统真正实现的媒体领域引用表。
 *
 * 该常量同时被 contract test 与数据库 Trigger 测试校验。未来增加订单、采购或仓库媒体关联表时，
 * 必须在同一交付中扩展这里和数据库 Trigger，不能让新引用绕过回收保护。
 */
export const MEDIA_ASSET_REFERENCE_TABLES = Object.freeze([
  'product_media',
] as const)

type MediaReferenceReader = Pick<Prisma.TransactionClient, 'productMedia'>

/**
 * 媒体基础设施只通过显式领域表判断引用，不使用多态 owner 或动态注册表。
 */
export class MediaAssetReferenceRepository {
  async hasActiveReferences(
    reader: MediaReferenceReader,
    assetId: string,
  ): Promise<boolean> {
    const reference = await reader.productMedia.findFirst({
      where: {
        detachedAt: null,
        mediaAssetId: assetId,
      },
      select: { id: true },
    })
    return reference !== null
  }
}
