import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationDirectory = '20260814160000_product_media_query_cutover'
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations',
  migrationDirectory,
  'migration.sql',
)

function extractProductModel(schema: string): string {
  const match = schema.match(/model Product \{([\s\S]*?)\n\}/u)
  if (!match?.[1]) throw new Error('Missing Prisma Product model')
  return match[1]
}

describe('Product media query cutover schema', () => {
  it('removes only the three legacy URL fields from the Prisma Product model', () => {
    const product = extractProductModel(readFileSync(schemaPath, 'utf8'))

    expect(product).not.toMatch(/^\s*mainImage\s/mu)
    expect(product).not.toMatch(/^\s*images\s/mu)
    expect(product).not.toMatch(/^\s*videos\s/mu)
    expect(product).toMatch(/^\s*media\s+ProductMedia\[\]/mu)
    for (const field of [
      'name',
      'productNo',
      'status',
      'supplierValue',
      'twdSalePriceAmount',
      'myrSalePriceAmount',
      'purchaseCostAmount',
      'attributes',
      'version',
    ]) {
      expect(product).toMatch(new RegExp(`^\\s*${field}\\s`, 'mu'))
    }
  })

  it('locks and fails closed on exact legacy counts before dropping only those columns', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain('LOCK TABLE "products" IN ACCESS EXCLUSIVE MODE;')
    expect(migration).toContain('main_image_count')
    expect(migration).toContain('images_count')
    expect(migration).toContain('videos_count')
    expect(migration).toContain('sample_product_ids')
    expect(migration).toMatch(/RAISE EXCEPTION[\s\S]*?product media cutover blocked/u)
    expect(migration).toMatch(
      /ALTER TABLE "products"\s+DROP COLUMN "main_image",\s+DROP COLUMN "images",\s+DROP COLUMN "videos";/u,
    )
    expect(migration.match(/DROP COLUMN/gu)).toHaveLength(3)
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu)
    expect(migration).not.toMatch(/https?:\/\//iu)
  })
})
