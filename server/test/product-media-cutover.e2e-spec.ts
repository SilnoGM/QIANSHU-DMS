import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

const serverRoot = resolve(__dirname, '..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const cutoverMigrationDirectory = '20260814160000_product_media_query_cutover'
const cutoverMigrationPath = resolve(
  migrationsRoot,
  cutoverMigrationDirectory,
  'migration.sql',
)

const describeExclusive = process.env.PRODUCT_MEDIA_CUTOVER_E2E_EXCLUSIVE === '1'
  ? describe
  : describe.skip

function requireCiDatabaseUrl(): string {
  const rawValue = process.env.DATABASE_URL
  if (typeof rawValue !== 'string') {
    throw new Error('Product media cutover E2E CI database URL is required')
  }

  let url: URL
  try {
    url = new URL(rawValue)
  }
  catch {
    throw new Error('Product media cutover E2E CI database URL is invalid')
  }
  const query = [...url.searchParams.entries()]
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || url.username !== 'qianshu_ci'
    || url.password.length === 0
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || !/^\d{1,5}$/u.test(url.port)
    || url.pathname !== '/qianshu_ci'
    || url.hash !== ''
    || JSON.stringify(query) !== JSON.stringify([['schema', 'public']])
  ) {
    throw new Error('Product media cutover E2E database URL is outside CI boundary')
  }
  return url.toString()
}

function quoteTestSchema(identifier: string): string {
  if (!/^product_media_cutover_[a-f0-9]{32}$/u.test(identifier)) {
    throw new Error('Product media cutover E2E schema name is invalid')
  }
  return `"${identifier}"`
}

function readDatabaseError(error: unknown): { code?: unknown; message?: unknown } {
  if (typeof error !== 'object' || error === null) return {}
  return {
    code: Reflect.get(error, 'code'),
    message: Reflect.get(error, 'message'),
  }
}

function readPreCutoverMigrations(): readonly string[] {
  const directories = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  const cutoverIndex = directories.indexOf(cutoverMigrationDirectory)
  if (cutoverIndex <= 0) {
    throw new Error('Product media cutover migration order is invalid')
  }
  return directories.slice(0, cutoverIndex).map(directory => readFileSync(
    resolve(migrationsRoot, directory, 'migration.sql'),
    'utf8',
  ))
}

async function productColumns(client: Client, schemaName: string): Promise<string[]> {
  const result = await client.query<{ columnName: string }>(
    `
      SELECT "column_name" AS "columnName"
      FROM "information_schema"."columns"
      WHERE "table_schema" = $1 AND "table_name" = 'products'
      ORDER BY "ordinal_position"
    `,
    [schemaName],
  )
  return result.rows.map(row => row.columnName)
}

async function expectBlockedCutover(
  client: Client,
  expectedMessageParts: readonly string[],
): Promise<void> {
  try {
    await client.query(readFileSync(cutoverMigrationPath, 'utf8'))
  }
  catch (error) {
    const databaseError = readDatabaseError(error)
    await client.query('ROLLBACK')
    expect(databaseError.code).toBe('P0001')
    expect(typeof databaseError.message).toBe('string')
    for (const part of expectedMessageParts) {
      expect(databaseError.message).toContain(part)
    }
    return
  }
  throw new Error('Expected Product media cutover migration to stop')
}

describeExclusive('Product media cutover migration with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)

  it('fails on each legacy field, succeeds only when empty, preserves rows and rehearses recovery', async () => {
    const client = new Client({ connectionString: requireCiDatabaseUrl() })
    const schemaName = `product_media_cutover_${randomUUID().replaceAll('-', '')}`
    const quotedSchema = quoteTestSchema(schemaName)
    const productId = randomUUID()
    let schemaCreated = false

    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`)
      schemaCreated = true
      await client.query(`SET search_path TO ${quotedSchema}, public`)
      for (const migration of readPreCutoverMigrations()) {
        await client.query(migration)
      }
      await client.query(
        `
          INSERT INTO "products" ("id", "name", "product_no", "supplier_value")
          VALUES ($1, 'Cutover E2E Product', 'CUTOVER-E2E-001', 'CUTOVER_SUPPLIER')
        `,
        [productId],
      )

      await client.query(
        `UPDATE "products" SET "main_image" = $1 WHERE "id" = $2`,
        ['https://example.invalid/must-not-be-read', productId],
      )
      await expectBlockedCutover(client, [
        'main_image_count=1',
        'images_count=0',
        'videos_count=0',
        `sample_product_ids=${productId}`,
      ])
      await client.query(
        `UPDATE "products" SET "main_image" = NULL WHERE "id" = $1`,
        [productId],
      )

      await client.query(
        `UPDATE "products" SET "images" = ARRAY[$1]::text[] WHERE "id" = $2`,
        ['https://example.invalid/must-not-be-read', productId],
      )
      await expectBlockedCutover(client, [
        'main_image_count=0',
        'images_count=1',
        'videos_count=0',
        `sample_product_ids=${productId}`,
      ])
      await client.query(
        `UPDATE "products" SET "images" = ARRAY[]::text[] WHERE "id" = $1`,
        [productId],
      )

      await client.query(
        `UPDATE "products" SET "videos" = ARRAY[$1]::text[] WHERE "id" = $2`,
        ['https://example.invalid/must-not-be-read', productId],
      )
      await expectBlockedCutover(client, [
        'main_image_count=0',
        'images_count=0',
        'videos_count=1',
        `sample_product_ids=${productId}`,
      ])
      await client.query(
        `UPDATE "products" SET "videos" = ARRAY[]::text[] WHERE "id" = $1`,
        [productId],
      )

      await client.query(readFileSync(cutoverMigrationPath, 'utf8'))
      const afterCutoverColumns = await productColumns(client, schemaName)
      expect(afterCutoverColumns).not.toEqual(expect.arrayContaining([
        'main_image',
        'images',
        'videos',
      ]))
      const product = await client.query<{
        name: string
        productNo: string
        version: number
      }>(
        `
          SELECT "name", "product_no" AS "productNo", "version"
          FROM "products" WHERE "id" = $1
        `,
        [productId],
      )
      expect(product.rows).toEqual([{
        name: 'Cutover E2E Product',
        productNo: 'CUTOVER-E2E-001',
        version: 1,
      }])

      // DROP 的三列在门禁下必为空；恢复演练只在一次性 schema 中按原定义加回，
      // 验证行数和默认值后再次执行正式 cutover，不建立生产 down migration。
      await client.query(`
        BEGIN;
        LOCK TABLE "products" IN ACCESS EXCLUSIVE MODE;
        ALTER TABLE "products"
          ADD COLUMN "main_image" VARCHAR(2048),
          ADD COLUMN "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          ADD COLUMN "videos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
        COMMIT;
      `)
      const recovered = await client.query<{
        images: string[]
        mainImage: string | null
        videos: string[]
      }>(
        `
          SELECT
            "main_image" AS "mainImage",
            "images",
            "videos"
          FROM "products" WHERE "id" = $1
        `,
        [productId],
      )
      expect(recovered.rows).toEqual([{
        mainImage: null,
        images: [],
        videos: [],
      }])
      await client.query(readFileSync(cutoverMigrationPath, 'utf8'))
      expect(await productColumns(client, schemaName)).not.toEqual(
        expect.arrayContaining(['main_image', 'images', 'videos']),
      )
    }
    finally {
      await client.query('ROLLBACK').catch(() => undefined)
      if (schemaCreated) {
        await client.query('SET search_path TO public').catch(() => undefined)
        await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`)
          .catch(() => undefined)
      }
      await client.end()
    }
  })
})
