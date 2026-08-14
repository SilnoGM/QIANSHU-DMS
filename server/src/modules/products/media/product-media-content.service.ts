import { createHash } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'
import type { Prisma } from '../../../generated/prisma/client'

import {
  MediaAssetStatus,
  MediaType,
  ProductMediaKind,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { requireMediaObjectKeyNamespace } from '../../media/media-storage'
import {
  productMediaInternalError,
  productMediaNotFoundError,
} from './product-media.errors'

const PRODUCT_MEDIA_CONTENT_SELECT = {
  kind: true,
  mediaAsset: {
    select: {
      checksumSha256: true,
      mediaType: true,
      mimeType: true,
      objectKey: true,
      originalFilename: true,
      status: true,
    },
  },
} satisfies Prisma.ProductMediaSelect

type ProductMediaContentRow = Prisma.ProductMediaGetPayload<{
  select: typeof PRODUCT_MEDIA_CONTENT_SELECT
}>

type ProductMediaContentHeaderName =
  | 'Accept-Ranges'
  | 'Content-Disposition'
  | 'Content-Type'
  | 'ETag'
  | 'X-Accel-Redirect'
  | 'X-Content-Type-Options'

export interface ProductMediaContentResponse {
  readonly status: HttpStatus.OK | HttpStatus.NOT_MODIFIED
  readonly headers: Partial<Record<ProductMediaContentHeaderName, string>> & {
    readonly 'Accept-Ranges': 'bytes'
    readonly ETag: string
    readonly 'X-Content-Type-Options': 'nosniff'
  }
}

interface TrustedContentType {
  readonly extension: '.jpg' | '.mp4' | '.png' | '.webp'
  readonly mediaType: (typeof MediaType)['IMAGE' | 'VIDEO']
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4'
}

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/u
const CONTENT_TYPES = new Map<string, TrustedContentType>([
  ['image/jpeg', {
    extension: '.jpg',
    mediaType: MediaType.IMAGE,
    mimeType: 'image/jpeg',
  }],
  ['image/png', {
    extension: '.png',
    mediaType: MediaType.IMAGE,
    mimeType: 'image/png',
  }],
  ['image/webp', {
    extension: '.webp',
    mediaType: MediaType.IMAGE,
    mimeType: 'image/webp',
  }],
  ['video/mp4', {
    extension: '.mp4',
    mediaType: MediaType.VIDEO,
    mimeType: 'video/mp4',
  }],
])

function requireTrustedContentType(
  row: ProductMediaContentRow,
): TrustedContentType {
  const contentType = typeof row.mediaAsset.mimeType === 'string'
    ? CONTENT_TYPES.get(row.mediaAsset.mimeType)
    : undefined
  const matchesKind =
    contentType?.mediaType === row.mediaAsset.mediaType
    && ((row.kind === ProductMediaKind.IMAGE
      && row.mediaAsset.mediaType === MediaType.IMAGE)
    || (row.kind === ProductMediaKind.VIDEO
      && row.mediaAsset.mediaType === MediaType.VIDEO))

  if (contentType === undefined || !matchesKind) {
    throw productMediaNotFoundError()
  }

  return contentType
}

/**
 * Content-Disposition 只使用经过净化的 ASCII 文件名。
 *
 * 原始文件名可能含路径、引号、控制字符或非 ASCII 字符，因此不能直接进入响应头。
 * 这里不提供 filename*，避免把未经确认的用户输入以另一种编码重新注入 Header。
 */
function sanitizeAsciiFilename(
  originalFilename: string,
  extension: TrustedContentType['extension'],
): string {
  const leaf = originalFilename.split(/[\\/]/u).at(-1) ?? ''
  const normalized = leaf
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^A-Za-z0-9._ -]/gu, '_')
    .replace(/\s+/gu, ' ')
    .replace(/_+/gu, '_')
    .trim()
    .replace(/^[. ]+|[. ]+$/gu, '')
    .slice(0, 180)

  if (normalized.length === 0 || normalized === '.' || normalized === '..') {
    return `media${extension}`
  }

  return normalized
}

function buildOpaqueEtag(checksumSha256: string): string {
  // 对数据库 checksum 再做带命名空间的单向摘要，避免把内容摘要本身作为公开标识。
  const digest = createHash('sha256')
    .update(`product-media-content:${checksumSha256}`)
    .digest('base64url')
  return `"sha256-${digest}"`
}

function matchesIfNoneMatch(value: unknown, etag: string): boolean {
  if (typeof value !== 'string') return false

  const candidates = value.split(',').map(candidate => candidate.trim())
  return candidates.some((candidate) => {
    if (candidate === '*') return true
    const normalized = candidate.startsWith('W/')
      ? candidate.slice(2).trim()
      : candidate
    return normalized === etag
  })
}

function buildInternalRedirect(objectKey: string): string {
  // 每个 canonical segment 独立编码，确保生成值始终停留在受保护的内部 URI 空间。
  const encodedKey = objectKey
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
  return `/_qianshu_internal_media/${encodedKey}`
}

@Injectable()
export class ProductMediaContentService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    productId: string,
    productMediaId: string,
    ifNoneMatch: unknown,
  ): Promise<ProductMediaContentResponse> {
    let row: ProductMediaContentRow | null

    try {
      row = await this.prisma.productMedia.findFirst({
        where: {
          id: productMediaId,
          productId,
          detachedAt: null,
          mediaAsset: { is: { status: MediaAssetStatus.READY } },
        },
        select: PRODUCT_MEDIA_CONTENT_SELECT,
      })
    } catch {
      // 数据库异常不得把 SQL、连接信息或持久化细节暴露给内容请求方。
      throw productMediaInternalError()
    }

    if (row === null) throw productMediaNotFoundError()

    let objectKey: string
    let contentType: TrustedContentType
    let checksumSha256: string

    try {
      if (
        row.mediaAsset.status !== MediaAssetStatus.READY
        || typeof row.mediaAsset.originalFilename !== 'string'
        || row.mediaAsset.originalFilename.length === 0
        || typeof row.mediaAsset.checksumSha256 !== 'string'
        || !CHECKSUM_PATTERN.test(row.mediaAsset.checksumSha256)
      ) {
        throw productMediaNotFoundError()
      }

      contentType = requireTrustedContentType(row)
      checksumSha256 = row.mediaAsset.checksumSha256
      objectKey = requireMediaObjectKeyNamespace(
        row.mediaAsset.objectKey,
        'assets',
      )

      if (!objectKey.endsWith(contentType.extension)) {
        throw productMediaNotFoundError()
      }
    } catch {
      // 缺失、已脱离、状态不一致与不安全持久化元数据统一为防枚举 404。
      throw productMediaNotFoundError()
    }

    const etag = buildOpaqueEtag(checksumSha256)
    const commonHeaders = {
      'Accept-Ranges': 'bytes' as const,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff' as const,
    }

    if (matchesIfNoneMatch(ifNoneMatch, etag)) {
      return {
        status: HttpStatus.NOT_MODIFIED,
        headers: commonHeaders,
      }
    }

    const filename = sanitizeAsciiFilename(
      row.mediaAsset.originalFilename,
      contentType.extension,
    )

    return {
      status: HttpStatus.OK,
      headers: {
        ...commonHeaders,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Type': contentType.mimeType,
        'X-Accel-Redirect': buildInternalRedirect(objectKey),
      },
    }
  }
}
