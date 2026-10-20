import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DATA_SCOPE_PERMISSION_CODES,
  MANAGEMENT_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20261020120000_data_scope_permissions'

describe('data scope permission migration', () => {
  it('keeps both data scope codes in the complete permission catalog', () => {
    expect(DATA_SCOPE_PERMISSION_CODES).toEqual([
      'data-scope:self',
      'data-scope:all',
    ])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...DATA_SCOPE_PERMISSION_CODES]),
    )
    expect(new Set(MANAGEMENT_PERMISSION_CODES).size).toBe(
      MANAGEMENT_PERMISSION_CODES.length,
    )
  })

  it('seeds delegable permissions and grants the built-in roles', () => {
    const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory() && entry.name.includes('data_scope_permissions'))
      .map(entry => entry.name)
      .sort()
    expect(migrationDirectories).toEqual([migrationDirectory])

    const migration = readFileSync(
      resolve(migrationsRoot, migrationDirectory, 'migration.sql'),
      'utf8',
    )
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)

    expect(migration).toContain("'data-scope:self'")
    expect(migration).toContain("'数据范围：本人'")
    expect(migration).toContain("'data-scope:all'")
    expect(migration).toContain("'数据范围：全部'")
    expect(migration).toMatch(
      /'00000000-0000-4000-8000-000000002104'::uuid,\s*'data-scope:self'[\s\S]*?false/u,
    )
    expect(migration).toMatch(
      /'00000000-0000-4000-8000-000000002105'::uuid,\s*'data-scope:all'[\s\S]*?false/u,
    )
    expect(migration).toMatch(/role\."code" = 'operations_staff'[\s\S]*?'data-scope:self'/u)
    expect(migration).toMatch(/role\."code" IN \('finance_staff', 'purchasing_staff'\)[\s\S]*?'data-scope:all'/u)
    expect(migration).toContain('data scope permission migration invariant mismatch')
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE)\b/iu)
  })
})
