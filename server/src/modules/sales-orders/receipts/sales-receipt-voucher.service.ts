import { createHash } from 'node:crypto'
import { Injectable, HttpStatus } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../../media/media-storage'
import { DataScopeService, dataScopeFallback, resolveDataScopeActor } from '../../access-control/data-scope.service'
import { salesOrderScopeWhere } from '../sales-order-access'
import { salesReceiptScopeWhere } from './sales-receipt-access'
import type { SalesOrderDocumentContentResponse } from '../documents/sales-order-document.service'
function contentDisposition(filename: string): string {
  const safe = filename.split(/[\\/]/u).at(-1)?.replace(/[^A-Za-z0-9._ -]/gu, '_').slice(0, 180) || 'document'
  return `inline; filename="${safe}"`
}
@Injectable()
export class SalesReceiptVoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: MediaContentDeliveryService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}
  async resolveContent(
    requestId: string,
    salesOrderId: string | undefined,
    ifNoneMatch: unknown,
    method: 'GET' | 'HEAD',
    actorUserId: string = resolveDataScopeActor(),
  ): Promise<SalesOrderDocumentContentResponse> {
    const scope = await this.dataScope.resolve(actorUserId)
    const row = await this.prisma.salesReceiptRequest.findFirst({
      where: {
        id: requestId,
        ...(salesOrderId ? { salesOrderId } : {}),
        salesOrder: { is: salesOrderScopeWhere(scope, actorUserId) },
        ...salesReceiptScopeWhere(scope, actorUserId),
        voucherMediaAsset: { status: 'READY', deletedAt: null },
      },
      select: {
        voucherMediaAsset: { select: {
          checksumSha256: true,
          mimeType: true,
          objectKey: true,
          originalFilename: true,
        } },
      },
    })
    if (
      row === null
      || row.voucherMediaAsset.objectKey === null
      || row.voucherMediaAsset.checksumSha256 === null
      || row.voucherMediaAsset.mimeType === null
    ) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SALES_ORDER_DOCUMENT_NOT_FOUND',
        '订单凭证不存在',
      )
    }
    const objectKey = requireMediaObjectKeyNamespace(
      row.voucherMediaAsset.objectKey,
      'assets',
    )
    const etag = `"sha256-${createHash('sha256')
      .update(`sales-order-document:${row.voucherMediaAsset.checksumSha256}`)
      .digest('base64url')}"`
    const headers: Record<string, string> = {
      'Accept-Ranges': 'none',
      'Content-Disposition': contentDisposition(row.voucherMediaAsset.originalFilename),
      'Content-Type': row.voucherMediaAsset.mimeType,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    }
    if (
      typeof ifNoneMatch === 'string'
      && ifNoneMatch.split(',').some(value => value.trim().replace(/^W\//u, '') === etag)
    ) {
      return { status: HttpStatus.NOT_MODIFIED, headers }
    }
    try {
      const stat = await this.delivery.stat(objectKey)
      if (stat === null) throw new Error('missing media object')
      headers['Content-Length'] = stat.sizeBytes.toString()
      if (this.delivery.mode === 'internal_redirect') {
        headers['X-Accel-Redirect'] = `/_qianshu_internal_media/${objectKey
          .split('/')
          .map(segment => encodeURIComponent(segment))
          .join('/')}`
        return { status: HttpStatus.OK, headers }
      }
      if (method === 'HEAD') return { status: HttpStatus.OK, headers }
      const stored = await this.delivery.open(objectKey)
      return { status: HttpStatus.OK, headers, stream: stored.stream }
    }
    catch {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'MEDIA_STORAGE_UNAVAILABLE',
        '媒体存储暂时不可用',
      )
    }
  }
}
