import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MANAGEMENT_PERMISSION_CODES,
  PURCHASE_ORDER_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20261113120000_purchase_chain_correction'
const permissionId = '00000000-0000-4000-8000-000000002433'

describe('purchase chain correction permission migration', () => {
  it('registers the permission in the code catalog', () => {
    expect(PURCHASE_ORDER_PERMISSION_CODES).toEqual(
      expect.arrayContaining(['purchase-orders:correction']),
    )
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining(['purchase-orders:correction']),
    )
  })

  it('seeds a system-only permission and grants it to system_admin', () => {
    const migration = readFileSync(
      resolve(migrationsRoot, migrationDirectory, 'migration.sql'),
      'utf8',
    )
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)

    expect(migration).toMatch(
      new RegExp(
        `'${permissionId}',\\s*'purchase-orders:correction',\\s*'纠正误建采购链'[\\s\\S]*?true`,
        'u',
      ),
    )
    expect(migration).toMatch(
      new RegExp(
        `role\\."id" = '00000000-0000-4000-8000-000000000001'[\\s\\S]*?role\\."code" = 'system_admin'[\\s\\S]*?'${permissionId}'[\\s\\S]*?'purchase-orders:correction'`,
        'u',
      ),
    )
    expect(migration).toContain('purchase chain correction permission catalog mismatch')
    expect(migration).toContain('purchase chain correction system admin grant mismatch')
  })

  it('keeps both correction migrations in the documented baseline', () => {
    const documented = readFileSync(
      resolve(serverRoot, '../docs/后端文档/数据库迁移规范.md'),
      'utf8',
    )
    const directories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.includes('purchase_chain_correction'))
      .map(entry => entry.name)
      .sort()
    expect(directories).toEqual([
      '20261113120000_purchase_chain_correction',
      '20261113121000_purchase_chain_correction_shipping_identity',
      '20261113130000_purchase_chain_correction_signed',
    ])
    for (const directory of directories) {
      expect(documented).toContain(`\`${directory}\``)
    }
  })
})
