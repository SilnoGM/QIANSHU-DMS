import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  FUND_ACCOUNT_PERMISSION_CODES,
  MANAGEMENT_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20260817090000_fund_account_read_permission'
const permissionId = '00000000-0000-4000-8000-000000000147'

describe('fund account read permission migration', () => {
  it('registers one exact permission in the management catalog', () => {
    expect(FUND_ACCOUNT_PERMISSION_CODES).toEqual(['fund-accounts:read'])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...FUND_ACCOUNT_PERMISSION_CODES]),
    )
    expect(new Set(MANAGEMENT_PERMISSION_CODES).size).toBe(
      MANAGEMENT_PERMISSION_CODES.length,
    )
  })

  it('creates a system-only permission and grants it exclusively to system_admin', () => {
    const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory() && entry.name.includes('fund_account_read_permission'))
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
        `'${permissionId}',\\s*'fund-accounts:read',\\s*'查询资金账户'[\\s\\S]*?true`,
        'u',
      ),
    )
    expect(migration).toMatch(
      new RegExp(
        `role\\."id" = '00000000-0000-4000-8000-000000000001'[\\s\\S]*?role\\."code" = 'system_admin'[\\s\\S]*?permission\\."id" = '${permissionId}'[\\s\\S]*?permission\\."code" = 'fund-accounts:read'`,
        'u',
      ),
    )
    expect(migration).toContain(
      'fund account permission migration invariant mismatch: permission catalog',
    )
    expect(migration).toContain(
      'fund account permission migration invariant mismatch: system admin grant',
    )
    expect(migration).toContain(
      'fund account permission migration invariant mismatch: exclusive grant',
    )
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE)\b/iu)
  })
})
