import { randomUUID } from 'node:crypto'

import { Client } from 'pg'

const productMediaReadPermissionId = '00000000-0000-4000-8000-000000000146'
const systemAdminRoleId = '00000000-0000-4000-8000-000000000001'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for Media Schema E2E tests')
  return value
}

function readDatabaseError(error: unknown): {
  readonly code?: unknown
  readonly constraint?: unknown
} {
  if (typeof error !== 'object' || error === null) return {}
  return {
    code: Reflect.get(error, 'code'),
    constraint: Reflect.get(error, 'constraint'),
  }
}

async function expectDatabaseRejection(
  client: Client,
  action: () => Promise<unknown>,
  expectedCode: '22P02' | '23505' | '23514',
  expectedConstraint: string | undefined,
  savepointIndex: number,
  flushDeferred = false,
): Promise<void> {
  const savepoint = `expected_media_rejection_${savepointIndex}`
  await client.query(`SAVEPOINT ${savepoint}`)

  try {
    await action()
    if (flushDeferred) {
      // Deferred constraint trigger 只在事务边界执行；测试用 SET CONSTRAINTS 提前触发，
      // 才能在同一外层回滚事务内覆盖多个正反例。
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    }
  }
  catch (error) {
    const databaseError = readDatabaseError(error)
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await client.query(`RELEASE SAVEPOINT ${savepoint}`)
    await client.query('SET CONSTRAINTS ALL DEFERRED')
    expect(databaseError.code).toBe(expectedCode)
    if (expectedConstraint !== undefined) {
      expect(databaseError.constraint).toBe(expectedConstraint)
    }
    return
  }

  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
  await client.query(`RELEASE SAVEPOINT ${savepoint}`)
  await client.query('SET CONSTRAINTS ALL DEFERRED')
  throw new Error(
    `Expected database constraint ${expectedConstraint ?? expectedCode} to reject input`,
  )
}

async function insertUploadingAsset(
  client: Client,
  actorUserId: string,
  mediaType: 'DOCUMENT' | 'IMAGE' | 'VIDEO',
): Promise<string> {
  const id = randomUUID()
  await client.query(
    `
      INSERT INTO "media_assets" (
        "id",
        "media_type",
        "original_filename",
        "upload_expires_at",
        "created_by_user_id"
      )
      VALUES ($1, $2::"media_type", $3, CURRENT_TIMESTAMP + INTERVAL '24 hours', $4)
    `,
    [id, mediaType, `media-e2e-${mediaType.toLowerCase()}.bin`, actorUserId],
  )
  return id
}

async function activateAsset(
  client: Client,
  assetId: string,
  mediaType: 'DOCUMENT' | 'IMAGE' | 'VIDEO',
): Promise<void> {
  const typeMetadata = {
    DOCUMENT: {
      audioCodec: null,
      durationMs: null,
      height: null,
      mimeType: 'application/pdf',
      videoCodec: null,
      width: null,
    },
    IMAGE: {
      audioCodec: null,
      durationMs: null,
      height: 64,
      mimeType: 'image/jpeg',
      videoCodec: null,
      width: 64,
    },
    VIDEO: {
      audioCodec: 'aac',
      durationMs: 1_000,
      height: 720,
      mimeType: 'video/mp4',
      videoCodec: 'h264',
      width: 1_280,
    },
  } as const
  const metadata = typeMetadata[mediaType]

  await client.query(
    `
      UPDATE "media_assets"
      SET
        "status" = 'READY',
        "object_key" = $2,
        "mime_type" = $3,
        "size_bytes" = 3,
        "checksum_sha256" = $4,
        "width" = $5,
        "height" = $6,
        "duration_ms" = $7,
        "video_codec" = $8,
        "audio_codec" = $9,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = $1
    `,
    [
      assetId,
      `media/e2e/${assetId}`,
      metadata.mimeType,
      'a'.repeat(64),
      metadata.width,
      metadata.height,
      metadata.durationMs,
      metadata.videoCodec,
      metadata.audioCodec,
    ],
  )
}

async function insertProductMedia(
  client: Client,
  input: {
    readonly actorUserId: string
    readonly assetId: string
    readonly isPrimary?: boolean
    readonly kind: 'IMAGE' | 'VIDEO'
    readonly productId: string
    readonly sortOrder: number
  },
): Promise<string> {
  const id = randomUUID()
  await client.query(
    `
      INSERT INTO "product_media" (
        "id",
        "product_id",
        "media_asset_id",
        "kind",
        "sort_order",
        "is_primary",
        "created_by_user_id"
      )
      VALUES ($1, $2, $3, $4::"product_media_kind", $5, $6, $7)
    `,
    [
      id,
      input.productId,
      input.assetId,
      input.kind,
      input.sortOrder,
      input.isPrimary ?? false,
      input.actorUserId,
    ],
  )
  return id
}

describe('media schema constraints with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: requireDatabaseUrl() })
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  it('seeds one stable read permission and grants it to system_admin', async () => {
    const result = await client.query<{
      code: string
      grantCount: number
      id: string
      name: string
      systemOnly: boolean
    }>(
      `
        SELECT
          permission."id",
          permission."code",
          permission."name",
          permission."system_only" AS "systemOnly",
          count(grant_entry.*)::integer AS "grantCount"
        FROM "permissions" AS permission
        LEFT JOIN "role_permissions" AS grant_entry
          ON grant_entry."permission_id" = permission."id"
          AND grant_entry."role_id" = $2
        WHERE permission."id" = $1
        GROUP BY permission."id"
      `,
      [productMediaReadPermissionId, systemAdminRoleId],
    )

    expect(result.rows).toEqual([
      {
        code: 'product-media:read',
        grantCount: 1,
        id: productMediaReadPermissionId,
        name: '读取产品媒体',
        systemOnly: false,
      },
    ])

    const mediaRowCounts = await client.query<{
      assetCount: number
      productMediaCount: number
    }>(
      `
        SELECT
          (SELECT count(*)::integer FROM "media_assets") AS "assetCount",
          (SELECT count(*)::integer FROM "product_media") AS "productMediaCount"
      `,
    )
    expect(mediaRowCounts.rows).toEqual([
      {
        assetCount: 0,
        productMediaCount: 0,
      },
    ])
  })

  it('enforces content metadata, ProductMedia type, ordering, primary and reference safety', async () => {
    await client.query('BEGIN')
    try {
      const actorUserId = randomUUID()
      const username = `media_e2e_${randomUUID().replaceAll('-', '')}`
      await client.query(
        `
          INSERT INTO "users" (
            "id",
            "username",
            "username_normalized",
            "display_name",
            "password_hash",
            "password_changed_at",
            "updated_at"
          )
          VALUES ($1, $2, $2, 'Media Schema E2E', 'not-used', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [actorUserId, username],
      )

      const productId = randomUUID()
      await client.query(
        `
          INSERT INTO "products" ("id", "name", "product_no", "created_by_user_id")
          VALUES ($1, 'Media Schema E2E Product', $2, $3)
        `,
        [productId, `MEDIA-E2E-${randomUUID()}`, actorUserId],
      )

      let savepointIndex = 0
      await expectDatabaseRejection(
        client,
        () => client.query(
          `
            INSERT INTO "media_assets" (
              "media_type",
              "original_filename",
              "upload_expires_at",
              "size_bytes",
              "created_by_user_id"
            )
            VALUES ('IMAGE', 'negative.jpg', CURRENT_TIMESTAMP, -1, $1)
          `,
          [actorUserId],
        ),
        '23514',
        'media_assets_size_bytes_nonnegative_check',
        savepointIndex++,
      )
      await expectDatabaseRejection(
        client,
        () => client.query(
          `
            INSERT INTO "media_assets" (
              "media_type",
              "original_filename",
              "upload_expires_at",
              "object_key",
              "created_by_user_id"
            )
            VALUES ('IMAGE', 'traversal.jpg', CURRENT_TIMESTAMP, '../escape', $1)
          `,
          [actorUserId],
        ),
        '23514',
        'media_assets_object_key_check',
        savepointIndex++,
      )

      await expectDatabaseRejection(
        client,
        async () => {
          const assetId = await insertUploadingAsset(client, actorUserId, 'IMAGE')
          await activateAsset(client, assetId, 'IMAGE')
        },
        '23514',
        'media_assets_ready_reference_check',
        savepointIndex++,
        true,
      )

      await expectDatabaseRejection(
        client,
        async () => {
          const assetId = await insertUploadingAsset(client, actorUserId, 'IMAGE')
          await insertProductMedia(client, {
            actorUserId,
            assetId,
            kind: 'IMAGE',
            productId,
            sortOrder: 0,
          })
        },
        '23514',
        'product_media_asset_ready_check',
        savepointIndex++,
      )

      await expectDatabaseRejection(
        client,
        async () => {
          const assetId = await insertUploadingAsset(client, actorUserId, 'DOCUMENT')
          await activateAsset(client, assetId, 'DOCUMENT')
          await insertProductMedia(client, {
            actorUserId,
            assetId,
            kind: 'IMAGE',
            productId,
            sortOrder: 0,
          })
        },
        '23514',
        'product_media_asset_type_check',
        savepointIndex++,
      )

      const primaryAssetId = await insertUploadingAsset(client, actorUserId, 'IMAGE')
      await activateAsset(client, primaryAssetId, 'IMAGE')
      const primaryProductMediaId = await insertProductMedia(client, {
        actorUserId,
        assetId: primaryAssetId,
        isPrimary: true,
        kind: 'IMAGE',
        productId,
        sortOrder: 0,
      })
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('SET CONSTRAINTS ALL DEFERRED')

      await expectDatabaseRejection(
        client,
        () => client.query(
          `
            INSERT INTO "product_media" (
              "product_id",
              "media_asset_id",
              "kind",
              "sort_order",
              "created_by_user_id"
            )
            VALUES ($1, $2, 'DOCUMENT', 1, $3)
          `,
          [productId, primaryAssetId, actorUserId],
        ),
        '22P02',
        undefined,
        savepointIndex++,
      )

      await expectDatabaseRejection(
        client,
        async () => {
          const duplicateSortAssetId = await insertUploadingAsset(
            client,
            actorUserId,
            'IMAGE',
          )
          await activateAsset(client, duplicateSortAssetId, 'IMAGE')
          await insertProductMedia(client, {
            actorUserId,
            assetId: duplicateSortAssetId,
            kind: 'IMAGE',
            productId,
            sortOrder: 0,
          })
        },
        '23505',
        'product_media_active_product_kind_sort_order_key',
        savepointIndex++,
      )

      const secondaryAssetId = await insertUploadingAsset(client, actorUserId, 'IMAGE')
      await activateAsset(client, secondaryAssetId, 'IMAGE')
      await expectDatabaseRejection(
        client,
        () => insertProductMedia(client, {
          actorUserId,
          assetId: secondaryAssetId,
          isPrimary: true,
          kind: 'IMAGE',
          productId,
          sortOrder: 1,
        }),
        '23505',
        'product_media_active_product_primary_key',
        savepointIndex++,
      )
      const secondaryProductMediaId = await insertProductMedia(client, {
        actorUserId,
        assetId: secondaryAssetId,
        kind: 'IMAGE',
        productId,
        sortOrder: 1,
      })
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('SET CONSTRAINTS ALL DEFERRED')

      await expectDatabaseRejection(
        client,
        () => insertProductMedia(client, {
          actorUserId,
          assetId: secondaryAssetId,
          kind: 'IMAGE',
          productId,
          sortOrder: 2,
        }),
        '23505',
        'product_media_active_product_asset_key',
        savepointIndex++,
      )

      await expectDatabaseRejection(
        client,
        async () => {
          const videoAssetId = await insertUploadingAsset(client, actorUserId, 'VIDEO')
          await activateAsset(client, videoAssetId, 'VIDEO')
          await insertProductMedia(client, {
            actorUserId,
            assetId: videoAssetId,
            isPrimary: true,
            kind: 'VIDEO',
            productId,
            sortOrder: 0,
          })
        },
        '23514',
        'product_media_primary_image_check',
        savepointIndex++,
      )

      await expectDatabaseRejection(
        client,
        () => client.query(
          `
            UPDATE "product_media"
            SET "detached_at" = CURRENT_TIMESTAMP
            WHERE "id" = $1
          `,
          [secondaryProductMediaId],
        ),
        '23514',
        'product_media_detachment_pair_check',
        savepointIndex++,
      )

      await expectDatabaseRejection(
        client,
        () => client.query(
          `
            UPDATE "media_assets"
            SET
              "status" = 'TRASHED',
              "deleted_at" = CURRENT_TIMESTAMP,
              "retention_until" = CURRENT_TIMESTAMP + INTERVAL '7 days'
            WHERE "id" = $1
          `,
          [secondaryAssetId],
        ),
        '23514',
        'media_assets_active_reference_check',
        savepointIndex++,
      )

      await expectDatabaseRejection(
        client,
        () => client.query(
          `
            UPDATE "product_media"
            SET
              "detached_at" = CURRENT_TIMESTAMP,
              "detached_by_user_id" = $2
            WHERE "id" = $1
          `,
          [secondaryProductMediaId, actorUserId],
        ),
        '23514',
        'media_assets_ready_reference_check',
        savepointIndex++,
        true,
      )

      await client.query(
        `
          UPDATE "product_media"
          SET
            "detached_at" = CURRENT_TIMESTAMP,
            "detached_by_user_id" = $2,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = $1
        `,
        [secondaryProductMediaId, actorUserId],
      )
      await client.query(
        `
          UPDATE "media_assets"
          SET
            "status" = 'TRASHED',
            "deleted_at" = CURRENT_TIMESTAMP,
            "retention_until" = CURRENT_TIMESTAMP + INTERVAL '7 days',
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = $1
        `,
        [secondaryAssetId],
      )
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('SET CONSTRAINTS ALL DEFERRED')

      await expectDatabaseRejection(
        client,
        () => client.query(
          'UPDATE "media_assets" SET "object_key" = $2 WHERE "id" = $1',
          [secondaryAssetId, `media/e2e/${randomUUID()}`],
        ),
        '23514',
        // 键改写改由受控通道裁决：没有登记键对时与原来一样被硬拒，只是约束名不同。
        'media_assets_object_key_rewrite_check',
        savepointIndex++,
      )
      await expectDatabaseRejection(
        client,
        () => client.query(
          'DELETE FROM "product_media" WHERE "id" = $1',
          [secondaryProductMediaId],
        ),
        '23514',
        'product_media_soft_detach_check',
        savepointIndex++,
      )

      const activeRows = await client.query<{ id: string }>(
        `
          SELECT "id"
          FROM "product_media"
          WHERE "product_id" = $1
            AND "detached_at" IS NULL
          ORDER BY "sort_order", "id"
        `,
        [productId],
      )
      expect(activeRows.rows).toEqual([{ id: primaryProductMediaId }])
    }
    finally {
      await client.query('ROLLBACK')
    }
  })

  it('rewrites an object key only through a registered migration key pair', async () => {
    await client.query('BEGIN')
    try {
      const actorUserId = randomUUID()
      const username = `media_key_e2e_${randomUUID().replaceAll('-', '')}`
      await client.query(
        `
          INSERT INTO "users" (
            "id",
            "username",
            "username_normalized",
            "display_name",
            "password_hash",
            "password_changed_at",
            "updated_at"
          )
          VALUES ($1, $2, $2, 'Media Key E2E', 'not-used', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [actorUserId, username],
      )

      const assetId = await insertUploadingAsset(client, actorUserId, 'IMAGE')
      const otherAssetId = await insertUploadingAsset(client, actorUserId, 'IMAGE')
      const oldKey = `assets/2026/08/${assetId}.webp`
      const newKey = `assets/dev/product/2026/08/${assetId}.webp`
      // 走 UPLOADING → FAILED → PURGED：PURGED 属于内容身份锁定态，且不需要领域引用即可构造。
      await client.query(
        `
          UPDATE "media_assets"
          SET
            "object_key" = $2,
            "mime_type" = 'image/webp',
            "size_bytes" = 321,
            "checksum_sha256" = $3,
            "width" = 640,
            "height" = 480,
            "status" = 'FAILED',
            "failure_code" = 'MEDIA_ASSET_STORAGE_FAILED'
          WHERE "id" = $1
        `,
        [assetId, oldKey, 'c'.repeat(64)],
      )
      await client.query(
        `
          UPDATE "media_assets"
          SET
            "status" = 'PURGED',
            "deleted_at" = CURRENT_TIMESTAMP,
            "upload_expires_at" = NULL
          WHERE "id" = $1
        `,
        [assetId],
      )

      let savepointIndex = 0
      await expectDatabaseRejection(
        client,
        () => client.query(
          'UPDATE "media_assets" SET "object_key" = $2 WHERE "id" = $1',
          [assetId, newKey],
        ),
        '23514',
        'media_assets_object_key_rewrite_check',
        savepointIndex++,
      )
      // 键对登记必须与资产绑定：登记在别的资产名下时这条改写仍然被拒。
      await expectDatabaseRejection(
        client,
        async () => {
          await client.query(
            `
              INSERT INTO "media_object_key_migrations" ("asset_id", "old_key", "new_key")
              VALUES ($1, $2, $3)
            `,
            [otherAssetId, oldKey, newKey],
          )
          await client.query(
            'UPDATE "media_assets" SET "object_key" = $2 WHERE "id" = $1',
            [assetId, newKey],
          )
        },
        '23514',
        'media_assets_object_key_rewrite_check',
        savepointIndex++,
      )

      await client.query(
        `
          INSERT INTO "media_object_key_migrations" ("asset_id", "old_key", "new_key")
          VALUES ($1, $2, $3)
        `,
        [assetId, oldKey, newKey],
      )
      const forward = await client.query(
        'UPDATE "media_assets" SET "object_key" = $2 WHERE "id" = $1',
        [assetId, newKey],
      )
      expect(forward.rowCount).toBe(1)
      await client.query(
        `
          UPDATE "media_object_key_migrations"
          SET "applied_at" = CURRENT_TIMESTAMP
          WHERE "asset_id" = $1
        `,
        [assetId],
      )
      // 反方向同样放行：回滚走的是同一个登记键对。
      const reversed = await client.query(
        'UPDATE "media_assets" SET "object_key" = $2 WHERE "id" = $1',
        [assetId, oldKey],
      )
      expect(reversed.rowCount).toBe(1)

      // 登记只对 object_key 生效：其余内容身份列仍然完全不可变。
      await expectDatabaseRejection(
        client,
        () => client.query(
          'UPDATE "media_assets" SET "checksum_sha256" = $2 WHERE "id" = $1',
          [assetId, 'd'.repeat(64)],
        ),
        '23514',
        'media_assets_content_identity_immutable_check',
        savepointIndex++,
      )

      const stored = await client.query<{ objectKey: string | null }>(
        'SELECT "object_key" AS "objectKey" FROM "media_assets" WHERE "id" = $1',
        [assetId],
      )
      expect(stored.rows).toEqual([{ objectKey: oldKey }])
    }
    finally {
      await client.query('ROLLBACK')
    }
  })

  it('retains truthful PURGED facts for both unmaterialized and prepared expired uploads', async () => {
    await client.query('BEGIN')
    try {
      const actorUserId = randomUUID()
      const username = `media_purge_e2e_${randomUUID().replaceAll('-', '')}`
      await client.query(
        `
          INSERT INTO "users" (
            "id",
            "username",
            "username_normalized",
            "display_name",
            "password_hash",
            "password_changed_at",
            "updated_at"
          )
          VALUES ($1, $2, $2, 'Media Purge E2E', 'not-used', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [actorUserId, username],
      )

      const unmaterializedId = await insertUploadingAsset(
        client,
        actorUserId,
        'IMAGE',
      )
      await client.query(
        `
          UPDATE "media_assets"
          SET "status" = 'FAILED', "failure_code" = 'MEDIA_ASSET_UPLOAD_EXPIRED'
          WHERE "id" = $1
        `,
        [unmaterializedId],
      )
      await client.query(
        `
          UPDATE "media_assets"
          SET
            "status" = 'PURGED',
            "deleted_at" = CURRENT_TIMESTAMP,
            "upload_expires_at" = NULL
          WHERE "id" = $1
        `,
        [unmaterializedId],
      )

      const preparedId = await insertUploadingAsset(client, actorUserId, 'IMAGE')
      await client.query(
        `
          UPDATE "media_assets"
          SET
            "object_key" = $2,
            "mime_type" = 'image/webp',
            "size_bytes" = 321,
            "checksum_sha256" = $3,
            "width" = 640,
            "height" = 480,
            "status" = 'FAILED',
            "failure_code" = 'MEDIA_ASSET_STORAGE_FAILED'
          WHERE "id" = $1
        `,
        [preparedId, `assets/2026/08/${preparedId}.webp`, 'b'.repeat(64)],
      )
      await client.query(
        `
          UPDATE "media_assets"
          SET
            "status" = 'PURGED',
            "deleted_at" = CURRENT_TIMESTAMP,
            "upload_expires_at" = NULL
          WHERE "id" = $1
        `,
        [preparedId],
      )

      const purged = await client.query<{
        checksumSha256: string | null
        objectKey: string | null
        status: string
      }>(
        `
          SELECT
            "status"::text,
            "object_key" AS "objectKey",
            "checksum_sha256" AS "checksumSha256"
          FROM "media_assets"
          WHERE "id" IN ($1, $2)
          ORDER BY "id"
        `,
        [unmaterializedId, preparedId],
      )
      expect(purged.rows).toEqual(expect.arrayContaining([
        {
          checksumSha256: null,
          objectKey: null,
          status: 'PURGED',
        },
        {
          checksumSha256: 'b'.repeat(64),
          objectKey: `assets/2026/08/${preparedId}.webp`,
          status: 'PURGED',
        },
      ]))

      await expectDatabaseRejection(
        client,
        () => client.query(
          `
            INSERT INTO "media_assets" (
              "media_type",
              "status",
              "original_filename",
              "object_key",
              "failure_code",
              "deleted_at",
              "created_by_user_id"
            )
            VALUES (
              'IMAGE',
              'PURGED',
              'partial.webp',
              'assets/2026/08/partial.webp',
              'MEDIA_ASSET_UPLOAD_EXPIRED',
              CURRENT_TIMESTAMP,
              $1
            )
          `,
          [actorUserId],
        ),
        '23514',
        'media_assets_state_metadata_check',
        0,
      )
    }
    finally {
      await client.query('ROLLBACK')
    }
  })

  it('lets only one worker claim the same expired asset with SKIP LOCKED', async () => {
    const actorUserId = randomUUID()
    const assetId = randomUUID()
    const username = `media_claim_e2e_${randomUUID().replaceAll('-', '')}`
    const firstWorker = new Client({ connectionString: requireDatabaseUrl() })
    const secondWorker = new Client({ connectionString: requireDatabaseUrl() })
    const claimSql = `
      SELECT "id"
      FROM "media_assets"
      WHERE "status" IN ('UPLOADING', 'FAILED')
        AND COALESCE(
          "upload_expires_at",
          "updated_at" + INTERVAL '24 hours'
        ) <= CURRENT_TIMESTAMP
      ORDER BY
        COALESCE("upload_expires_at", "updated_at" + INTERVAL '24 hours'),
        "id"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `

    try {
      await client.query(
        `
          INSERT INTO "users" (
            "id",
            "username",
            "username_normalized",
            "display_name",
            "password_hash",
            "password_changed_at",
            "updated_at"
          )
          VALUES ($1, $2, $2, 'Media Claim E2E', 'not-used', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [actorUserId, username],
      )
      await client.query(
        `
          INSERT INTO "media_assets" (
            "id",
            "media_type",
            "original_filename",
            "upload_expires_at",
            "created_by_user_id"
          )
          VALUES ($1, 'IMAGE', 'claim.webp', CURRENT_TIMESTAMP - INTERVAL '1 hour', $2)
        `,
        [assetId, actorUserId],
      )

      await Promise.all([firstWorker.connect(), secondWorker.connect()])
      await firstWorker.query('BEGIN')
      const firstClaim = await firstWorker.query<{ id: string }>(claimSql)
      await secondWorker.query('BEGIN')
      const secondClaim = await secondWorker.query<{ id: string }>(claimSql)

      expect(firstClaim.rows).toEqual([{ id: assetId }])
      expect(secondClaim.rows).toEqual([])
    }
    finally {
      await firstWorker.query('ROLLBACK').catch(() => undefined)
      await secondWorker.query('ROLLBACK').catch(() => undefined)
      await Promise.all([
        firstWorker.end().catch(() => undefined),
        secondWorker.end().catch(() => undefined),
      ])
      await client.query('DELETE FROM "media_assets" WHERE "id" = $1', [assetId])
      await client.query('DELETE FROM "users" WHERE "id" = $1', [actorUserId])
    }
  })
})
