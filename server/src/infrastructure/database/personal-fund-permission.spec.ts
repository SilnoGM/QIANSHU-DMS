import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MANAGEMENT_PERMISSION_CODES,
  PERSONAL_FUND_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20261016120000_personal_fund_permissions'
const permissionRows = [
  [
    '00000000-0000-4000-8000-000000000179',
    'fund-accounts:read-self',
    '查看本人资金账户',
  ],
  [
    '00000000-0000-4000-8000-000000000180',
    'fund-withdrawals:create',
    '提交提款申请',
  ],
  [
    '00000000-0000-4000-8000-000000000181',
    'fund-withdrawals:review',
    '审批账户提款',
  ],
] as const

describe('personal fund permission migration', () => {
  it('lists every personal fund permission in the complete catalog without duplicates', () => {
    expect(PERSONAL_FUND_PERMISSION_CODES).toEqual([
      'fund-accounts:read-self',
      'fund-withdrawals:create',
      'fund-withdrawals:review',
    ])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...PERSONAL_FUND_PERMISSION_CODES]),
    )
    expect(new Set(MANAGEMENT_PERMISSION_CODES).size).toBe(
      MANAGEMENT_PERMISSION_CODES.length,
    )
  })

  it('seeds the three delegable permissions and grants them to system_admin', () => {
    const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory() && entry.name.includes('personal_fund_permissions'))
      .map(entry => entry.name)
      .sort()
    expect(migrationDirectories).toEqual([migrationDirectory])

    const migration = readFileSync(
      resolve(migrationsRoot, migrationDirectory, 'migration.sql'),
      'utf8',
    )
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)

    // 三条权限全部可委派：运营与财务内建角色都要能持有，不存在系统专用码。
    for (const [permissionId, code, name] of permissionRows) {
      expect(migration).toMatch(
        new RegExp(`'${permissionId}',\\s*'${code}',\\s*'${name}'[\\s\\S]*?false`, 'u'),
      )
    }

    expect(migration).toMatch(
      new RegExp(
        `role\\."id" = '00000000-0000-4000-8000-000000000001'[\\s\\S]*?role\\."code" = 'system_admin'`,
        'u',
      ),
    )
    // 业务角色授权按角色码与权限码双重约束，并用 NOT EXISTS 保证幂等重放。
    expect(migration).toMatch(
      /role\."code" = 'operations_staff'\s+AND permission\."code" IN \(\s*'fund-accounts:read-self',\s*'fund-withdrawals:create'\s*\)/u,
    )
    expect(migration).toMatch(
      /role\."code" = 'finance_staff'\s+AND permission\."code" = 'fund-withdrawals:review'/u,
    )
    expect(migration).toContain('NOT EXISTS')
    expect(migration).toContain(
      'personal fund permission migration invariant mismatch: permission catalog',
    )
    expect(migration).toContain(
      'personal fund permission migration invariant mismatch: system admin grants',
    )
    expect(migration).toContain(
      'personal fund permission migration invariant mismatch: role grants',
    )
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE)\b/iu)
  })
})
