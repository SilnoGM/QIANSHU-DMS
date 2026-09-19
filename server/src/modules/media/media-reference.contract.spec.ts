import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { MEDIA_ASSET_REFERENCE_TABLES } from './media-reference.repository'

const serverRoot = resolve(__dirname, '../../..')

function modelBlocks(schema: string): readonly string[] {
  return [...schema.matchAll(/model\s+\w+\s+\{[\s\S]*?\n\}/gu)]
    .map(match => match[0])
}

describe('media reference extension contract', () => {
  it('keeps every implemented active-reference model explicit in repository and Trigger', () => {
    const schema = readFileSync(resolve(serverRoot, 'prisma/schema.prisma'), 'utf8')
    const productMediaMigration = readFileSync(resolve(
      serverRoot,
      'prisma/migrations/20260813120000_media_asset_product_media_schema/migration.sql',
    ), 'utf8')
    const salesOrderMigration = readFileSync(resolve(
      serverRoot,
      'prisma/migrations/20260820120000_sales_order_domain/migration.sql',
    ), 'utf8')
    const purchaseOrderMigration = readFileSync(resolve(
      serverRoot,
      'prisma/migrations/20260827120000_purchase_order_domain/migration.sql',
    ), 'utf8')
    const purchaseOrderMediaReferenceMigration = readFileSync(resolve(
      serverRoot,
      'prisma/migrations/20260827130000_purchase_order_media_reference_extension/migration.sql',
    ), 'utf8')
    const migration = [
      readFileSync(resolve(serverRoot, 'prisma/migrations/20260919091000_ocean_freight_access_media/migration.sql'), 'utf8'),
      readFileSync(resolve(serverRoot, 'prisma/migrations/20260917040739_supplier_payment_profiles/migration.sql'), 'utf8'),
      readFileSync(resolve(serverRoot, 'prisma/migrations/20260916030539_packaging_cost_requests/migration.sql'), 'utf8'),
      readFileSync(resolve(serverRoot, 'prisma/migrations/20260915040452_purchase_order_image_draft/migration.sql'), 'utf8'),
      readFileSync(resolve(serverRoot, 'prisma/migrations/20260908120100_sales_receipt_review_posting/migration.sql'), 'utf8'),
      productMediaMigration,
      salesOrderMigration,
      purchaseOrderMigration,
      purchaseOrderMediaReferenceMigration,
    ].join('\n')
    const referenceTables = modelBlocks(schema)
      .filter(block => (/\bmediaAssetId\b/u.test(block) && (/\bdetachedAt\b/u.test(block) || /\binvalidatedAt\b/u.test(block))) || /\bvoucherMediaAssetId\b/u.test(block) || /\bpackagingImageMediaAssetId\b/u.test(block) || /\bqrMediaAssetId\b/u.test(block) || /\brecipientQrMediaAssetId\b/u.test(block) || /\bsourceFileId\b/u.test(block))
      .map((block) => block.match(/@@map\("([^"]+)"\)/u)?.[1])
      .filter((value): value is string => value !== undefined)
      .sort()

    expect(referenceTables).toEqual([...MEDIA_ASSET_REFERENCE_TABLES].sort())
    for (const table of MEDIA_ASSET_REFERENCE_TABLES) {
      if (table === 'container_batches' || table === 'ocean_freight_bills') {
        expect(migration).toContain(`FROM ${table} reference WHERE reference.source_file_id = reference_asset_id`)
        continue
      }
      if (table === 'payment_recipient_accounts') {
        expect(migration).toContain('FROM payment_recipient_accounts reference WHERE reference.qr_media_asset_id = reference_asset_id')
        continue
      }
      if (table === 'purchase_order_payments') {
        expect(migration).toContain('FROM purchase_order_payments reference WHERE reference.recipient_qr_media_asset_id = reference_asset_id')
        continue
      }
      if (table === 'packaging_cost_requests') {
        expect(migration).toContain('reference.packaging_image_media_asset_id = reference_asset_id OR reference.quotation_image_media_asset_id = reference_asset_id')
        continue
      }
      if (table === 'purchase_order_image_drafts') {
        expect(migration).toContain('reference.invalidated_at IS NULL AND reference.archived_at IS NULL')
        continue
      }
      expect(migration).toContain(`FROM "${table}" AS reference`)
      if (table === 'sales_receipt_requests') continue
      expect(migration).toMatch(
        new RegExp(`FROM "${table}" AS reference[\\s\\S]*?reference\\."detached_at" IS NULL`, 'u'),
      )
    }
  })
})
