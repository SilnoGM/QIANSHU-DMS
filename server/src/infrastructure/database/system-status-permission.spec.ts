import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MANAGEMENT_PERMISSION_CODES,
  SYSTEM_STATUS_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20261111170500_system_status_permission'
const permissionId = '00000000-0000-4000-8000-000000002432'

describe('system status permission migration', () => {
  it('registers the permission in the code catalog', () => {
    expect(SYSTEM_STATUS_PERMISSION_CODES).toEqual(['system-status:read'])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining(['system-status:read']),
    )
  })

  it('seeds a system-only permission and grants it to system_admin', () => {
    const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory() && entry.name.includes('system_status_permission'))
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
        `'${permissionId}',\\s*'system-status:read',\\s*'查看系统状态'[\\s\\S]*?true`,
        'u',
      ),
    )
    expect(migration).toMatch(
      new RegExp(
        `role\\."id" = '00000000-0000-4000-8000-000000000001'[\\s\\S]*?role\\."code" = 'system_admin'[\\s\\S]*?'${permissionId}'[\\s\\S]*?'system-status:read'`,
        'u',
      ),
    )
    expect(migration).toContain(
      'system status permission migration invariant mismatch: permission catalog',
    )
    expect(migration).toContain(
      'system status permission migration invariant mismatch: system admin grant',
    )
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE)\b/iu)
  })
})
