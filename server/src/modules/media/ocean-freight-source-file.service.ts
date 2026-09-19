import { createHash } from 'node:crypto'
import { HttpStatus, Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { ApiException } from '../../infrastructure/http/api.exception'
import { MediaAssetService } from './media-asset.service'
import { MediaContentDeliveryService } from './media-content-delivery.service'
import { MEDIA_CONTENT_SIZE_LIMITS } from './media-validation'

export const OCEAN_FREIGHT_SOURCE_UPLOAD_PURPOSE = 'OCEAN_FREIGHT_SOURCE_XLSX'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function unavailable(): never {
  throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'OCEAN_FREIGHT_SOURCE_FILE_UNAVAILABLE', '所选海运来源文件当前不可用')
}

@Injectable()
export class OceanFreightSourceFileService {
  constructor(
    private readonly media: MediaAssetService,
    private readonly delivery: MediaContentDeliveryService,
  ) {}

  /**
   * 来源文件激活与主表挂载必须共用事务；延迟引用约束在提交时检查真实挂载。
   * 锁媒体行防止回收并发，不允许把其他用途或其他上传人的文件据为业务来源。
   */
  async attach(transaction: Prisma.TransactionClient, mediaAssetId: string | null, actorUserId: string): Promise<void> {
    if (mediaAssetId === null) return
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(mediaAssetId)) unavailable()
    const locks = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM media_assets WHERE id = CAST(${mediaAssetId} AS uuid) FOR UPDATE
    `)
    if (locks.length !== 1) unavailable()
    const asset = await transaction.mediaAsset.findUnique({ where: { id: mediaAssetId } })
    if (!asset || asset.createdByUserId !== actorUserId || asset.deletedAt !== null
      || asset.uploadPurpose !== OCEAN_FREIGHT_SOURCE_UPLOAD_PURPOSE || asset.mediaType !== 'DOCUMENT'
      || asset.mimeType !== XLSX_MIME || !asset.objectKey || !asset.checksumSha256
      || !/^[a-f0-9]{64}$/u.test(asset.checksumSha256) || asset.sizeBytes === null
      || asset.sizeBytes <= 0n || asset.sizeBytes > MEDIA_CONTENT_SIZE_LIMITS.DOCUMENT
      || (asset.status !== 'READY' && asset.status !== 'UPLOADING')
      || (asset.status === 'UPLOADING' && (!asset.uploadExpiresAt || asset.uploadExpiresAt.getTime() <= Date.now()))) unavailable()

    try {
      const stat = await this.delivery.stat(asset.objectKey)
      if (!stat || stat.sizeBytes !== asset.sizeBytes) unavailable()
      // 元数据完整不代表实体仍完整，重新读取受限流并比对摘要，避免引用丢失或被替换的文件。
      const stored = await this.delivery.open(asset.objectKey)
      const hash = createHash('sha256')
      let size = 0n
      try {
        for await (const chunk of stored.stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
          size += BigInt(bytes.length)
          if (size > asset.sizeBytes) unavailable()
          hash.update(bytes)
        }
      }
      finally {
        stored.stream.destroy()
      }
      if (size !== asset.sizeBytes || hash.digest('hex') !== asset.checksumSha256) unavailable()
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'MEDIA_STORAGE_UNAVAILABLE', '文件存储暂时不可用，请稍后重试')
    }
    if (asset.status === 'UPLOADING') await this.media.activate(transaction, asset.id)
  }
}
