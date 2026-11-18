import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MANAGEMENT_PERMISSION_CODES,
  PRODUCT_ALIAS_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations/20261117130000_user_product_aliases/migration.sql',
)

describe('user product alias migration', () => {
  it('keeps the permission catalog boundary aligned', () => {
    expect(PRODUCT_ALIAS_PERMISSION_CODES).toEqual(['product-aliases:manage'])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...PRODUCT_ALIAS_PERMISSION_CODES]),
    )
  })

  it('creates the alias table, checks and permission grants atomically', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain('CREATE TABLE "user_product_aliases"')
    expect(migration).toContain('"user_product_aliases_product_id_user_id_key" UNIQUE ("product_id", "user_id")')
    expect(migration).toContain('"user_product_aliases_alias_shape_check"')
    expect(migration).toContain('"user_product_aliases_product_id_fkey"')
    expect(migration).toContain('"user_product_aliases_user_id_fkey"')
    expect(migration).toContain('"user_product_aliases_user_idx"')

    expect(migration).toContain("'PRODUCT_ALIAS_UPDATED'")
    expect(migration).toContain("'PRODUCT_ALIAS_CLEARED'")
    expect(migration).toContain("'00000000-0000-4000-8000-000000000215'")
    expect(migration).toContain("'product-aliases:manage'")
    expect(migration).toContain("role.\"code\" = 'system_admin'")
    expect(migration).toContain("role.\"code\" = 'operations_staff'")
    expect(migration).toContain("'products:read', 'product-media:read', 'product-aliases:manage'")
    expect(migration).toContain('"sales_orders_customer_name_length_check"')
    expect(migration).toContain('"purchase_order_parts_shipping_mark_text_length_check"')
    expect(migration).toContain('MigrationSelfCheck')
    expect(migration).toContain('DO $$')
  })
})
