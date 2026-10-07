import { Prisma } from '../../generated/prisma/client'
import { MediaAssetStatus } from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'

export interface ReconciliationAssetRecord {
  readonly checksumSha256: string | null
  readonly id: string
  readonly objectKey: string | null
  readonly retentionUntil: Date | null
  readonly sizeBytes: bigint | null
  readonly status: MediaAssetStatus
}

export interface ExpiredAssetTransition {
  readonly id: string
  readonly status: 'FAILED' | 'UPLOADING'
}

/** 迁移期登记的「旧键 → 新键」对；对账据此把两个位置都视为合法。 */
export interface ObjectKeyMigrationPair {
  readonly assetId: string
  readonly newKey: string
  readonly oldKey: string
}

export interface ReconciliationAssetPage {
  readonly nextCursor: string | null
  readonly records: readonly ReconciliationAssetRecord[]
}

type ClaimOperation<T> = (
  transaction: Prisma.TransactionClient,
  asset: ReconciliationAssetRecord,
) => Promise<T>

/**
 * 回收任务的数据库读写边界。
 *
 * 候选领取与文件操作 callback 共用一个事务，因此 `FOR UPDATE SKIP LOCKED` 的行锁会持续到该候选
 * 完成。每次只领取一行，避免在执行文件系统 I/O 时长时间占用整批数据库锁。
 */
export class MediaReconciliationPersistence {
  constructor(private readonly prisma: PrismaService) {}

  withExpiredUploadClaim<T>(
    now: Date,
    operation: ClaimOperation<T>,
    excludedAssetIds: readonly string[] = [],
  ): Promise<T | null> {
    const exclusion = this.exclusionClause(excludedAssetIds)
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ReconciliationAssetRecord[]>(Prisma.sql`
        SELECT
          "checksum_sha256" AS "checksumSha256",
          "id",
          "object_key" AS "objectKey",
          "retention_until" AS "retentionUntil",
          "size_bytes" AS "sizeBytes",
          "status"
        FROM "media_assets"
        WHERE "status" IN ('UPLOADING', 'FAILED')
          AND COALESCE(
            "upload_expires_at",
            "updated_at" + INTERVAL '24 hours'
          ) <= ${now}
          ${exclusion}
        ORDER BY
          COALESCE("upload_expires_at", "updated_at" + INTERVAL '24 hours'),
          "id"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `)
      const asset = rows[0]
      return asset ? operation(transaction, asset) : null
    })
  }

  withExpiredTrashClaim<T>(
    now: Date,
    operation: ClaimOperation<T>,
    excludedAssetIds: readonly string[] = [],
  ): Promise<T | null> {
    const exclusion = this.exclusionClause(excludedAssetIds)
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ReconciliationAssetRecord[]>(Prisma.sql`
        SELECT
          "checksum_sha256" AS "checksumSha256",
          "id",
          "object_key" AS "objectKey",
          "retention_until" AS "retentionUntil",
          "size_bytes" AS "sizeBytes",
          "status"
        FROM "media_assets"
        WHERE "status" = 'TRASHED'
          AND "retention_until" <= ${now}
          ${exclusion}
        ORDER BY "retention_until", "id"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `)
      const asset = rows[0]
      return asset ? operation(transaction, asset) : null
    })
  }

  async lockAsset(
    transaction: Prisma.TransactionClient,
    assetId: string,
  ): Promise<ReconciliationAssetRecord | null> {
    const rows = await transaction.$queryRaw<ReconciliationAssetRecord[]>(Prisma.sql`
      SELECT
        "checksum_sha256" AS "checksumSha256",
        "id",
        "object_key" AS "objectKey",
        "retention_until" AS "retentionUntil",
        "size_bytes" AS "sizeBytes",
        "status"
      FROM "media_assets"
      WHERE "id" = CAST(${assetId} AS uuid)
      FOR UPDATE
    `)
    return rows[0] ?? null
  }

  async markTrashed(
    transaction: Prisma.TransactionClient,
    assetId: string,
    deletedAt: Date,
    retentionUntil: Date,
  ): Promise<boolean> {
    const result = await transaction.mediaAsset.updateMany({
      where: { id: assetId, status: MediaAssetStatus.READY },
      data: {
        deletedAt,
        retentionUntil,
        status: MediaAssetStatus.TRASHED,
      },
    })
    return result.count === 1
  }

  async markReadyFromTrash(
    transaction: Prisma.TransactionClient,
    assetId: string,
  ): Promise<boolean> {
    const result = await transaction.mediaAsset.updateMany({
      where: { id: assetId, status: MediaAssetStatus.TRASHED },
      data: {
        deletedAt: null,
        retentionUntil: null,
        status: MediaAssetStatus.READY,
      },
    })
    return result.count === 1
  }

  async markExpiredPurged(
    transaction: Prisma.TransactionClient,
    asset: ExpiredAssetTransition,
    deletedAt: Date,
  ): Promise<boolean> {
    if (asset.status === MediaAssetStatus.UPLOADING) {
      const failed = await transaction.mediaAsset.updateMany({
        where: { id: asset.id, status: MediaAssetStatus.UPLOADING },
        data: {
          failureCode: 'MEDIA_ASSET_UPLOAD_EXPIRED',
          status: MediaAssetStatus.FAILED,
        },
      })
      if (failed.count !== 1) return false
    }

    const purged = await transaction.mediaAsset.updateMany({
      where: { id: asset.id, status: MediaAssetStatus.FAILED },
      data: {
        deletedAt,
        retentionUntil: null,
        status: MediaAssetStatus.PURGED,
        uploadExpiresAt: null,
      },
    })
    return purged.count === 1
  }

  async markTrashPurged(
    transaction: Prisma.TransactionClient,
    assetId: string,
  ): Promise<boolean> {
    const result = await transaction.mediaAsset.updateMany({
      where: { id: assetId, status: MediaAssetStatus.TRASHED },
      data: {
        retentionUntil: null,
        status: MediaAssetStatus.PURGED,
      },
    })
    return result.count === 1
  }

  async listAssets(
    cursor: string | undefined,
    limit: number,
  ): Promise<ReconciliationAssetPage> {
    const records = await this.prisma.mediaAsset.findMany({
      where: cursor === undefined ? undefined : { id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: {
        checksumSha256: true,
        id: true,
        objectKey: true,
        retentionUntil: true,
        sizeBytes: true,
        status: true,
      },
    })
    const hasNextPage = records.length > limit
    const pageRecords = records.slice(0, limit)
    return Object.freeze({
      nextCursor: hasNextPage ? (pageRecords.at(-1)?.id ?? null) : null,
      records: Object.freeze(pageRecords.map(record => Object.freeze({ ...record }))),
    })
  }

  async readAssetsByIds(
    assetIds: readonly string[],
  ): Promise<readonly ReconciliationAssetRecord[]> {
    if (assetIds.length === 0) return []
    const records = await this.prisma.mediaAsset.findMany({
      where: { id: { in: [...assetIds] } },
      select: {
        checksumSha256: true,
        id: true,
        objectKey: true,
        retentionUntil: true,
        sizeBytes: true,
        status: true,
      },
    })
    return Object.freeze(records.map(record => Object.freeze({ ...record })))
  }

  /**
   * 读取存量键重命名的登记键对（迁移期专用，通常只有几十到几万行）。
   *
   * 对账需要它才能把「登记过的对端键」也算作合法位置：复制阶段完成后旧键与新键会同时存在，
   * 只认数据库里那一个键会把另一半判成 unexpectedLocation，迁移窗口内的告警就全是噪声。
   */
  async readObjectKeyMigrations(): Promise<readonly ObjectKeyMigrationPair[]> {
    const records = await this.prisma.mediaObjectKeyMigration.findMany({
      select: { assetId: true, newKey: true, oldKey: true },
    })
    return Object.freeze(records.map(record => Object.freeze({ ...record })))
  }

  private exclusionClause(assetIds: readonly string[]): Prisma.Sql {
    if (assetIds.length === 0) return Prisma.empty
    return Prisma.sql`
      AND "id" NOT IN (${Prisma.join(
        assetIds.map(assetId => Prisma.sql`CAST(${assetId} AS uuid)`),
      )})
    `
  }
}
