import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MANAGEMENT_PERMISSION_CODES,
  PRODUCT_MANAGEMENT_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationPath = resolve(
  serverRoot,
  'prisma/migrations/20260811090000_product_management_permissions/migration.sql',
)

const PRODUCT_PERMISSION_SEEDS = [
  ['00000000-0000-4000-8000-000000000143', 'products:read', '查询产品'],
  ['00000000-0000-4000-8000-000000000144', 'products:create', '新增产品'],
] as const

describe('product management permission migration', () => {
  it('registers the complete product permission contract', () => {
    expect(PRODUCT_MANAGEMENT_PERMISSION_CODES).toEqual([
      'products:read',
      'products:create',
    ])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...PRODUCT_MANAGEMENT_PERMISSION_CODES]),
    )
  })

  it('adds exact permissions and grants all of them to system_admin atomically', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE)\b/iu)

    for (const [id, code, name] of PRODUCT_PERMISSION_SEEDS) {
      expect(migration).toMatch(
        new RegExp(
          `'${id}',\\s*'${code}',\\s*'${name}'[\\s\\S]*?false`,
          'u',
        ),
      )
    }

    expect(migration).toMatch(
      /FROM "roles" AS role[\s\S]*?CROSS JOIN "permissions" AS permission[\s\S]*?role\."id" = '00000000-0000-4000-8000-000000000001'[\s\S]*?role\."code" = 'system_admin'[\s\S]*?'products:read'[\s\S]*?'products:create'/u,
    )
    expect(migration).toContain(
      'product management permission migration invariant mismatch: permission catalog',
    )
    expect(migration).toContain(
      'product management permission migration invariant mismatch: system admin grants',
    )
  })
})
