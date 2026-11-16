import type { Readable } from 'node:stream'

import { HttpStatus, Injectable } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import { AssistantMediaUrlService } from './assistant-media-url'

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 60
const RATE_LIMIT_BUCKET_LIMIT = 10_000

export interface NotificationMediaContent {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly stream?: Readable
}

function contentDisposition(filename: string): string {
  const safe = filename.split(/[\\/]/u).at(-1)?.replace(/[^A-Za-z0-9._ -]/gu, '_').slice(0, 180) || 'notification-image'
  return `inline; filename="${safe}"`
}

/**
 * 匿名取流窗口的进程内限流。
 *
 * 只防「链接泄露后被反复拉取」，不做账号或 IP 画像；多实例部署时每个实例
 * 各自计数，nginx 侧的 limit_req 才是全局边界。
 */
@Injectable()
export class AssistantMediaRateLimiter {
  private readonly buckets = new Map<string, { windowStart: number, count: number }>()

  check(key: string, now: number = Date.now()): boolean {
    const bucket = this.buckets.get(key)
    if (bucket === undefined || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      if (this.buckets.size >= RATE_LIMIT_BUCKET_LIMIT) {
        this.prune(now)
      }
      this.buckets.set(key, { windowStart: now, count: 1 })
      return true
    }
    bucket.count += 1
    return bucket.count <= RATE_LIMIT_MAX_REQUESTS
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
        this.buckets.delete(key)
      }
    }
  }
}

/**
 * 公开取流：只认识签名 token，不依赖 Session、权限或数据范围。
 *
 * 这里刻意不区分「token 无效」「附件已不可用」「投递已取消」——统一 404，
 * 避免匿名探测者通过错误差异推断内部状态。
 */
@Injectable()
export class AssistantMediaDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaUrl: AssistantMediaUrlService,
    private readonly delivery: MediaContentDeliveryService,
    private readonly rateLimiter: AssistantMediaRateLimiter = new AssistantMediaRateLimiter(),
  ) {}

  async resolve(token: string, method: 'GET' | 'HEAD', rateLimitKey: string): Promise<NotificationMediaContent> {
    if (!this.rateLimiter.check(rateLimitKey)) {
      throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', '请求过于频繁')
    }

    const verification = this.mediaUrl.verify(token)
    if (!verification.ok) {
      throw this.notFound()
    }

    const row = await this.prisma.assistantDeliveryMedia.findFirst({
      where: {
        id: verification.deliveryMediaId,
        status: { in: ['PENDING', 'SENDING', 'ACCEPTED', 'PARTIAL'] },
        delivery: { status: { in: ['PENDING', 'SENDING', 'ACCEPTED', 'PARTIAL'] } },
        mediaAsset: {
          status: 'READY',
          deletedAt: null,
          mediaType: 'IMAGE',
          objectKey: { not: null },
          mimeType: { not: null },
          sizeBytes: { not: null },
        },
      },
      select: {
        id: true,
        fetchedAt: true,
        mediaAsset: {
          select: { objectKey: true, mimeType: true, sizeBytes: true, originalFilename: true },
        },
      },
    })
    if (
      row === null
      || row.mediaAsset.objectKey === null
      || row.mediaAsset.mimeType === null
      || row.mediaAsset.sizeBytes === null
    ) {
      throw this.notFound()
    }

    const objectKey = requireMediaObjectKeyNamespace(row.mediaAsset.objectKey, 'assets')
    if (row.fetchedAt === null) {
      // 只记录首次拉取；写入失败不能影响取流本身。
      await this.prisma.assistantDeliveryMedia.updateMany({
        where: { id: row.id, fetchedAt: null },
        data: { fetchedAt: new Date() },
      }).catch(() => undefined)
    }

    const headers: Record<string, string> = {
      'Accept-Ranges': 'none',
      'Content-Disposition': contentDisposition(row.mediaAsset.originalFilename),
      'Content-Type': row.mediaAsset.mimeType,
      'Content-Length': row.mediaAsset.sizeBytes.toString(),
      'X-Content-Type-Options': 'nosniff',
    }
    if (method === 'HEAD') {
      return { status: HttpStatus.OK, headers }
    }

    try {
      const stored = await this.delivery.open(objectKey)
      return { status: HttpStatus.OK, headers, stream: stored.stream }
    }
    catch {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'MEDIA_STORAGE_UNAVAILABLE', '媒体存储暂时不可用')
    }
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, 'NOTIFICATION_MEDIA_NOT_FOUND', '通知附件不存在')
  }
}
