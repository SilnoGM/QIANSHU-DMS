import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MANAGEMENT_PERMISSION_CODES,
  WORKBENCH_ACCESS_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20261016140000_workbench_admin_permission'
const permissionId = '00000000-0000-4000-8000-000000000182'

describe('admin workbench permission migration', () => {
  it('adds the admin workbench admission code to the workbench access boundary', () => {
    expect(WORKBENCH_ACCESS_PERMISSION_CODES).toEqual(expect.arrayContaining([
      'workbench:admin',
    ]))
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining(['workbench:admin']),
    )
  })

  it('seeds the delegable permission and grants it to system_admin', () => {
    const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory() && entry.name.includes('workbench_admin_permission'))
      .map(entry => entry.name)
      .sort()
    expect(migrationDirectories).toEqual([migrationDirectory])

    const migration = readFileSync(
      resolve(migrationsRoot, migrationDirectory, 'migration.sql'),
      'utf8',
    )
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)

    // 与另外三条准入码一致：可委派，普通角色可由角色权限管理勾选。
    expect(migration).toMatch(
      new RegExp(
        `'${permissionId}',\\s*'workbench:admin',\\s*'进入管理员工作台'[\\s\\S]*?false`,
        'u',
      ),
    )
    expect(migration).toMatch(
      new RegExp(
        `role\\."id" = '00000000-0000-4000-8000-000000000001'[\\s\\S]*?role\\."code" = 'system_admin'[\\s\\S]*?'${permissionId}'[\\s\\S]*?'workbench:admin'`,
        'u',
      ),
    )
    expect(migration).toContain(
      'admin workbench permission migration invariant mismatch: permission catalog',
    )
    expect(migration).toContain(
      'admin workbench permission migration invariant mismatch: system admin grant',
    )
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE)\b/iu)
  })
})
