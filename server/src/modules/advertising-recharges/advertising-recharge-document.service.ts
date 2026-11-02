import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { MediaAssetLifecycleError, MediaAssetService } from '../media/media-asset.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { SalesOrderDocumentMultipartParser } from '../sales-orders/documents/sales-order-document-multipart.parser'
import {
  ADVERTISING_RECHARGE_EXTENSION_BY_MIME,
  ADVERTISING_RECHARGE_MEDIA_MAX_BYTES,
  ADVERTISING_RECHARGE_MEDIA_MIME_TYPES,
  ADVERTISING_RECHARGE_PROOF_POOL,
  ADVERTISING_RECHARGE_PROOF_UPLOAD_PURPOSE,
  ADVERTISING_RECHARGE_QR_POOL,
  ADVERTISING_RECHARGE_QR_UPLOAD_PURPOSE,
} from './advertising-recharge.contract'
import {
  ADVERTISING_RECHARGE_ERROR_CODES,
  advertisingRechargeFailure,
} from './advertising-recharge.errors'
import {
  buildAdvertisingRechargeProofFilename,
  buildAdvertisingRechargeQrFilename,
} from './advertising-recharge.logic'

export interface AdvertisingRechargeMediaUpload {
  readonly fileName: string
  readonly mediaAssetId: string
}

export interface AdvertisingRechargeMediaContent {
  headers: Record<string, string>
  stream?: Readable
}

export interface AdvertisingRechargeMediaAsset {
  readonly checksumSha256: string | null
  readonly mimeType: string | null
  readonly objectKey: string | null
  readonly originalFilename: string
  readonly sizeBytes: bigint | null
}

function buildContentFilename(originalFilename: string): string {
  return originalFilename.replace(/[^A-Za-z0-9._ -]/gu, '_').slice(0, 180) || 'advertising-recharge.jpg'
}

function requireSupportedImage(declaredMimeType: string | null, code: string, message: string): string {
  if (
    declaredMimeType === null
    || !ADVERTISING_RECHARGE_MEDIA_MIME_TYPES.includes(declaredMimeType as (typeof ADVERTISING_RECHARGE_MEDIA_MIME_TYPES)[number])
  ) {
    advertisingRechargeFailure(code, message)
  }
  const extension = ADVERTISING_RECHARGE_EXTENSION_BY_MIME[declaredMimeType]
  if (extension === undefined) {
    advertisingRechargeFailure(code, message)
  }
  return extension
}

function mapUploadError(error: unknown, labels: { invalid: string, tooLarge: string, unavailable: string }): never {
  if (error instanceof MediaAssetLifecycleError) {
    if (error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') {
      advertisingRechargeFailure(labels.tooLarge, '图片不能超过 10 MiB')
    }
    if (['MEDIA_ASSET_STORAGE_FAILED', 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE', 'MEDIA_ASSET_PERSISTENCE_FAILED'].includes(error.code)) {
      advertisingRechargeFailure('MEDIA_STORAGE_UNAVAILABLE', '图片存储暂时不可用', 503)
    }
    advertisingRechargeFailure(labels.invalid, '图片内容无效，请重新选择后上传')
  }
  if (error instanceof ApiException) {
    if (error.code === 'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE') {
      advertisingRechargeFailure(labels.tooLarge, '图片不能超过 10 MiB')
    }
    if (error.code === 'SALES_ORDER_DOCUMENT_MULTIPART_INVALID') {
      advertisingRechargeFailure(labels.invalid, '每次只能上传一张图片')
    }
    throw error
  }
  advertisingRechargeFailure('MEDIA_STORAGE_UNAVAILABLE', `${labels.unavailable}存储暂时不可用`, 503)
}

/**
 * 广告充值的两处图片证据：申请人收款二维码（创建前暂存）与财务付款截图（付款时暂存）。
 * 两者用途独立，提交事务内认领并激活，避免任意临时上传被业务引用。
 */
@Injectable()
export class AdvertisingRechargeDocumentService {
  private readonly multipart = new SalesOrderDocumentMultipartParser()

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaAssetService,
    private readonly delivery: MediaContentDeliveryService,
  ) {}

  /** 创建前上传二维码：此时申请单还不存在，因此只校验上传人与图片形状。 */
  async stageQr(actorUserId: string, request: SalesOrderDocumentMultipartRequest): Promise<AdvertisingRechargeMediaUpload> {
    const applicant = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { displayName: true },
    })
    if (applicant === null) {
      advertisingRechargeFailure(ADVERTISING_RECHARGE_ERROR_CODES.NOT_FOUND, '申请人不存在', 404)
    }
    try {
      return await this.multipart.parse(request, async (input) => {
        if (input.mediaType !== 'IMAGE') {
          advertisingRechargeFailure(
            ADVERTISING_RECHARGE_ERROR_CODES.QR_INVALID,
            '请上传 jpg、png 或 webp 格式的收款二维码',
          )
        }
        const extension = requireSupportedImage(
          input.declaredMimeType,
          ADVERTISING_RECHARGE_ERROR_CODES.QR_INVALID,
          '请上传 jpg、png 或 webp 格式的收款二维码',
        )
        const fileName = buildAdvertisingRechargeQrFilename({
          displayName: applicant.displayName,
          extension,
          uploadedAt: new Date(),
        })
        const asset = await this.media.prepare({
          actorUserId,
          allowedTypes: ['IMAGE'],
          requestedType: 'IMAGE',
          declaredMimeType: input.declaredMimeType,
          originalFilename: fileName,
          pool: ADVERTISING_RECHARGE_QR_POOL,
          stream: input.stream,
        })
        const marked = await this.prisma.mediaAsset.updateMany({
          where: { id: asset.id, status: 'UPLOADING', createdByUserId: actorUserId, uploadPurpose: null },
          data: { uploadPurpose: ADVERTISING_RECHARGE_QR_UPLOAD_PURPOSE },
        })
        if (marked.count !== 1) {
          advertisingRechargeFailure(
            ADVERTISING_RECHARGE_ERROR_CODES.QR_UNAVAILABLE,
            '上传状态已变化，请重新上传',
            409,
          )
        }
        return { mediaAssetId: asset.id, fileName }
      })
    }
    catch (error) {
      return mapUploadError(error, {
        invalid: ADVERTISING_RECHARGE_ERROR_CODES.QR_INVALID,
        tooLarge: ADVERTISING_RECHARGE_ERROR_CODES.QR_TOO_LARGE,
        unavailable: '收款二维码',
      })
    }
  }

  /** 财务上传付款截图：只允许待付款申请，且上传人就是认领人。 */
  async stageProof(actorUserId: string, id: string, request: SalesOrderDocumentMultipartRequest): Promise<AdvertisingRechargeMediaUpload> {
    const row = await this.prisma.advertisingRechargeRequest.findUnique({
      where: { id },
      select: { status: true, rechargeAmount: true, applicant: { select: { displayName: true } } },
    })
    if (row === null) {
      advertisingRechargeFailure(ADVERTISING_RECHARGE_ERROR_CODES.NOT_FOUND, '广告充值申请不存在', 404)
    }
    if (row.status !== 'PENDING') {
      advertisingRechargeFailure(
        ADVERTISING_RECHARGE_ERROR_CODES.STATUS_NOT_ALLOWED,
        '只有待付款的申请可以上传付款截图',
        409,
      )
    }
    try {
      return await this.multipart.parse(request, async (input) => {
        if (input.mediaType !== 'IMAGE') {
          advertisingRechargeFailure(
            ADVERTISING_RECHARGE_ERROR_CODES.PROOF_INVALID,
            '请上传 jpg、png 或 webp 格式的付款截图',
          )
        }
        const extension = requireSupportedImage(
          input.declaredMimeType,
          ADVERTISING_RECHARGE_ERROR_CODES.PROOF_INVALID,
          '请上传 jpg、png 或 webp 格式的付款截图',
        )
        const fileName = buildAdvertisingRechargeProofFilename({
          amount: row.rechargeAmount.toFixed(2),
          displayName: row.applicant.displayName,
          extension,
          uploadedAt: new Date(),
        })
        const asset = await this.media.prepare({
          actorUserId,
          allowedTypes: ['IMAGE'],
          requestedType: 'IMAGE',
          declaredMimeType: input.declaredMimeType,
          originalFilename: fileName,
          pool: ADVERTISING_RECHARGE_PROOF_POOL,
          stream: input.stream,
        })
        const marked = await this.prisma.mediaAsset.updateMany({
          where: { id: asset.id, status: 'UPLOADING', createdByUserId: actorUserId, uploadPurpose: null },
          data: { uploadPurpose: ADVERTISING_RECHARGE_PROOF_UPLOAD_PURPOSE },
        })
        if (marked.count !== 1) {
          advertisingRechargeFailure(
            ADVERTISING_RECHARGE_ERROR_CODES.PROOF_UNAVAILABLE,
            '上传状态已变化，请重新上传',
            409,
          )
        }
        return { mediaAssetId: asset.id, fileName }
      })
    }
    catch (error) {
      return mapUploadError(error, {
        invalid: ADVERTISING_RECHARGE_ERROR_CODES.PROOF_INVALID,
        tooLarge: ADVERTISING_RECHARGE_ERROR_CODES.PROOF_TOO_LARGE,
        unavailable: '付款截图',
      })
    }
  }

  /**
   * 提交/付款事务内认领图片：锁媒体行、校验归属/用途/形状/对象字节，必要时激活。
   * 任何一步失败整体回滚，申请保持原状态，暂存媒体可在有效期内容重试。
   */
  async attach(
    transaction: Prisma.TransactionClient,
    input: {
      readonly actorUserId: string
      readonly mediaAssetId: string
      readonly purpose: typeof ADVERTISING_RECHARGE_QR_UPLOAD_PURPOSE | typeof ADVERTISING_RECHARGE_PROOF_UPLOAD_PURPOSE
      readonly unavailableCode: string
      readonly label: string
    },
  ): Promise<void> {
    const locks = await transaction.$queryRaw<Array<{ readonly id: string }>>(Prisma.sql`
      SELECT id FROM media_assets WHERE id = CAST(${input.mediaAssetId} AS uuid) FOR UPDATE
    `)
    if (locks.length !== 1) {
      advertisingRechargeFailure(input.unavailableCode, `所选${input.label}当前不可用`, 409)
    }
    const asset = await transaction.mediaAsset.findUnique({ where: { id: input.mediaAssetId } })
    if (
      asset === null
      || asset.createdByUserId !== input.actorUserId
      || asset.deletedAt !== null
      || asset.uploadPurpose !== input.purpose
      || asset.mediaType !== 'IMAGE'
      || asset.mimeType === null
      || !ADVERTISING_RECHARGE_MEDIA_MIME_TYPES.includes(asset.mimeType as (typeof ADVERTISING_RECHARGE_MEDIA_MIME_TYPES)[number])
      || asset.objectKey === null
      || asset.checksumSha256 === null
      || !/^[a-f0-9]{64}$/u.test(asset.checksumSha256)
      || asset.sizeBytes === null
      || asset.sizeBytes <= 0n
      || asset.sizeBytes > ADVERTISING_RECHARGE_MEDIA_MAX_BYTES
      || (asset.status !== 'READY' && asset.status !== 'UPLOADING')
      || (asset.status === 'UPLOADING'
        && (asset.uploadExpiresAt === null || asset.uploadExpiresAt.getTime() <= Date.now()))
    ) {
      advertisingRechargeFailure(input.unavailableCode, `所选${input.label}当前不可用`, 409)
    }

    try {
      const key = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
      const stat = await this.delivery.stat(key)
      if (stat === null || stat.sizeBytes !== asset.sizeBytes) {
        advertisingRechargeFailure(input.unavailableCode, `所选${input.label}当前不可用`, 409)
      }
      const stored = await this.delivery.open(key)
      const hash = createHash('sha256')
      let size = 0n
      try {
        for await (const chunk of stored.stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
          size += BigInt(bytes.length)
          if (size > asset.sizeBytes) {
            advertisingRechargeFailure(input.unavailableCode, `所选${input.label}当前不可用`, 409)
          }
          hash.update(bytes)
        }
      }
      finally {
        stored.stream.destroy()
      }
      if (size !== asset.sizeBytes || hash.digest('hex') !== asset.checksumSha256) {
        advertisingRechargeFailure(input.unavailableCode, `所选${input.label}当前不可用`, 409)
      }
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      advertisingRechargeFailure('MEDIA_STORAGE_UNAVAILABLE', `${input.label}存储暂时不可用，请稍后重试`, 503)
    }

    if (asset.status === 'UPLOADING') {
      await this.media.activate(transaction, asset.id)
    }
  }

  async content(
    asset: AdvertisingRechargeMediaAsset,
    method: 'GET' | 'HEAD',
    unavailableCode: string,
  ): Promise<AdvertisingRechargeMediaContent> {
    if (
      asset.objectKey === null
      || asset.sizeBytes === null
      || asset.mimeType === null
      || !ADVERTISING_RECHARGE_MEDIA_MIME_TYPES.includes(asset.mimeType as (typeof ADVERTISING_RECHARGE_MEDIA_MIME_TYPES)[number])
    ) {
      advertisingRechargeFailure(unavailableCode, '这条申请还没有可读取的图片', 404)
    }
    try {
      const key = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
      const stat = await this.delivery.stat(key)
      if (stat === null || stat.sizeBytes !== asset.sizeBytes) {
        advertisingRechargeFailure('MEDIA_STORAGE_UNAVAILABLE', '图片暂时无法读取', 503)
      }
      const headers: Record<string, string> = {
        'Content-Type': asset.mimeType,
        'Content-Length': stat.sizeBytes.toString(),
        'Content-Disposition': ['inline; filename="', buildContentFilename(asset.originalFilename), '"'].join(''),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'none',
      }
      if (this.delivery.mode === 'internal_redirect') {
        headers['X-Accel-Redirect'] = ['/_qianshu_internal_media/', key.split('/').map(encodeURIComponent).join('/')].join('')
        return { headers }
      }
      return method === 'HEAD'
        ? { headers }
        : { headers, stream: (await this.delivery.open(key)).stream }
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      advertisingRechargeFailure('MEDIA_STORAGE_UNAVAILABLE', '图片暂时无法读取', 503)
    }
  }
}
