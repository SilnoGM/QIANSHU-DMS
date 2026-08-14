import type { Prisma } from '../../../generated/prisma/client'
import {
  MediaAssetStatus,
  MediaType,
  ProductMediaKind,
  type ProductMediaKind as ProductMediaKindValue,
} from '../../../generated/prisma/enums'

interface ProductMediaAssetQueryRow {
  readonly mediaType: MediaType
  readonly status: MediaAssetStatus
  readonly originalFilename: string
  readonly mimeType: string | null
  readonly sizeBytes: bigint | null
  readonly width: number | null
  readonly height: number | null
  readonly durationMs: number | null
}

export interface ProductMediaQueryRow {
  readonly id: string
  readonly productId: string
  readonly kind: ProductMediaKindValue
  readonly sortOrder: number
  readonly isPrimary: boolean
  readonly createdAt: Date
  readonly mediaAsset: ProductMediaAssetQueryRow
}

export interface ProductMediaItem {
  readonly id: string
  readonly kind: ProductMediaKindValue
  readonly originalFilename: string
  readonly mimeType: string
  readonly sizeBytes: string
  readonly width: number
  readonly height: number
  readonly durationMs: number | null
  readonly sortOrder: number
  readonly isPrimary: boolean
  readonly contentUrl: string
  readonly createdAt: string
}

export interface ProductMedia {
  readonly mainImage: ProductMediaItem | null
  readonly images: readonly ProductMediaItem[]
  readonly videos: readonly ProductMediaItem[]
}

export class ProductMediaDataIntegrityError extends Error {
  constructor() {
    super('Product media persisted data is invalid')
    this.name = 'ProductMediaDataIntegrityError'
  }
}

/**
 * 查询只选择公开映射所需字段。MediaAsset 主键、objectKey、checksum 和
 * storageDriver 不进入读模型，从数据访问边界消除误暴露机会。
 */
export const PRODUCT_MEDIA_RESPONSE_SELECT = {
  id: true,
  productId: true,
  kind: true,
  sortOrder: true,
  isPrimary: true,
  createdAt: true,
  mediaAsset: {
    select: {
      mediaType: true,
      status: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      width: true,
      height: true,
      durationMs: true,
    },
  },
} satisfies Prisma.ProductMediaSelect

/**
 * Product 列表只调用一次本函数；所有产品 ID 使用同一个 IN 查询，避免随
 * 页面行数增长的 N+1。排序同时由数据库和 mapper 固定，异常数据不会改变输出。
 */
export async function readActiveProductMedia(
  transaction: Prisma.TransactionClient,
  productIds: readonly string[],
): Promise<ProductMediaQueryRow[]> {
  const uniqueProductIds = [...new Set(productIds)]
  if (uniqueProductIds.length === 0) return []

  return transaction.productMedia.findMany({
    where: {
      productId: { in: uniqueProductIds },
      detachedAt: null,
    },
    orderBy: [
      { productId: 'asc' },
      { kind: 'asc' },
      { sortOrder: 'asc' },
      { id: 'asc' },
    ],
    select: PRODUCT_MEDIA_RESPONSE_SELECT,
  })
}

export function mapProductMedia(
  productId: string,
  rows: readonly ProductMediaQueryRow[],
): ProductMedia {
  const items = rows.map(row => mapProductMediaItem(productId, row))
  const images = items
    .filter(item => item.kind === ProductMediaKind.IMAGE)
    .sort(compareMediaItems)
  const videos = items
    .filter(item => item.kind === ProductMediaKind.VIDEO)
    .sort(compareMediaItems)

  assertUniqueLayout(images)
  assertUniqueLayout(videos)
  const primaryImages = images.filter(item => item.isPrimary)
  if (primaryImages.length > 1 || videos.some(item => item.isPrimary)) {
    throw new ProductMediaDataIntegrityError()
  }

  return {
    mainImage: primaryImages[0] ?? null,
    images,
    videos,
  }
}

/** 一次批量查询结果按 Product 分组；出现查询范围外的 Product 时失败关闭。 */
export function mapProductMediaByProduct(
  productIds: readonly string[],
  rows: readonly ProductMediaQueryRow[],
): ReadonlyMap<string, ProductMedia> {
  const uniqueProductIds = [...new Set(productIds)]
  const requested = new Set(uniqueProductIds)
  const rowsByProduct = new Map<string, ProductMediaQueryRow[]>(
    uniqueProductIds.map(productId => [productId, []]),
  )

  for (const row of rows) {
    if (!requested.has(row.productId)) {
      throw new ProductMediaDataIntegrityError()
    }
    rowsByProduct.get(row.productId)?.push(row)
  }

  return new Map(uniqueProductIds.map(productId => [
    productId,
    mapProductMedia(productId, rowsByProduct.get(productId) ?? []),
  ]))
}

function mapProductMediaItem(
  productId: string,
  row: ProductMediaQueryRow,
): ProductMediaItem {
  const asset = row.mediaAsset
  const isImage = row.kind === ProductMediaKind.IMAGE
  const isVideo = row.kind === ProductMediaKind.VIDEO
  const expectedType = isImage ? MediaType.IMAGE : MediaType.VIDEO
  if (
    row.productId !== productId
    || (!isImage && !isVideo)
    || asset.status !== MediaAssetStatus.READY
    || asset.mediaType !== expectedType
    || asset.mimeType === null
    || asset.mimeType.length === 0
    || asset.originalFilename.length === 0
    || asset.sizeBytes === null
    || asset.sizeBytes < 0n
    || asset.width === null
    || !Number.isInteger(asset.width)
    || asset.width <= 0
    || asset.height === null
    || !Number.isInteger(asset.height)
    || asset.height <= 0
    || !Number.isInteger(row.sortOrder)
    || row.sortOrder < 0
    || (isImage && asset.durationMs !== null)
    || (isVideo && (
      asset.durationMs === null
      || !Number.isInteger(asset.durationMs)
      || asset.durationMs <= 0
    ))
    || (isVideo && row.isPrimary)
    || !(row.createdAt instanceof Date)
    || Number.isNaN(row.createdAt.getTime())
  ) {
    throw new ProductMediaDataIntegrityError()
  }

  return {
    id: row.id,
    kind: row.kind,
    originalFilename: asset.originalFilename,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes.toString(),
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    sortOrder: row.sortOrder,
    isPrimary: row.isPrimary,
    contentUrl: `/api/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(row.id)}/content`,
    createdAt: row.createdAt.toISOString(),
  }
}

function compareMediaItems(
  left: ProductMediaItem,
  right: ProductMediaItem,
): number {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
}

function assertUniqueLayout(items: readonly ProductMediaItem[]): void {
  const ids = new Set<string>()
  const sortOrders = new Set<number>()
  for (const item of items) {
    if (ids.has(item.id) || sortOrders.has(item.sortOrder)) {
      throw new ProductMediaDataIntegrityError()
    }
    ids.add(item.id)
    sortOrders.add(item.sortOrder)
  }
}
