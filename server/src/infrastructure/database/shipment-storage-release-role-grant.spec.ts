import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20261111180000_shipment_storage_release_role_permissions'
const permissionCode = 'shipment-storage:release'

function readMigration(): string {
  return readFileSync(
    resolve(migrationsRoot, migrationDirectory, 'migration.sql'),
    'utf8',
  )
}

function readSeed(): string {
  return readFileSync(
    resolve(serverRoot, 'src/cli/seed/seed.dataset.ts'),
    'utf8',
  )
}

/** 只截取单个内置角色的权限块，避免其他角色的同名权限造成误判。 */
function seedRoleSection(
  seed: string,
  roleCode: string,
  nextMarker: string,
): string {
  const start = seed.indexOf(`code: '${roleCode}'`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = seed.indexOf(nextMarker, start)
  expect(end).toBeGreaterThan(start)
  return seed.slice(start, end)
}

describe('shipment storage release role grants', () => {
  it('adds exactly one release grant migration', () => {
    const directories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory()
        && entry.name.includes('shipment_storage_release_role_permissions'))
      .map(entry => entry.name)
      .sort()

    expect(directories).toEqual([migrationDirectory])
  })

  it('grants the existing release permission to operations and purchasing roles', () => {
    const migration = readMigration()

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain(`permission."code" = '${permissionCode}'`)
    expect(migration).toMatch(
      /role\."code" IN \('operations_staff', 'purchasing_staff'\)/u,
    )
    expect(migration).toContain('ON CONFLICT DO NOTHING')
    expect(migration).toContain(
      'shipment_storage_release_role_grant_check',
    )
    // 权限本身由寄仓迁移创建，本迁移只授权，不能重复插入或改动 schema。
    expect(migration).not.toContain('INSERT INTO "permissions"')
    expect(migration).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE)\b/iu,
    )
  })

  it('keeps the built-in role seed in sync', () => {
    const seed = readSeed()
    const operations = seedRoleSection(
      seed,
      'operations_staff',
      `code: 'finance_staff'`,
    )
    const finance = seedRoleSection(
      seed,
      'finance_staff',
      `code: 'purchasing_staff'`,
    )
    const purchasing = seedRoleSection(
      seed,
      'purchasing_staff',
      'function datedSequence',
    )

    expect(operations).toContain(`'${permissionCode}'`)
    expect(purchasing).toContain(`'${permissionCode}'`)
    // 财务不参与货件释放，不能顺手扩大授权。
    expect(finance).not.toContain(`'${permissionCode}'`)
  })
})
