import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { MEDIA_STORAGE_DRIVERS } from '../../config/media.config'
import {
  MANAGEMENT_PERMISSION_CODES,
  PRODUCT_MEDIA_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20260813120000_media_asset_product_media_schema'
const reconciliationMigrationDirectory =
  '20260814120000_media_asset_reconciliation_constraints'
const permissionId = '00000000-0000-4000-8000-000000000146'

function extractPrismaBlock(source: string, kind: 'enum' | 'model', name: string): string {
  const match = source.match(
    new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`, 'u'),
  )
  if (!match?.[1]) throw new Error(`Missing Prisma ${kind} ${name}`)
  return match[1]
}

function readMigration(): string {
  return readFileSync(
    resolve(migrationsRoot, migrationDirectory, 'migration.sql'),
    'utf8',
  )
}

describe('media asset and product media schema', () => {
  it('keeps the exact media enums and relations after the Product query cutover', () => {
    const schema = readFileSync(schemaPath, 'utf8')

    expect(extractPrismaBlock(schema, 'enum', 'MediaType')).toMatch(
      /IMAGE\s+VIDEO\s+DOCUMENT\s+@@map\("media_type"\)/u,
    )
    expect(extractPrismaBlock(schema, 'enum', 'MediaAssetStatus')).toMatch(
      /UPLOADING\s+READY\s+FAILED\s+TRASHED\s+PURGED\s+@@map\("media_asset_status"\)/u,
    )
    expect(extractPrismaBlock(schema, 'enum', 'ProductMediaKind')).toMatch(
      /IMAGE\s+VIDEO\s+@@map\("product_media_kind"\)/u,
    )
    expect(extractPrismaBlock(schema, 'enum', 'ProductMediaKind')).not.toContain(
      'DOCUMENT',
    )

    const mediaAsset = extractPrismaBlock(schema, 'model', 'MediaAsset')
    const productMedia = extractPrismaBlock(schema, 'model', 'ProductMedia')
    const product = extractPrismaBlock(schema, 'model', 'Product')
    const user = extractPrismaBlock(schema, 'model', 'User')

    for (const field of [
      'mediaType',
      'status',
      'storageDriver',
      'objectKey',
      'originalFilename',
      'mimeType',
      'sizeBytes',
      'checksumSha256',
      'width',
      'height',
      'durationMs',
      'videoCodec',
      'audioCodec',
      'uploadExpiresAt',
      'retentionUntil',
      'failureCode',
      'createdByUserId',
      'deletedAt',
    ]) {
      expect(mediaAsset).toMatch(new RegExp(`^\\s*${field}\\s`, 'mu'))
    }
    expect(mediaAsset).toContain('@@map("media_assets")')

    for (const field of [
      'productId',
      'mediaAssetId',
      'kind',
      'sortOrder',
      'isPrimary',
      'createdByUserId',
      'detachedByUserId',
      'detachedAt',
    ]) {
      expect(productMedia).toMatch(new RegExp(`^\\s*${field}\\s`, 'mu'))
    }
    expect(productMedia).toContain('@@map("product_media")')

    expect(product).not.toMatch(/^\s*mainImage\s/mu)
    expect(product).not.toMatch(/^\s*images\s/mu)
    expect(product).not.toMatch(/^\s*videos\s/mu)
    expect(product).toMatch(/^\s*media\s+ProductMedia\[\]/mu)
    expect(user).toMatch(/^\s*mediaAssetsCreated\s+MediaAsset\[\]/mu)
    expect(user).toMatch(/^\s*productMediaCreated\s+ProductMedia\[\]/mu)
    expect(user).toMatch(/^\s*productMediaDetached\s+ProductMedia\[\]/mu)
  })

  it('keeps append-only media migrations with exact named checks, foreign keys and indexes', () => {
    const matchingDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && (
        entry.name.includes('media_asset_product_media') ||
        entry.name.includes('media_asset_reconciliation_constraints')
      ))
      .map(entry => entry.name)
      .sort()
    expect(matchingDirectories).toEqual([
      migrationDirectory,
      reconciliationMigrationDirectory,
    ])

    const migration = readMigration()
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).not.toMatch(/ALTER TABLE "products" DROP COLUMN/u)

    for (const enumDeclaration of [
      `CREATE TYPE "media_type" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');`,
      `CREATE TYPE "media_asset_status" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'TRASHED', 'PURGED');`,
      `CREATE TYPE "product_media_kind" AS ENUM ('IMAGE', 'VIDEO');`,
    ]) {
      expect(migration).toContain(enumDeclaration)
    }

    for (const tableName of ['media_assets', 'product_media']) {
      expect(migration).toContain(`CREATE TABLE "${tableName}"`)
    }

    for (const constraintName of [
      'media_assets_pkey',
      'media_assets_object_key_key',
      'media_assets_storage_driver_check',
      'media_assets_size_bytes_nonnegative_check',
      'media_assets_dimensions_positive_check',
      'media_assets_duration_positive_check',
      'media_assets_checksum_sha256_check',
      'media_assets_object_key_check',
      'media_assets_state_metadata_check',
      'media_assets_type_metadata_check',
      'media_assets_created_by_user_id_fkey',
      'product_media_pkey',
      'product_media_sort_order_nonnegative_check',
      'product_media_primary_image_check',
      'product_media_detachment_pair_check',
      'product_media_product_id_fkey',
      'product_media_media_asset_id_fkey',
      'product_media_created_by_user_id_fkey',
      'product_media_detached_by_user_id_fkey',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraintName}"`)
    }

    for (const indexName of [
      'media_assets_status_upload_expires_at_id_idx',
      'media_assets_status_retention_until_id_idx',
      'product_media_active_product_asset_key',
      'product_media_active_product_kind_sort_order_key',
      'product_media_active_product_primary_key',
      'product_media_active_product_kind_sort_order_id_idx',
      'product_media_active_media_asset_id_idx',
    ]) {
      expect(migration).toContain(`INDEX "${indexName}"`)
    }
  })

  it('allows a never-materialized expired upload to retain a truthful PURGED fact', () => {
    const migration = readFileSync(
      resolve(
        migrationsRoot,
        reconciliationMigrationDirectory,
        'migration.sql',
      ),
      'utf8',
    )

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain('DROP CONSTRAINT "media_assets_state_metadata_check"')
    expect(migration).toContain('DROP CONSTRAINT "media_assets_type_metadata_check"')
    expect(migration).toMatch(
      /"status" = 'PURGED'[\s\S]*?"object_key" IS NULL[\s\S]*?"checksum_sha256" IS NULL/u,
    )
    expect(migration).toMatch(
      /"status" = 'PURGED'[\s\S]*?"object_key" IS NOT NULL[\s\S]*?"checksum_sha256" IS NOT NULL/u,
    )
    expect(migration).not.toMatch(/UPDATE "media_assets"/u)
    expect(migration).not.toMatch(/DELETE FROM "media_assets"/u)
  })

  it('enforces READY reference safety and ProductMedia type matching in PostgreSQL', () => {
    const migration = readMigration()

    for (const functionName of [
      'enforce_media_asset_invariants',
      'enforce_product_media_invariants',
      'enforce_product_media_asset_reference',
      'enforce_ready_media_asset_reference',
    ]) {
      expect(migration).toContain(`CREATE FUNCTION "${functionName}"()`)
    }
    expect(migration).toMatch(
      /CREATE TRIGGER "media_assets_invariants_trigger"[\s\S]*?BEFORE UPDATE ON "media_assets"/u,
    )
    expect(migration).toMatch(
      /CREATE TRIGGER "product_media_invariants_trigger"[\s\S]*?BEFORE UPDATE OR DELETE ON "product_media"/u,
    )
    expect(migration).toMatch(
      /CREATE CONSTRAINT TRIGGER "product_media_asset_reference_trigger"[\s\S]*?AFTER INSERT OR UPDATE ON "product_media"[\s\S]*?NOT DEFERRABLE INITIALLY IMMEDIATE/u,
    )
    expect(migration).toMatch(
      /CREATE CONSTRAINT TRIGGER "media_assets_ready_reference_trigger"[\s\S]*?AFTER INSERT OR UPDATE ON "media_assets"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/u,
    )
    expect(migration).toMatch(
      /CREATE CONSTRAINT TRIGGER "product_media_ready_reference_trigger"[\s\S]*?AFTER INSERT OR UPDATE OR DELETE ON "product_media"[\s\S]*?DEFERRABLE INITIALLY DEFERRED/u,
    )
    expect(migration).toMatch(/asset_status <> 'READY'/u)
    expect(migration).toMatch(
      /NEW\."kind"::text <> asset_media_type::text/u,
    )
    expect(migration).toMatch(
      /OLD\."status" = 'READY'[\s\S]*?NEW\."status" <> 'READY'[\s\S]*?FROM "product_media"[\s\S]*?"detached_at" IS NULL/u,
    )
    expect(migration).toMatch(
      /current_status = 'READY'[\s\S]*?NOT EXISTS[\s\S]*?FROM "product_media"[\s\S]*?"detached_at" IS NULL/u,
    )
    for (const triggerConstraintName of [
      'media_assets_state_transition_check',
      'media_assets_content_identity_immutable_check',
      'media_assets_active_reference_check',
      'product_media_soft_detach_check',
      'product_media_identity_immutable_check',
      'product_media_asset_ready_check',
      'product_media_asset_type_check',
      'media_assets_ready_reference_check',
    ]) {
      expect(migration).toContain(
        "CONSTRAINT = '" + triggerConstraintName + "'",
      )
    }
  })

  it('seeds the stable product media read permission and grants system_admin', () => {
    expect(PRODUCT_MEDIA_PERMISSION_CODES).toEqual(['product-media:read'])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...PRODUCT_MEDIA_PERMISSION_CODES]),
    )
    expect(new Set(MANAGEMENT_PERMISSION_CODES).size).toBe(
      MANAGEMENT_PERMISSION_CODES.length,
    )

    const migration = readMigration()
    expect(migration).toMatch(
      new RegExp(
        `'${permissionId}',\\s*'product-media:read',\\s*'读取产品媒体'[\\s\\S]*?false`,
        'u',
      ),
    )
    expect(migration).toMatch(
      new RegExp(
        `role\\."id" = '00000000-0000-4000-8000-000000000001'[\\s\\S]*?role\\."code" = 'system_admin'[\\s\\S]*?permission\\."id" = '${permissionId}'[\\s\\S]*?permission\\."code" = 'product-media:read'`,
        'u',
      ),
    )
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    expect(migration).toContain(
      'media schema migration invariant mismatch: permission catalog',
    )
    expect(migration).toContain(
      'media schema migration invariant mismatch: system admin grant',
    )
  })

  it('keeps the media storage driver check in sync with the supported drivers', () => {
    // 逐迁移取该约束的最后一次定义：首期建表只允许 local，后续迁移可以放松它。
    const definitions = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
      .flatMap((directory) => {
        const source = readFileSync(
          resolve(migrationsRoot, directory, 'migration.sql'),
          'utf8',
        )
        return [...source.matchAll(
          /"media_assets_storage_driver_check"[\s\S]{0,64}?CHECK \(([^)]*)\)/gu,
        )].map(match => match[1] ?? '')
      })
    const latest = definitions.at(-1)
    expect(latest).toBeDefined()

    const databaseDrivers = [
      ...(latest ?? '').matchAll(/'([a-z0-9_-]+)'/gu),
    ].map(match => match[1]).sort()

    // 数据库允许的枚举与代码允许的驱动必须完全一致：数据库更严会让上传写不进库，
    // 代码更严则等于放弃这条守卫（v0.3.0 的 COS 写入故障就是前者）。
    expect(databaseDrivers).toEqual([...MEDIA_STORAGE_DRIVERS].sort())
  })
})
