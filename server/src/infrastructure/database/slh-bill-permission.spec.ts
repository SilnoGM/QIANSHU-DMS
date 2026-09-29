import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MANAGEMENT_PERMISSION_CODES,
  SLH_BILL_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20260926102932_slh_bill_permissions'
const readPermissionId = '00000000-0000-4000-8000-000000000166'
const reconcilePermissionId = '00000000-0000-4000-8000-000000000167'

describe('slh bill permission migration', () => {
  it('lists every slh bill permission in the complete catalog without duplicates', () => {
    // read 与 reconcile 由本迁移种下，create 由账单管理迁移补上；顺序按 code 排序。
    expect(SLH_BILL_PERMISSION_CODES).toEqual(['slh-bills:create', 'slh-bills:read', 'slh-bills:reconcile'])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...SLH_BILL_PERMISSION_CODES]),
    )
    expect(new Set(MANAGEMENT_PERMISSION_CODES).size).toBe(
      MANAGEMENT_PERMISSION_CODES.length,
    )
  })

  it('seeds the two business permissions and grants them only to system_admin', () => {
    const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory() && entry.name.includes('slh_bill_permissions'))
      .map(entry => entry.name)
      .sort()
    expect(migrationDirectories).toEqual([migrationDirectory])

    const migration = readFileSync(
      resolve(migrationsRoot, migrationDirectory, 'migration.sql'),
      'utf8',
    )
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toMatch(
      new RegExp(
        `'${readPermissionId}',\\s*'slh-bills:read',\\s*'查看顺联航账单',\\s*'访问顺联航账单管理页面',\\s*false`,
        'u',
      ),
    )
    expect(migration).toMatch(
      new RegExp(
        `'${reconcilePermissionId}',\\s*'slh-bills:reconcile',\\s*'核对顺联航账单',\\s*'访问顺联航账单对账页面',\\s*false`,
        'u',
      ),
    )
    // 授权同时用稳定 ID 和 code 约束，角色或权限目录漂移时不会静默授权错误对象。
    expect(migration).toMatch(
      new RegExp(
        `role\\."id" = '00000000-0000-4000-8000-000000000001'[\\s\\S]*?role\\."code" = 'system_admin'[\\s\\S]*?'${readPermissionId}'[\\s\\S]*?'${reconcilePermissionId}'[\\s\\S]*?'slh-bills:read'[\\s\\S]*?'slh-bills:reconcile'`,
        'u',
      ),
    )
    expect(migration).toContain(
      'slh bill permission migration invariant mismatch: permission catalog',
    )
    expect(migration).toContain(
      'slh bill permission migration invariant mismatch: system admin grants',
    )
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE)\b/iu)
  })
})
