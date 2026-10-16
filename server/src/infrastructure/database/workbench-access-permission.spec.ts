import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MANAGEMENT_PERMISSION_CODES,
  WORKBENCH_ACCESS_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20261001180000_workbench_access_permissions'

const expectedPermissions = [
  {
    id: '00000000-0000-4000-8000-000000000168',
    code: 'workbench:operations',
    name: '进入运营工作台',
    description: '顶级导航准入：可见并进入千树运营工作台',
  },
  {
    id: '00000000-0000-4000-8000-000000000169',
    code: 'workbench:finance',
    name: '进入财务工作台',
    description: '顶级导航准入：可见并进入千树财务工作台',
  },
  {
    id: '00000000-0000-4000-8000-000000000170',
    code: 'workbench:purchase-transport',
    name: '进入采运工作台',
    description: '顶级导航准入：可见并进入千树采运工作台',
  },
] as const

describe('workbench access permission migration', () => {
  it('lists every workbench access permission in the complete catalog without duplicates', () => {
    // 管理员工作台准入码由 20261016140000_workbench_admin_permission 建入，
    // 其自身契约见 workbench-admin-permission.spec.ts；常量按 code 排序。
    expect([...WORKBENCH_ACCESS_PERMISSION_CODES]).toEqual([
      'workbench:admin',
      'workbench:finance',
      'workbench:operations',
      'workbench:purchase-transport',
    ])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...WORKBENCH_ACCESS_PERMISSION_CODES]),
    )
    expect(new Set(MANAGEMENT_PERMISSION_CODES).size).toBe(
      MANAGEMENT_PERMISSION_CODES.length,
    )
  })

  it('seeds the three delegable permissions and grants them only to system_admin', () => {
    const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory() && entry.name.includes('workbench_access_permissions'))
      .map(entry => entry.name)
      .sort()
    expect(migrationDirectories).toEqual([migrationDirectory])

    const migration = readFileSync(
      resolve(migrationsRoot, migrationDirectory, 'migration.sql'),
      'utf8',
    )
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    for (const permission of expectedPermissions) {
      expect(migration).toMatch(
        new RegExp(
          `'${permission.id}',\\s*'${permission.code}',\\s*'${permission.name}',\\s*'${permission.description}',\\s*false`,
          'u',
        ),
      )
    }
    // 授权同时用稳定 ID 和 code 约束，角色或权限目录漂移时不会静默授权错误对象。
    expect(migration).toMatch(
      new RegExp(
        `role\\."id" = '00000000-0000-4000-8000-000000000001'[\\s\\S]*?role\\."code" = 'system_admin'[\\s\\S]*?'00000000-0000-4000-8000-000000000168'[\\s\\S]*?'00000000-0000-4000-8000-000000000170'[\\s\\S]*?'workbench:operations'[\\s\\S]*?'workbench:purchase-transport'`,
        'u',
      ),
    )
    expect(migration).toContain(
      'workbench access permission migration invariant mismatch: permission catalog',
    )
    expect(migration).toContain(
      'workbench access permission migration invariant mismatch: system admin grants',
    )
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE)\b/iu)
  })
})
