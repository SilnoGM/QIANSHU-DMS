import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schema = readFileSync(resolve(serverRoot, 'prisma/schema.prisma'), 'utf8')
const migration = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261126130000_purchase_auto_review/migration.sql'),
  'utf8',
)

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, 'u'))
  if (match === null) throw new Error(`model ${name} missing`)
  return match[0]
}

describe('采购审核自动托管数据结构', () => {
  it('keeps the settings singleton and the per-order job markers in sync with the schema', () => {
    const settings = modelBlock('PurchaseAutoReviewSettings')
    expect(settings).toContain('@map("purchase_auto_review_settings")')
    expect(settings).toContain('lastScanAt')
    expect(settings).toContain('updatedByUserId')

    const job = modelBlock('PurchaseOrderAutoReviewJob')
    expect(job).toContain('@map("purchase_order_auto_review_jobs")')
    expect(job).toContain('purchaseOrderId')
    expect(job).toContain('state            PurchaseAutoReviewJobState')
    expect(job).toContain('leaseExpiresAt')
    expect(job).toContain('nextAttemptAt')
    expect(job).toContain('purchase_order_auto_review_jobs_state_next_idx')
    expect(job).toContain('purchase_order_auto_review_jobs_purchase_order_key')

    expect(schema).toContain('enum PurchaseAutoReviewJobState')
    expect(schema).toContain('PURCHASE_AUTO_REVIEW_SETTING_UPDATED')
    expect(schema).toContain('PURCHASE_ORDER_AUTO_REVIEW_FAILED')
  })

  it('creates the tables, enum, permission, automation actor and self-check in the migration', () => {
    expect(migration).toContain('CREATE TYPE "purchase_auto_review_job_state" AS ENUM')
    expect(migration).toContain('CREATE TABLE "purchase_auto_review_settings"')
    expect(migration).toContain('CREATE TABLE "purchase_order_auto_review_jobs"')
    expect(migration).toContain('"purchase_order_auto_review_jobs_purchase_order_key" UNIQUE')
    expect(migration).toContain('"purchase_order_auto_review_jobs_state_next_idx"')
    expect(migration).toContain('ON DELETE RESTRICT ON UPDATE RESTRICT')
    expect(migration).toContain("VALUES ('default', false)")

    expect(migration).toContain(
      "'00000000-0000-4000-8000-000000002448',\n  'purchase-orders:auto-review'",
    )
    expect(migration).toContain('AND permission."code" = \'purchase-orders:auto-review\'')
    expect(migration).toContain("'00000000-0000-4000-8000-000000002449'")
    expect(migration).toContain("'purchase-review-automation'")
    expect(migration).toContain("'采购审核托管'")
    // 系统账号保持无角色：数据范围按既有「无 data-scope 权限即全量」契约解析。
    expect(migration).toContain('FROM "user_roles"\n  WHERE "user_id" = \'00000000-0000-4000-8000-000000002449\'')
    expect(migration).not.toContain('purchase_review_automation')
    expect(migration).toContain('MigrationSelfCheck')
  })

  it('registers the new permission in the management catalog', () => {
    const constants = readFileSync(
      resolve(serverRoot, 'src/modules/access-control/permission.constants.ts'),
      'utf8',
    )
    expect(constants).toContain("'purchase-orders:auto-review'")
  })
})
