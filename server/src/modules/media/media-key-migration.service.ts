import type { MediaStorageEnvironment } from '../../config/media.config'
import { Prisma } from '../../generated/prisma/client'
import {
  parseStoredMediaObjectKey,
  type MediaStoragePool,
  type ParsedStoredMediaObjectKey,
} from './media-object-key'

/**
 * 单页扫描行数。扫描是只读的 id 游标分页，页大小只影响往返次数与单条语句的 JOIN 规模。
 */
const SCAN_PAGE_SIZE = 500
const MAXIMUM_SCAN_PAGE_SIZE = 5_000
/**
 * 扫描页数上限只用于保证命令有界：它是 500 万行的量级，触顶时宁可失败也不静默截断计划。
 */
const MAXIMUM_SCAN_PAGES = 10_000
/**
 * 单条 INSERT / IN (...) 语句的参数行数上限。PostgreSQL 扩展协议单语句最多 65535 个参数，
 * 登记语句每行 3 个参数，这里留足两个数量级余量，同时不把语句长度推到解析器上限。
 */
const REGISTRATION_CHUNK_SIZE = 500
/** 单次 applyBatch 允许的最大行数，防止命令行误传一个把整表塞进单个事务的值。 */
const MAXIMUM_APPLY_BATCH_SIZE = 5_000

/** `uploadPurpose` 与业务池的映射（规则 10）：只有列表里的用途能定池，其余一律 misc。 */
const UPLOAD_PURPOSE_POOLS: Readonly<Record<string, MediaStoragePool>> = Object.freeze({
  OCEAN_FREIGHT_SOURCE_XLSX: 'container',
  PACKAGING_PAYMENT_VOUCHER: 'voucher',
  PAYMENT_RECIPIENT_QR: 'payment-recipient',
  PURCHASE_PAYMENT_VOUCHER: 'voucher',
  SLH_BILL_SOURCE_XLSX: 'bill',
})

/**
 * 池判定的输入事实：每条对应「一张引用表的一列（必要时带枚举值）是否命中该资产」。
 *
 * 事实由一条 SQL 按页取回，判定顺序留在下面的 resolveMediaStoragePool——顺序本身就是业务语义，
 * 放进 SQL 字符串就无法单测，而它一旦改变就会改掉键前缀，属于数据迁移语义变更。
 */
export interface MediaKeyPoolFacts {
  readonly billSourceFile: boolean
  readonly containerSourceFile: boolean
  readonly packagingImage: boolean
  readonly packagingPaymentVoucher: boolean
  readonly paymentRecipientQr: boolean
  readonly productMedia: boolean
  readonly purchaseDocument: boolean
  readonly purchaseDocumentVoucher: boolean
  readonly purchaseImageDraft: boolean
  readonly salesDocument: boolean
  readonly salesDocumentVoucher: boolean
  readonly salesReceiptVoucher: boolean
  readonly uploadPurpose: string | null
}

export interface MediaKeyMigrationScanRow extends MediaKeyPoolFacts {
  readonly assetId: string
  readonly checksumSha256: string | null
  readonly objectKey: string
  readonly sizeBytes: bigint | null
}

export interface MediaKeyMigrationCandidate {
  readonly assetId: string
  /** 复制阶段用来核对目标对象；改键阶段不用它，缺失时只影响 copy 的成败。 */
  readonly checksumSha256: string | null
  readonly newKey: string
  readonly oldKey: string
  readonly sizeBytes: bigint | null
}

export interface MediaKeyMigrationPlan {
  readonly candidates: readonly MediaKeyMigrationCandidate[]
  /** 本次扫描过的行数：`READY`/`TRASHED` 且 object_key 非空的行，含已是新布局、无需改写的行。 */
  readonly scanned: number
}

export interface MediaKeyMigrationPlanOptions {
  readonly pageSize?: number
}

export interface MediaKeyMigrationRegistrationResult {
  readonly conflicts: number
  /** 本次真正写入登记表的行数；重复登记的键对因 ON CONFLICT DO NOTHING 不计入。 */
  readonly registered: number
}

export interface MediaKeyMigrationApplyResult {
  readonly applied: number
  /** 登记存在、但目标键上的对象不存在或长度与数据库不一致，因而拒绝改键的行数。 */
  readonly missingTarget: number
  readonly skipped: number
}

export interface MediaKeyMigrationPreviewSummary {
  readonly alreadyRegistered: number
  readonly applied: number
  readonly candidates: number
}

export interface MediaKeyMigrationSqlClient {
  readonly $queryRaw: <T>(query: Prisma.Sql) => Promise<T>
}

export interface MediaKeyMigrationDatabase extends MediaKeyMigrationSqlClient {
  readonly $transaction: <T>(
    operation: (transaction: MediaKeyMigrationSqlClient) => Promise<T>,
  ) => Promise<T>
}

/**
 * 改键前的目标对象核对端口，刻意只保留 `stat`：改键只需要确认「目标对象存在且长度与数据库一致」，
 * 完整校验（长度 + 摘要、回读全文）由复制阶段与只读对账承担，不在这里重复下载正文。
 */
export interface MediaKeyMigrationStorage {
  stat(key: string): Promise<{ readonly sizeBytes: bigint } | null>
}

export interface MediaKeyMigrationServiceDependencies {
  readonly database: MediaKeyMigrationDatabase
  /**
   * 目标键的环境段。刻意不提供默认值：回落到 dev 会把生产存量写成 dev 前缀，属于静默数据污染，
   * 必须由调用方（命令层）从 MEDIA_STORAGE_ENV 显式传入。
   */
  readonly storageEnvironment: MediaStorageEnvironment
  readonly storage: MediaKeyMigrationStorage
}

/**
 * 命令层只依赖这四个动作。接口化之后命令可以不构造真实 Prisma 就能单测编排逻辑，
 * 同时类通过 implements 在编译期被钉住合同。
 */
export interface MediaKeyMigrationOperations {
  applyBatch(limit: number): Promise<MediaKeyMigrationApplyResult>
  planCandidates(options?: MediaKeyMigrationPlanOptions): Promise<MediaKeyMigrationPlan>
  previewSummary(): Promise<MediaKeyMigrationPreviewSummary>
  registerPlan(
    rows: readonly MediaKeyMigrationCandidate[],
  ): Promise<MediaKeyMigrationRegistrationResult>
}

/**
 * 池判定的唯一实现，顺序即语义，不得重排或合并分支。
 *
 * 资金凭证列（`voucher` 的四条路径）必须先于同表的普通单据列判定：付款截图与出单凭证在
 * `purchase_order_documents` / `sales_order_documents` 里共表，若先判单据列，凭证会被归到单据池，
 * 对象键前缀（以及随之收敛的敏感策略）就错了。都不命中时按 `uploadPurpose` 兜底，最后才 misc。
 */
export function resolveMediaStoragePool(facts: MediaKeyPoolFacts): MediaStoragePool {
  if (facts.productMedia) return 'product'
  if (facts.salesReceiptVoucher) return 'voucher'
  if (facts.salesDocumentVoucher) return 'voucher'
  if (facts.salesDocument) return 'sales'
  if (facts.purchaseDocumentVoucher) return 'voucher'
  if (facts.purchaseDocument) return 'purchase'
  if (facts.purchaseImageDraft) return 'purchase'
  if (facts.packagingPaymentVoucher) return 'voucher'
  if (facts.packagingImage) return 'packaging'
  if (facts.paymentRecipientQr) return 'payment-recipient'
  if (facts.containerSourceFile) return 'container'
  if (facts.billSourceFile) return 'bill'
  return facts.uploadPurpose === null
    ? 'misc'
    : UPLOAD_PURPOSE_POOLS[facts.uploadPurpose] ?? 'misc'
}

/**
 * 候选扫描：一条语句按 id 升序取一页 `READY`/`TRASHED` 行，并用 EXISTS 半连接把 12 个引用列
 * 压成布尔事实。
 *
 * 一条 SQL 而不是逐行回查：池判定涉及 10 张引用表，逐行查询会把迁移变成 N×10 次往返；
 * EXISTS 半连接保证每个资产恰好一行，不会像多表 LEFT JOIN 那样出现笛卡尔放大。
 */
function buildScanQuery(cursor: string | null, limit: number): Prisma.Sql {
  // 首屏没有游标：显式去掉条件而不是塞一个哨兵 UUID，避免把「起始位置」藏进魔法值。
  const cursorCondition = cursor === null
    ? Prisma.empty
    : Prisma.sql`AND "asset"."id" > CAST(${cursor} AS uuid)`
  return Prisma.sql`
    WITH "batch" AS (
      SELECT
        "asset"."id",
        "asset"."object_key",
        "asset"."upload_purpose",
        "asset"."checksum_sha256",
        "asset"."size_bytes"
      FROM "media_assets" AS "asset"
      WHERE "asset"."status" IN ('READY', 'TRASHED')
        AND "asset"."object_key" IS NOT NULL
        ${cursorCondition}
      ORDER BY "asset"."id"
      LIMIT ${limit}
    )
    SELECT
      "batch"."id" AS "assetId",
      "batch"."object_key" AS "objectKey",
      "batch"."upload_purpose" AS "uploadPurpose",
      "batch"."checksum_sha256" AS "checksumSha256",
      "batch"."size_bytes" AS "sizeBytes",
      EXISTS (
        SELECT 1 FROM "product_media" AS "reference"
        WHERE "reference"."media_asset_id" = "batch"."id"
      ) AS "productMedia",
      EXISTS (
        SELECT 1 FROM "sales_receipt_requests" AS "reference"
        WHERE "reference"."voucher_media_asset_id" = "batch"."id"
      ) AS "salesReceiptVoucher",
      EXISTS (
        SELECT 1 FROM "sales_order_documents" AS "reference"
        WHERE "reference"."media_asset_id" = "batch"."id"
          AND "reference"."document_type" = 'PAYMENT_VOUCHER'
      ) AS "salesDocumentVoucher",
      EXISTS (
        SELECT 1 FROM "sales_order_documents" AS "reference"
        WHERE "reference"."media_asset_id" = "batch"."id"
      ) AS "salesDocument",
      EXISTS (
        SELECT 1 FROM "purchase_order_documents" AS "reference"
        WHERE "reference"."media_asset_id" = "batch"."id"
          AND "reference"."document_type" = 'PAYMENT_VOUCHER'
      ) AS "purchaseDocumentVoucher",
      EXISTS (
        SELECT 1 FROM "purchase_order_documents" AS "reference"
        WHERE "reference"."media_asset_id" = "batch"."id"
      ) AS "purchaseDocument",
      EXISTS (
        SELECT 1 FROM "purchase_order_image_drafts" AS "reference"
        WHERE "reference"."media_asset_id" = "batch"."id"
      ) AS "purchaseImageDraft",
      EXISTS (
        SELECT 1 FROM "packaging_cost_requests" AS "reference"
        WHERE "reference"."payment_voucher_media_asset_id" = "batch"."id"
      ) AS "packagingPaymentVoucher",
      EXISTS (
        SELECT 1 FROM "packaging_cost_requests" AS "reference"
        WHERE "reference"."packaging_image_media_asset_id" = "batch"."id"
          OR "reference"."quotation_image_media_asset_id" = "batch"."id"
      ) AS "packagingImage",
      EXISTS (
        SELECT 1 FROM "payment_recipient_accounts" AS "reference"
        WHERE "reference"."qr_media_asset_id" = "batch"."id"
      ) OR EXISTS (
        SELECT 1 FROM "purchase_order_payments" AS "reference"
        WHERE "reference"."recipient_qr_media_asset_id" = "batch"."id"
      ) OR EXISTS (
        SELECT 1 FROM "packaging_cost_requests" AS "reference"
        WHERE "reference"."recipient_qr_media_asset_id" = "batch"."id"
      ) AS "paymentRecipientQr",
      EXISTS (
        SELECT 1 FROM "container_batches" AS "reference"
        WHERE "reference"."source_file_id" = "batch"."id"
      ) AS "containerSourceFile",
      EXISTS (
        SELECT 1 FROM "slh_bills" AS "reference"
        WHERE "reference"."source_file_id" = "batch"."id"
      ) AS "billSourceFile"
    FROM "batch"
  `
}

/**
 * 目标键：`{namespace}/{env}/{pool}/{YYYY}/{MM}/{assetId}{ext}`。
 *
 * 命名空间、年月、assetId 与扩展名全部沿用旧键：迁移动作是「在命名空间之后插入环境与池两段」，
 * 不是按当前时间重新落桶。`trash/` 必须保留——回收站键由 trashKeyFor 前缀替换得出，
 * 丢了命名空间会让已进回收站的对象指向 assets/ 下的不存在的键。
 */
function buildTargetKey(
  oldKey: string,
  parsed: ParsedStoredMediaObjectKey,
  storageEnvironment: MediaStorageEnvironment,
  pool: MediaStoragePool,
): string | null {
  // 解析器已判定旧布局为 4 段且年月合法，这里只按位置取值，不再用正则重复解析外部输入。
  const segments = oldKey.split('/')
  const year = segments.at(1)
  const month = segments.at(2)
  if (year === undefined || month === undefined) return null

  const target = `${parsed.namespace}/${storageEnvironment}/${pool}/${year}/${month}/${parsed.assetId}${parsed.extension}`
  // 回环校验：目标键必须能被同一个解析器识别为 6 段结构化键。键写库后不可自由修改，
  // 与其登记一个形态可疑的键，不如让整条命令失败，由运维核对输入。
  const reparsed = parseStoredMediaObjectKey(target)
  return reparsed !== null && reparsed.layout === 'structured' ? target : null
}

function chunked<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function requirePageSize(value: number | undefined): number {
  const normalized = value ?? SCAN_PAGE_SIZE
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 1 ||
    normalized > MAXIMUM_SCAN_PAGE_SIZE
  ) {
    throw new Error('Media key migration page size is invalid')
  }
  return normalized
}

function requireBatchLimit(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAXIMUM_APPLY_BATCH_SIZE
  ) {
    throw new Error('Media key migration batch limit is invalid')
  }
  return value
}

function freezePlan(
  candidates: readonly MediaKeyMigrationCandidate[],
  scanned: number,
): MediaKeyMigrationPlan {
  return Object.freeze({ candidates: Object.freeze([...candidates]), scanned })
}

/**
 * 存量键重命名迁移的数据库侧实现：登记键对并改写 `media_assets.object_key`。
 *
 * 它不搬字节、不删对象、不写 storage_driver，但对目标对象做只读核对（存在性与长度）：
 * 字节复制是独立阶段，必须先于改键完成，否则改键后读取路径会指向桶里还不存在的对象。
 */
export class MediaKeyMigrationService implements MediaKeyMigrationOperations {
  private readonly dependencies: MediaKeyMigrationServiceDependencies

  constructor(dependencies: MediaKeyMigrationServiceDependencies) {
    this.dependencies = Object.freeze({ ...dependencies })
  }

  /**
   * 扫描 `READY`/`TRASHED` 行并挑选需要改键的候选（只认旧布局键），按 id 游标分页遍历全表。
   *
   * 布局判别只用 parseStoredMediaObjectKey：段数是布局的唯一判据，SQL 里再写一遍等于把规则复制成两份，
   * 迁移与对账迟早会漂移。已改写过（新布局）的行在重跑时原样跳过，命令因此可以中断续跑。
   */
  async planCandidates(
    options: MediaKeyMigrationPlanOptions = {},
  ): Promise<MediaKeyMigrationPlan> {
    const pageSize = requirePageSize(options.pageSize)
    const candidates: MediaKeyMigrationCandidate[] = []
    let scanned = 0
    let cursor: string | null = null

    for (let page = 0; page < MAXIMUM_SCAN_PAGES; page += 1) {
      // 显式标注类型：游标取自上一页末行，不标注会形成「rows → cursor → buildScanQuery → rows」的循环推断
      const rows: MediaKeyMigrationScanRow[] =
        await this.dependencies.database.$queryRaw<MediaKeyMigrationScanRow[]>(
          buildScanQuery(cursor, pageSize),
        )
      if (rows.length === 0) return freezePlan(candidates, scanned)

      for (const row of rows) {
        scanned += 1
        const candidate = this.candidateFor(row)
        if (candidate !== null) candidates.push(candidate)
      }

      if (rows.length < pageSize) return freezePlan(candidates, scanned)
      cursor = rows[rows.length - 1].assetId
    }

    throw new Error('Media key migration scan exceeded the page budget')
  }

  /**
   * 登记「旧键 → 新键」：登记表是触发器的白名单，写入成功才允许改键。
   *
   * 发现同名资产已登记了不同键对时整批拒绝：那意味着计划与登记表漂移（换了环境、池判据变化或
   * 上一轮计划未回收），继续登记会把两套映射混在一张表里，回滚将无法判断该用哪一对。
   */
  async registerPlan(
    rows: readonly MediaKeyMigrationCandidate[],
  ): Promise<MediaKeyMigrationRegistrationResult> {
    if (rows.length === 0) return Object.freeze({ conflicts: 0, registered: 0 })

    const conflicts = await this.countRegistrationConflicts(rows)
    if (conflicts > 0) return Object.freeze({ conflicts, registered: 0 })

    let registered = 0
    for (const chunk of chunked(rows, REGISTRATION_CHUNK_SIZE)) {
      const inserted = await this.dependencies.database.$queryRaw<{ assetId: string }[]>(
        Prisma.sql`
          INSERT INTO "media_object_key_migrations" ("asset_id", "old_key", "new_key")
          VALUES ${Prisma.join(chunk.map(row => Prisma.sql`(
            CAST(${row.assetId} AS uuid),
            ${row.oldKey},
            ${row.newKey}
          )`))}
          ON CONFLICT ("asset_id") DO NOTHING
          RETURNING "asset_id" AS "assetId"
        `,
      )
      registered += inserted.length
    }
    return Object.freeze({ conflicts, registered })
  }

  /**
   * 按批改键：单事务内逐条更新对象键，随后把登记行标记为已应用。
   *
   * 为什么改键前必须核对目标对象：改键是不可逆的内容身份变更。目标对象缺失时改键会让读取路径指向
   * 桶里不存在的对象，因此只有在 `stat` 命中且长度与数据库记录一致时才允许改；
   * 长度一致不能证明字节一致，全字节校验由复制阶段与只读对账承担。
   *
   * 为什么必须带 `object_key = old`：这是幂等与并发安全的唯一依据。没有它，重跑会把已经改过的键
   * 再改一次（登记行未清理时），或者在键已被并发改写后按旧计划覆盖；
   * 带上它，UPDATE 命中 0 行就说明键已经漂移，此时不动登记行、计入 skipped，
   * 让「已应用」只记录真实发生过的改键。
   */
  async applyBatch(limit: number): Promise<MediaKeyMigrationApplyResult> {
    const batchLimit = requireBatchLimit(limit)
    return this.dependencies.database.$transaction(async (transaction) => {
      const pending = await transaction.$queryRaw<
        { assetId: string, newKey: string, oldKey: string, sizeBytes: bigint | null }[]
      >(Prisma.sql`
        SELECT
          "migration"."asset_id" AS "assetId",
          "migration"."old_key" AS "oldKey",
          "migration"."new_key" AS "newKey",
          "asset"."size_bytes" AS "sizeBytes"
        FROM "media_object_key_migrations" AS "migration"
        JOIN "media_assets" AS "asset" ON "asset"."id" = "migration"."asset_id"
        WHERE "migration"."applied_at" IS NULL
        ORDER BY "migration"."asset_id"
        LIMIT ${batchLimit}
      `)

      let applied = 0
      let missingTarget = 0
      let skipped = 0
      for (const row of pending) {
        // 长度缺失（列可空）时无法证明目标对象是同一份内容，按缺失处理而不是放行。
        const recordedSize = row.sizeBytes
        const target = recordedSize === null
          ? null
          : await this.dependencies.storage.stat(row.newKey)
        if (recordedSize === null || target === null || target.sizeBytes !== recordedSize) {
          missingTarget += 1
          continue
        }

        const updated = await transaction.$queryRaw<{ assetId: string }[]>(Prisma.sql`
          UPDATE "media_assets"
          SET "object_key" = ${row.newKey}
          WHERE "id" = CAST(${row.assetId} AS uuid)
            AND "object_key" = ${row.oldKey}
          RETURNING "id" AS "assetId"
        `)
        if (updated.length === 0) {
          skipped += 1
          continue
        }
        await transaction.$queryRaw(Prisma.sql`
          UPDATE "media_object_key_migrations"
          SET "applied_at" = CURRENT_TIMESTAMP
          WHERE "asset_id" = CAST(${row.assetId} AS uuid)
            AND "applied_at" IS NULL
        `)
        applied += 1
      }
      return Object.freeze({ applied, missingTarget, skipped })
    })
  }

  /**
   * 只读进度：候选数走与 apply 完全相同的扫描与解析器，已登记/已应用来自登记表聚合。
   *
   * 候选扫描本身较重（要判布局与池），但 preview 的价值就是给出可信的工作量；
   * 用 SQL 复制一份「4 段即旧布局」的近似判断会让 preview 与 apply 的口径不一致。
   */
  async previewSummary(): Promise<MediaKeyMigrationPreviewSummary> {
    const plan = await this.planCandidates()
    const counts = await this.dependencies.database.$queryRaw<
      { applied: number, registered: number }[]
    >(Prisma.sql`
      SELECT
        count(*)::int AS "registered",
        count("applied_at")::int AS "applied"
      FROM "media_object_key_migrations"
    `)
    const row = counts.at(0)
    return Object.freeze({
      alreadyRegistered: row?.registered ?? 0,
      applied: row?.applied ?? 0,
      candidates: plan.candidates.length,
    })
  }

  private candidateFor(row: MediaKeyMigrationScanRow): MediaKeyMigrationCandidate | null {
    const parsed = parseStoredMediaObjectKey(row.objectKey)
    if (parsed === null || parsed.layout !== 'legacy') return null

    const newKey = buildTargetKey(
      row.objectKey,
      parsed,
      this.dependencies.storageEnvironment,
      resolveMediaStoragePool(row),
    )
    if (newKey === null) throw new Error('Media key migration target key is invalid')
    return Object.freeze({
      assetId: row.assetId,
      checksumSha256: row.checksumSha256,
      newKey,
      oldKey: row.objectKey,
      sizeBytes: row.sizeBytes,
    })
  }

  private async countRegistrationConflicts(
    rows: readonly MediaKeyMigrationCandidate[],
  ): Promise<number> {
    const planned = new Map(rows.map(row => [row.assetId, row]))
    let conflicts = 0
    for (const chunk of chunked(rows, REGISTRATION_CHUNK_SIZE)) {
      const existing = await this.dependencies.database.$queryRaw<
        { assetId: string, newKey: string, oldKey: string }[]
      >(Prisma.sql`
        SELECT
          "migration"."asset_id" AS "assetId",
          "migration"."old_key" AS "oldKey",
          "migration"."new_key" AS "newKey"
        FROM "media_object_key_migrations" AS "migration"
        WHERE "migration"."asset_id" IN (${Prisma.join(
          chunk.map(row => Prisma.sql`CAST(${row.assetId} AS uuid)`),
        )})
      `)
      for (const record of existing) {
        const expected = planned.get(record.assetId)
        if (expected === undefined) continue
        if (expected.oldKey !== record.oldKey || expected.newKey !== record.newKey) {
          conflicts += 1
        }
      }
    }
    return conflicts
  }
}
