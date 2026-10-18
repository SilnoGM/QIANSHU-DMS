import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260812090000_product_list_schema/migration.sql',
)

function readSchema(): string {
  return readFileSync(schemaPath, 'utf8')
}

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8')
}

function extractModel(schema: string, modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`),
  )
  if (!match?.[1]) throw new Error(`Missing Prisma model ${modelName}`)
  return match[1]
}

describe('product list database schema', () => {
  it('defines the confirmed Product enum, fields and restrictive actor relations', () => {
    const schema = readSchema()
    const product = extractModel(schema, 'Product')
    const user = extractModel(schema, 'User')

    expect(schema).toMatch(
      /enum ProductStatus \{\s+ACTIVE\s+INACTIVE\s+@@map\("product_status"\)\s+\}/u,
    )
    for (const field of [
      'id',
      'name',
      'categoryId',
      'productHeadId',
      'productNo',
      'status',
      'supplierValue',
      'twdSalePriceAmount',
      'twdSalePriceCurrency',
      'myrSalePriceAmount',
      'myrSalePriceCurrency',
      'purchaseCostAmount',
      'purchaseCostCurrency',
      'attributes',
      'createdByUserId',
      'updatedByUserId',
      'version',
      'createdAt',
      'updatedAt',
      'category',
      'productHead',
      'createdBy',
      'updatedBy',
      'media',
    ]) {
      expect(product).toMatch(new RegExp(`\\n\\s*${field}\\s`, 'u'))
    }

    expect(product).toContain('@unique(map: "products_product_no_key")')
    expect(product).toContain('@map("supplier_value") @db.VarChar(64)')
    expect(product).not.toContain('@map("main_image")')
    expect(product).toContain('@map("twd_sale_price_amount") @db.Decimal(30, 4)')
    expect(product).toContain('@map("myr_sale_price_amount") @db.Decimal(30, 4)')
    expect(product).toContain('@map("purchase_cost_amount") @db.Decimal(30, 4)')
    expect(product).toContain('@default("[]") @db.JsonB')
    expect(product).toMatch(
      /createdBy\s+User\?\s+@relation\("ProductCreatedBy", fields: \[createdByUserId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/u,
    )
    expect(product).toMatch(
      /updatedBy\s+User\?\s+@relation\("ProductUpdatedBy", fields: \[updatedByUserId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/u,
    )
    expect(user).toMatch(
      /productsCreated\s+Product\[\]\s+@relation\("ProductCreatedBy"\)/u,
    )
    expect(user).toMatch(
      /productsUpdated\s+Product\[\]\s+@relation\("ProductUpdatedBy"\)/u,
    )
  })

  it('creates every confirmed Product constraint, index and restrictive actor foreign key', () => {
    const migration = readMigration()

    for (const constraintName of [
      'products_pkey',
      'products_name_nonblank_check',
      'products_product_no_nonblank_check',
      'products_supplier_value_nonblank_check',
      'products_active_supplier_required_check',
      'products_twd_currency_check',
      'products_myr_currency_check',
      'products_purchase_currency_format_check',
      'products_twd_sale_price_amount_nonnegative_check',
      'products_myr_sale_price_amount_nonnegative_check',
      'products_purchase_cost_amount_nonnegative_check',
      'products_attributes_array_check',
      'products_version_positive_check',
      'products_created_by_user_id_fkey',
      'products_updated_by_user_id_fkey',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraintName}"`)
    }

    for (const indexName of [
      'products_product_no_key',
      'products_status_updated_at_id_idx',
      'products_supplier_value_updated_at_id_idx',
      'products_updated_at_id_idx',
    ]) {
      expect(migration).toContain(`INDEX "${indexName}"`)
    }

    expect(migration).toContain('"images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]')
    expect(migration).toContain('"videos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]')
    expect(migration).toContain('"attributes" JSONB NOT NULL DEFAULT \'[]\'::jsonb')
    expect(migration).toMatch(
      /CONSTRAINT "products_created_by_user_id_fkey"[\s\S]*?ON DELETE RESTRICT ON UPDATE RESTRICT;/u,
    )
    expect(migration).toMatch(
      /CONSTRAINT "products_updated_by_user_id_fkey"[\s\S]*?ON DELETE RESTRICT ON UPDATE RESTRICT;/u,
    )
  })

  it('protects only Product identity through the confirmed update trigger', () => {
    const migration = readMigration()

    expect(migration).toContain(
      'CREATE FUNCTION "enforce_product_identity_immutability"()',
    )
    for (const column of ['id', 'product_no']) {
      expect(migration).toMatch(
        new RegExp(`NEW\\."${column}" IS DISTINCT FROM OLD\\."${column}"`, 'u'),
      )
    }
    expect(migration).toContain(
      "CONSTRAINT = 'products_identity_immutable_check'",
    )
    expect(migration).toMatch(
      /CREATE TRIGGER "products_identity_immutable_trigger"[\s\S]*?BEFORE UPDATE OF "id", "product_no"[\s\S]*?EXECUTE FUNCTION "enforce_product_identity_immutability"\(\);/u,
    )
    expect(migration).not.toMatch(/FROM "dictionary_(?:types|items)"/u)
  })

  it('keeps Product schema in one append-only transaction without production data seed', () => {
    const migrationDirectories = readdirSync(
      resolve(serverRoot, 'prisma/migrations'),
      { withFileTypes: true },
    )
      .filter(entry => entry.isDirectory() && entry.name.includes('product_list_schema'))
      .map(entry => entry.name)
      .sort()
    const migration = readMigration()

    expect(migrationDirectories).toEqual([
      '20260812090000_product_list_schema',
    ])
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).not.toMatch(/INSERT INTO "products"/u)
    expect(migration).not.toMatch(/UPDATE "numbering_rules"/u)
    expect(migration).not.toMatch(/INSERT INTO "dictionary_(?:types|items)"/u)
    expect(migration).not.toMatch(/\b(?:curl|fetch|https?):/iu)
  })
})
