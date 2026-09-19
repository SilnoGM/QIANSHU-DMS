import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CONTAINER_BATCH_PERMISSION_CODES, MANAGEMENT_PERMISSION_CODES, OCEAN_FREIGHT_BILL_PERMISSION_CODES } from './permission.constants'

describe('ocean freight permission contract', () => {
  it('seeds every domain permission only to the built-in system administrator', () => {
    const sql = readFileSync(resolve(__dirname, '../../../prisma/migrations/20260919091000_ocean_freight_access_media/migration.sql'), 'utf8')
    const codes = [...CONTAINER_BATCH_PERMISSION_CODES, ...OCEAN_FREIGHT_BILL_PERMISSION_CODES]
    expect(codes).toEqual([
      'container-batches:read', 'container-batches:create', 'container-batches:update',
      'ocean-freight-bills:read', 'ocean-freight-bills:create', 'ocean-freight-bills:update', 'ocean-freight-bills:reconcile',
    ])
    for (const code of codes) {
      expect(MANAGEMENT_PERMISSION_CODES).toContain(code)
      expect(sql).toContain(`gen_random_uuid(),'${code}'`)
    }
    expect(sql).toContain("WHERE role.code = 'system_admin' AND permission.code IN")
    expect(sql).not.toMatch(/INSERT INTO (fund_|sales_order_payments)/u)
  })
})
