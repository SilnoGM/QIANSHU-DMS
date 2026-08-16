import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { HttpStatus, Injectable } from '@nestjs/common'
import type { Prisma } from '../../../generated/prisma/client'

import {
  MediaAssetStatus,
  MediaType,
  ProductMediaKind,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import {
  type MediaByteRange,
  requireMediaObjectKeyNamespace,
} from '../../media/media-storage'
import {
  productMediaInternalError,
  productMediaNotFoundError,
  productMediaStorageUnavailableError,
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
  | 'Content-Length'
  | 'Content-Range'
  | 'Content-Type'
  | 'ETag'
  | 'X-Accel-Redirect'
  | 'X-Content-Type-Options'

export interface ProductMediaContentResponse {
  readonly status:
    | HttpStatus.NOT_MODIFIED
    | HttpStatus.OK
    | HttpStatus.PARTIAL_CONTENT
    | HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE
  readonly headers: Partial<Record<ProductMediaContentHeaderName, string>> & {
    readonly 'Accept-Ranges': 'bytes'
    readonly ETag: string
    readonly 'X-Content-Type-Options': 'nosniff'
  }
  readonly stream?: Readable
}

interface TrustedContentType {
  readonly extension: '.jpg' | '.m4v' | '.mov' | '.mp4' | '.png' | '.webm' | '.webp'
  readonly mediaType: (typeof MediaType)['IMAGE' | 'VIDEO']
  readonly mimeType:
    | 'image/jpeg'
    | 'image/png'
    | 'image/webp'
    | 'video/mp4'
    | 'video/quicktime'
    | 'video/webm'
    | 'video/x-m4v'
}

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/u
const INVALID_RANGE = Symbol('qianshu.product-media.invalid-range')
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
  ['video/quicktime', {
    extension: '.mov',
    mediaType: MediaType.VIDEO,
    mimeType: 'video/quicktime',
  }],
  ['video/webm', {
    extension: '.webm',
    mediaType: MediaType.VIDEO,
    mimeType: 'video/webm',
  }],
  ['video/x-m4v', {
    extension: '.m4v',
    mediaType: MediaType.VIDEO,
    mimeType: 'video/x-m4v',
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
  enforceCanonicalExtension: boolean,
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

  if (!enforceCanonicalExtension) return normalized

  // 视频原始文件名可能与 magic bytes 得出的 canonical 容器不一致，下载时必须校正后缀。
  const lastDot = normalized.lastIndexOf('.')
  const stem = (lastDot > 0 ? normalized.slice(0, lastDot) : normalized)
    .slice(0, 180 - extension.length)
    .replace(/[. ]+$/gu, '')
  return `${stem.length === 0 ? 'media' : stem}${extension}`
}

/**
 * filename* 使用持久化展示名的安全叶节点，并在视频场景校正可信容器后缀。
 * 值最终只会经过 RFC 5987 percent-encoding 进入 Header，绝不直接拼接原始输入。
 */
function sanitizeUnicodeFilename(
  originalFilename: string,
  extension: TrustedContentType['extension'],
  enforceCanonicalExtension: boolean,
): string {
  const leaf = originalFilename.split(/[\\/]/u).at(-1) ?? ''
  const normalized = leaf
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
  const safe = normalized.length === 0 || normalized === '.' || normalized === '..'
    ? `media${extension}`
    : Array.from(normalized).slice(0, 255).join('')

  if (!enforceCanonicalExtension) return safe

  const lastDot = safe.lastIndexOf('.')
  const rawStem = lastDot > 0 ? safe.slice(0, lastDot) : safe
  const maximumStemLength = 255 - Array.from(extension).length
  const stem = Array.from(rawStem)
    .slice(0, maximumStemLength)
    .join('')
    .replace(/[. ]+$/gu, '')
  return `${stem.length === 0 ? 'media' : stem}${extension}`
}

function encodeRfc5987Filename(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/gu, character =>
    `%${character.codePointAt(0)!.toString(16).toUpperCase()}`)
}

function buildContentDisposition(
  originalFilename: string,
  contentType: TrustedContentType,
): string {
  const enforceCanonicalExtension = contentType.mediaType === MediaType.VIDEO
  const asciiFilename = sanitizeAsciiFilename(
    originalFilename,
    contentType.extension,
    enforceCanonicalExtension,
  )
  const unicodeFilename = sanitizeUnicodeFilename(
    originalFilename,
    contentType.extension,
    enforceCanonicalExtension,
  )
  const fallback = `inline; filename="${asciiFilename}"`
  return unicodeFilename === asciiFilename
    ? fallback
    : `${fallback}; filename*=UTF-8''${encodeRfc5987Filename(unicodeFilename)}`
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

interface NormalizedApplicationRange {
  readonly contentLength: bigint
  readonly range: MediaByteRange
}

/**
 * 应用直出只接受单个 bytes range，并完整支持 start-end、start- 和 -suffix。
 * 多区间响应需要 multipart/byteranges，当前没有产品媒体消费方需要，因此明确返回 416。
 */
function normalizeApplicationRange(
  value: unknown,
  sizeBytes: bigint,
): NormalizedApplicationRange | typeof INVALID_RANGE | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return INVALID_RANGE

  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim())
  if (match === null) return INVALID_RANGE
  const startToken = match[1] ?? ''
  const endToken = match[2] ?? ''
  if (startToken.length === 0 && endToken.length === 0) return INVALID_RANGE

  let start: bigint
  let end: bigint
  if (startToken.length === 0) {
    const suffixLength = BigInt(endToken)
    if (suffixLength <= 0n) return INVALID_RANGE
    start = suffixLength >= sizeBytes ? 0n : sizeBytes - suffixLength
    end = sizeBytes - 1n
  }
  else {
    start = BigInt(startToken)
    if (start >= sizeBytes) return INVALID_RANGE
    end = endToken.length === 0
      ? sizeBytes - 1n
      : BigInt(endToken)
    if (end < start) return INVALID_RANGE
    if (end >= sizeBytes) end = sizeBytes - 1n
  }

  if (
    start < 0n ||
    end < start ||
    end > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return INVALID_RANGE
  }

  return Object.freeze({
    contentLength: end - start + 1n,
    range: Object.freeze({
      end: Number(end),
      start: Number(start),
    }),
  })
}

@Injectable()
export class ProductMediaContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: MediaContentDeliveryService,
  ) {}

  async resolve(
    productId: string,
    productMediaId: string,
    ifNoneMatch: unknown,
    range: unknown = undefined,
    method: 'GET' | 'HEAD' = 'GET',
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

    const contentHeaders = {
      ...commonHeaders,
      'Content-Disposition': buildContentDisposition(
        row.mediaAsset.originalFilename,
        contentType,
      ),
      'Content-Type': contentType.mimeType,
    }

    if (this.delivery.mode === 'internal_redirect') {
      return {
        status: HttpStatus.OK,
        headers: {
          ...contentHeaders,
          'X-Accel-Redirect': buildInternalRedirect(objectKey),
        },
      }
    }

    let sizeBytes: bigint
    try {
      const storedObject = await this.delivery.stat(objectKey)
      if (
        storedObject === null ||
        storedObject.sizeBytes <= 0n ||
        storedObject.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw productMediaStorageUnavailableError()
      }
      sizeBytes = storedObject.sizeBytes
    }
    catch {
      // READY 关联对应的对象不可读取属于存储故障，不伪装成用户可修复的媒体 404。
      throw productMediaStorageUnavailableError()
    }

    const normalizedRange = normalizeApplicationRange(range, sizeBytes)
    if (normalizedRange === INVALID_RANGE) {
      return {
        status: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
        headers: {
          ...commonHeaders,
          'Content-Range': `bytes */${sizeBytes.toString()}`,
        },
      }
    }

    const responseRange = normalizedRange?.range
    const contentLength = normalizedRange?.contentLength ?? sizeBytes
    const applicationHeaders = {
      ...contentHeaders,
      'Content-Length': contentLength.toString(),
      ...(responseRange === undefined
        ? {}
        : {
            'Content-Range':
              `bytes ${responseRange.start}-${responseRange.end}/${sizeBytes.toString()}`,
          }),
    }
    const status = responseRange === undefined
      ? HttpStatus.OK
      : HttpStatus.PARTIAL_CONTENT

    if (method === 'HEAD') {
      return { status, headers: applicationHeaders }
    }

    try {
      const storedObject = await this.delivery.open(objectKey, responseRange)
      if (
        storedObject.sizeBytes !== sizeBytes ||
        storedObject.contentLength !== contentLength
      ) {
        storedObject.stream.destroy()
        throw productMediaStorageUnavailableError()
      }
      return {
        status,
        headers: applicationHeaders,
        stream: storedObject.stream,
      }
    }
    catch {
      throw productMediaStorageUnavailableError()
    }
  }
}
