import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations/20261007140000_media_object_key_migration_channel/migration.sql',
)

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8')
}

/** 取出不可变元组比较里的两个 ROW(...)，用来断言 object_key 已经被移出该比较。 */
function immutableTupleColumns(sql: string): string[] {
  const block = sql.match(
    /OLD\."status" IN \('READY', 'TRASHED', 'PURGED'\)[\s\S]*?media_assets_content_identity_immutable_check/u,
  )?.[0]
  if (block === undefined) throw new Error('Missing immutable content identity branch')

  return [...block.matchAll(/ROW\(([\s\S]*?)\) IS DISTINCT FROM ROW\(/gu)]
    .flatMap(match => [...(match[1] ?? '').matchAll(/OLD\."([a-z0-9_]+)"/gu)])
    .map(match => match[1] ?? '')
}

describe('media object key migration channel schema', () => {
  it('registers key pairs in a dedicated table with a cascading asset reference', () => {
    const migration = readMigration()

    expect(migration).toMatch(
      /CREATE TABLE "media_object_key_migrations" \([\s\S]*?"asset_id" UUID NOT NULL[\s\S]*?"old_key" VARCHAR\(512\) NOT NULL[\s\S]*?"new_key" VARCHAR\(512\) NOT NULL[\s\S]*?"planned_at" TIMESTAMPTZ\(6\) NOT NULL DEFAULT CURRENT_TIMESTAMP[\s\S]*?"applied_at" TIMESTAMPTZ\(6\),/u,
    )
    expect(migration).toMatch(
      /CONSTRAINT "media_object_key_migrations_pkey" PRIMARY KEY \("asset_id"\)/u,
    )
    expect(migration).toMatch(
      /CONSTRAINT "media_object_key_migrations_asset_id_fkey" FOREIGN KEY \("asset_id"\) REFERENCES "media_assets"\("id"\) ON DELETE CASCADE ON UPDATE RESTRICT/u,
    )
  })

  it('keeps the migration-only table in sync with the Prisma model', () => {
    const schema = readFileSync(schemaPath, 'utf8')
    const model = schema.match(
      /model MediaObjectKeyMigration \{([\s\S]*?)\n\}/u,
    )?.[1]
    if (model === undefined) throw new Error('Missing MediaObjectKeyMigration model')

    expect(model).toMatch(/assetId\s+String\s+@id\s+@map\("asset_id"\)\s+@db\.Uuid/u)
    expect(model).toMatch(/oldKey\s+String\s+@map\("old_key"\)\s+@db\.VarChar\(512\)/u)
    expect(model).toMatch(/newKey\s+String\s+@map\("new_key"\)\s+@db\.VarChar\(512\)/u)
    expect(model).toMatch(/plannedAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("planned_at"\)\s+@db\.Timestamptz\(6\)/u)
    expect(model).toMatch(/appliedAt\s+DateTime\?\s+@map\("applied_at"\)/u)
    expect(model).toMatch(/@@map\("media_object_key_migrations"\)/u)
  })

  it('allows rewriting object_key only for a registered pair, in both directions', () => {
    const migration = readMigration()

    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION "enforce_media_asset_invariants"\(\)/u,
    )
    // 没有登记行时仍然硬拒：受控通道不是「可以随便改键」。
    expect(migration).toMatch(
      /NEW\."object_key" IS DISTINCT FROM OLD\."object_key"[\s\S]*?NOT EXISTS \([\s\S]*?FROM "media_object_key_migrations" AS migration[\s\S]*?migration\."asset_id" = OLD\."id"/u,
    )
    expect(migration).toContain(
      "CONSTRAINT = 'media_assets_object_key_rewrite_check'",
    )
    // 正向迁移与反向回滚都要放行，且都必须命中同一个 asset 的登记行。
    expect(migration).toMatch(
      /migration\."old_key" = OLD\."object_key"\s+AND migration\."new_key" = NEW\."object_key"/u,
    )
    expect(migration).toMatch(
      /migration\."old_key" = NEW\."object_key"\s+AND migration\."new_key" = OLD\."object_key"/u,
    )
  })

  it('moves object_key out of the immutable tuple without shrinking the rest', () => {
    const migration = readMigration()
    const columns = immutableTupleColumns(migration)

    expect(columns).not.toContain('object_key')
    expect(columns).toEqual([
      'media_type',
      'storage_driver',
      'original_filename',
      'mime_type',
      'size_bytes',
      'checksum_sha256',
      'width',
      'height',
      'duration_ms',
      'video_codec',
      'audio_codec',
      'created_by_user_id',
      'created_at',
    ])
    // 状态边与 READY 活跃引用两条既有不变量必须原样保留。
    expect(migration).toMatch(
      /\(OLD\."status" = 'UPLOADING' AND NEW\."status" IN \('READY', 'FAILED'\)\)[\s\S]*?\(OLD\."status" = 'FAILED' AND NEW\."status" = 'PURGED'\)/u,
    )
    expect(migration).toContain(
      "CONSTRAINT = 'media_assets_state_transition_check'",
    )
    expect(migration).toContain(
      "CONSTRAINT = 'media_assets_active_reference_check'",
    )
  })
})
