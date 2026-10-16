import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  INVOICE_REQUEST_PERMISSION_CODES,
  MANAGEMENT_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const migrationsRoot = resolve(serverRoot, 'prisma/migrations')
const migrationDirectory = '20261014092000_invoice_request_permissions'
const permissionIds = [
  '00000000-0000-4000-8000-000000000171',
  '00000000-0000-4000-8000-000000000172',
  '00000000-0000-4000-8000-000000000173',
  '00000000-0000-4000-8000-000000000174',
  '00000000-0000-4000-8000-000000000175',
  '00000000-0000-4000-8000-000000000176',
  '00000000-0000-4000-8000-000000000177',
  '00000000-0000-4000-8000-000000000178',
] as const

describe('invoice request permission migration', () => {
  it('lists every invoice request permission in the complete catalog without duplicates', () => {
    expect(INVOICE_REQUEST_PERMISSION_CODES).toEqual([
      'invoice-requests:cancel',
      'invoice-requests:create',
      'invoice-requests:document',
      'invoice-requests:read',
      'invoice-requests:read-all',
      'invoice-requests:return',
      'invoice-requests:review',
      'invoice-requests:settle',
    ])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...INVOICE_REQUEST_PERMISSION_CODES]),
    )
    expect(new Set(MANAGEMENT_PERMISSION_CODES).size).toBe(
      MANAGEMENT_PERMISSION_CODES.length,
    )
  })

  it('seeds the eight business permissions and grants them only to system_admin', () => {
    const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory() && entry.name.includes('invoice_request_permissions'))
      .map(entry => entry.name)
      .sort()
    expect(migrationDirectories).toEqual([migrationDirectory])

    const migration = readFileSync(
      resolve(migrationsRoot, migrationDirectory, 'migration.sql'),
      'utf8',
    )
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)

    // 每条权限都必须带稳定 ID、可读名称、说明与「可委派」标记。
    const expectedRows = [
      ['cancel', '取消开票申请', false],
      ['create', '提交开票申请', false],
      ['document', '上传发票照片', false],
      ['read', '查看开票申请', false],
      ['read-all', '查看全部开票申请', false],
      ['return', '退回开票申请', false],
      ['review', '审核并通知开票', false],
      ['settle', '结算开票成本', false],
    ] as const
    expectedRows.forEach(([action, name, systemOnly], index) => {
      expect(migration).toContain(`'invoice-requests:${action}'`)
      expect(migration).toContain(`'${name}'`)
      expect(migration).toMatch(
        new RegExp(`'${permissionIds[index]}',\\s*'invoice-requests:${action}',\\s*'${name}'`, 'u'),
      )
      expect(systemOnly).toBe(false)
    })

    // 授权同时用稳定 ID 和 code 约束，角色或权限目录漂移时不会静默授权错误对象。
    for (const permissionId of permissionIds) {
      expect(migration).toContain(`'${permissionId}'`)
    }
    expect(migration).toMatch(
      new RegExp(
        `role\\."id" = '00000000-0000-4000-8000-000000000001'[\\s\\S]*?role\\."code" = 'system_admin'`,
        'u',
      ),
    )
    expect(migration).toContain(
      'invoice request permission migration invariant mismatch: permission catalog',
    )
    expect(migration).toContain(
      'invoice request permission migration invariant mismatch: system admin grants',
    )
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|TYPE)\b/iu)
  })
})
