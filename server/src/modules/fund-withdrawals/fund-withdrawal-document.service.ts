import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { DataScopeService, dataScopeFallback } from '../access-control/data-scope.service'
import { MediaAssetLifecycleError, MediaAssetService } from '../media/media-asset.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { SalesOrderDocumentMultipartParser } from '../sales-orders/documents/sales-order-document-multipart.parser'
import {
  FUND_WITHDRAWAL_PAYMENT_PROOF_MAX_BYTES,
  FUND_WITHDRAWAL_PAYMENT_PROOF_MIME_TYPES,
  FUND_WITHDRAWAL_PAYMENT_PROOF_POOL,
  FUND_WITHDRAWAL_PAYMENT_PROOF_UPLOAD_PURPOSE,
  FUND_WITHDRAWAL_PROOF_EXTENSION_BY_MIME,
} from './fund-withdrawal.contract'
import {
  FUND_WITHDRAWAL_ERROR_CODES,
  fundWithdrawalFailure,
} from './fund-withdrawal.errors'
import { buildFundWithdrawalProofFilename } from './fund-withdrawal.logic'

export interface FundWithdrawalProofUpload {
  readonly fileName: string
  readonly mediaAssetId: string
}

export interface FundWithdrawalProofContent {
  headers: Record<string, string>
  stream?: Readable
}

function buildContentFilename(originalFilename: string): string {
  return originalFilename.replace(/[^A-Za-z0-9._ -]/gu, '_').slice(0, 180) || 'withdrawal-proof.jpg'
}

/** 付款截图：财务上传即暂存，审批事务内认领并激活；引用后必须保持 READY。 */
@Injectable()
export class FundWithdrawalDocumentService {
  private readonly multipart = new SalesOrderDocumentMultipartParser()

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaAssetService,
    private readonly delivery: MediaContentDeliveryService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  async stage(
    actorUserId: string,
    requestId: string,
    request: SalesOrderDocumentMultipartRequest,
  ): Promise<FundWithdrawalProofUpload> {
    const scope = await this.dataScope.resolve(actorUserId)
    const row = await this.prisma.fundWithdrawalRequest.findUnique({
      where: { id: requestId },
      select: {
        amount: true,
        status: true,
        userId: true,
        user: { select: { displayName: true } },
      },
    })
    if (row === null || (scope === 'SELF' && row.userId !== actorUserId)) {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.NOT_FOUND,
        '提款申请不存在',
        404,
      )
    }
    if (row.status !== 'PENDING') {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.STATUS_NOT_ALLOWED,
        '只有审核中的提款申请可以上传付款截图',
        409,
      )
    }

    try {
      return await this.multipart.parse(request, async (input) => {
        if (
          input.mediaType !== 'IMAGE'
          || input.declaredMimeType === null
          || !FUND_WITHDRAWAL_PAYMENT_PROOF_MIME_TYPES.includes(input.declaredMimeType as (typeof FUND_WITHDRAWAL_PAYMENT_PROOF_MIME_TYPES)[number])
        ) {
          fundWithdrawalFailure(
            FUND_WITHDRAWAL_ERROR_CODES.PROOF_INVALID,
            '请上传 jpg、png 或 webp 格式的付款截图',
          )
        }
        const extension = FUND_WITHDRAWAL_PROOF_EXTENSION_BY_MIME[input.declaredMimeType]
        if (extension === undefined) {
          fundWithdrawalFailure(
            FUND_WITHDRAWAL_ERROR_CODES.PROOF_INVALID,
            '请上传 jpg、png 或 webp 格式的付款截图',
          )
        }
        const fileName = buildFundWithdrawalProofFilename({
          amount: row.amount.toFixed(2),
          displayName: row.user.displayName,
          extension,
          uploadedAt: new Date(),
        })
        const asset = await this.media.prepare({
          actorUserId,
          allowedTypes: ['IMAGE'],
          requestedType: 'IMAGE',
          declaredMimeType: input.declaredMimeType,
          originalFilename: fileName,
          pool: FUND_WITHDRAWAL_PAYMENT_PROOF_POOL,
          stream: input.stream,
        })
        const marked = await this.prisma.mediaAsset.updateMany({
          where: {
            id: asset.id,
            status: 'UPLOADING',
            createdByUserId: actorUserId,
            uploadPurpose: null,
          },
          data: { uploadPurpose: FUND_WITHDRAWAL_PAYMENT_PROOF_UPLOAD_PURPOSE },
        })
        if (marked.count !== 1) {
          fundWithdrawalFailure(
            FUND_WITHDRAWAL_ERROR_CODES.PROOF_UNAVAILABLE,
            '上传状态已变化，请重新上传',
            409,
          )
        }
        return { mediaAssetId: asset.id, fileName }
      })
    }
    catch (error) {
      if (error instanceof MediaAssetLifecycleError) {
        if (error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') {
          fundWithdrawalFailure(
            FUND_WITHDRAWAL_ERROR_CODES.PROOF_TOO_LARGE,
            '付款截图不能超过 10 MiB',
          )
        }
        if (['MEDIA_ASSET_STORAGE_FAILED', 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE', 'MEDIA_ASSET_PERSISTENCE_FAILED'].includes(error.code)) {
          fundWithdrawalFailure('MEDIA_STORAGE_UNAVAILABLE', '付款截图存储暂时不可用', 503)
        }
        fundWithdrawalFailure(
          FUND_WITHDRAWAL_ERROR_CODES.PROOF_INVALID,
          '付款截图内容无效，请重新选择后上传',
        )
      }
      if (error instanceof ApiException) {
        if (error.code === 'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE') {
          fundWithdrawalFailure(
            FUND_WITHDRAWAL_ERROR_CODES.PROOF_TOO_LARGE,
            '付款截图不能超过 10 MiB',
          )
        }
        if (error.code === 'SALES_ORDER_DOCUMENT_MULTIPART_INVALID') {
          fundWithdrawalFailure(
            FUND_WITHDRAWAL_ERROR_CODES.PROOF_INVALID,
            '每次只能上传一张付款截图',
          )
        }
        throw error
      }
      fundWithdrawalFailure('MEDIA_STORAGE_UNAVAILABLE', '付款截图存储暂时不可用', 503)
    }
  }

  /**
   * 审批事务内认领截图：锁媒体行、校验归属/用途/形状/对象字节，必要时激活。
   * 认证失败整体回滚，申请保持审核中；暂存媒体可在有效期内容重试。
   */
  async attach(
    transaction: Prisma.TransactionClient,
    input: { readonly actorUserId: string, readonly mediaAssetId: string },
  ): Promise<void> {
    const locks = await transaction.$queryRaw<Array<{ readonly id: string }>>(Prisma.sql`
      SELECT id FROM media_assets WHERE id = CAST(${input.mediaAssetId} AS uuid) FOR UPDATE
    `)
    if (locks.length !== 1) {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.PROOF_UNAVAILABLE,
        '所选付款截图当前不可用',
        409,
      )
    }
    const asset = await transaction.mediaAsset.findUnique({
      where: { id: input.mediaAssetId },
    })
    if (
      asset === null
      || asset.createdByUserId !== input.actorUserId
      || asset.deletedAt !== null
      || asset.uploadPurpose !== FUND_WITHDRAWAL_PAYMENT_PROOF_UPLOAD_PURPOSE
      || asset.mediaType !== 'IMAGE'
      || asset.mimeType === null
      || !FUND_WITHDRAWAL_PAYMENT_PROOF_MIME_TYPES.includes(asset.mimeType as (typeof FUND_WITHDRAWAL_PAYMENT_PROOF_MIME_TYPES)[number])
      || asset.objectKey === null
      || asset.checksumSha256 === null
      || !/^[a-f0-9]{64}$/u.test(asset.checksumSha256)
      || asset.sizeBytes === null
      || asset.sizeBytes <= 0n
      || asset.sizeBytes > FUND_WITHDRAWAL_PAYMENT_PROOF_MAX_BYTES
      || (asset.status !== 'READY' && asset.status !== 'UPLOADING')
      || (asset.status === 'UPLOADING'
        && (asset.uploadExpiresAt === null || asset.uploadExpiresAt.getTime() <= Date.now()))
    ) {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.PROOF_UNAVAILABLE,
        '所选付款截图当前不可用',
        409,
      )
    }

    try {
      const key = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
      const stat = await this.delivery.stat(key)
      if (stat === null || stat.sizeBytes !== asset.sizeBytes) {
        fundWithdrawalFailure(
          FUND_WITHDRAWAL_ERROR_CODES.PROOF_UNAVAILABLE,
          '所选付款截图当前不可用',
          409,
        )
      }
      const stored = await this.delivery.open(key)
      const hash = createHash('sha256')
      let size = 0n
      try {
        for await (const chunk of stored.stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
          size += BigInt(bytes.length)
          if (size > asset.sizeBytes) {
            fundWithdrawalFailure(
              FUND_WITHDRAWAL_ERROR_CODES.PROOF_UNAVAILABLE,
              '所选付款截图当前不可用',
              409,
            )
          }
          hash.update(bytes)
        }
      }
      finally {
        stored.stream.destroy()
      }
      if (size !== asset.sizeBytes || hash.digest('hex') !== asset.checksumSha256) {
        fundWithdrawalFailure(
          FUND_WITHDRAWAL_ERROR_CODES.PROOF_UNAVAILABLE,
          '所选付款截图当前不可用',
          409,
        )
      }
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      fundWithdrawalFailure('MEDIA_STORAGE_UNAVAILABLE', '付款截图存储暂时不可用，请稍后重试', 503)
    }

    if (asset.status === 'UPLOADING') {
      await this.media.activate(transaction, asset.id)
    }
  }

  async content(
    asset: {
      readonly checksumSha256: string | null
      readonly mimeType: string | null
      readonly objectKey: string | null
      readonly originalFilename: string
      readonly sizeBytes: bigint | null
    },
    method: 'GET' | 'HEAD',
  ): Promise<FundWithdrawalProofContent> {
    if (
      asset.objectKey === null
      || asset.sizeBytes === null
      || asset.mimeType === null
      || !FUND_WITHDRAWAL_PAYMENT_PROOF_MIME_TYPES.includes(asset.mimeType as (typeof FUND_WITHDRAWAL_PAYMENT_PROOF_MIME_TYPES)[number])
    ) {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.PROOF_UNAVAILABLE,
        '这条提款申请还没有付款截图',
        404,
      )
    }
    try {
      const key = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
      const stat = await this.delivery.stat(key)
      if (stat === null || stat.sizeBytes !== asset.sizeBytes) {
        fundWithdrawalFailure('MEDIA_STORAGE_UNAVAILABLE', '付款截图暂时无法读取', 503)
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
      fundWithdrawalFailure('MEDIA_STORAGE_UNAVAILABLE', '付款截图暂时无法读取', 503)
    }
  }
}
