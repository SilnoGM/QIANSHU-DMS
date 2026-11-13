import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

import type { PrismaService } from '../src/infrastructure/database/prisma.service'
import { NumberingCommandService } from '../src/modules/numbering/numbering-command.service'
import { NumberingQueryService } from '../src/modules/numbering/numbering-query.service'
import { AuditService } from '../src/modules/audit/audit.service'
import type { IsolatedNumberingDatabase } from './numbering-e2e-database'

/** 依赖签收列的迁移必须整体延后；恢复时也只重放这一组，避免重放后续无关迁移。 */
const DEFERRED_SHIPMENT_DELIVERY_MIGRATIONS = [
  '20261021170000_purchase_shipment_delivery',
  '20261022120000_container_loading_delivered_guard',
  '20261027120000_purchase_shipment_container_unload',
  // 误建采购纠正重写了货件不可变触发器并引用 delivered_at，也必须等签收列就位后再应用。
  '20261113120000_purchase_chain_correction',
  '20261113121000_purchase_chain_correction_shipping_identity',
  '20261113130000_purchase_chain_correction_signed',
] as const

/** 永久派发账本不能逐行清理；完整业务回归使用临时 schema，结束时整体释放。 */
export async function createPurchaseShippingMarkDatabase(deferPartsMigration = false, deferReviewMigration = false, deferShipmentNumbers = false, deferWarehouseReceipt = false, deferPayablesMigration = false, deferShipmentDelivery = false): Promise<IsolatedNumberingDatabase & { applyPartsMigration(): Promise<void>, applyReviewMigration(): Promise<void>, applyShipmentNumbers(): Promise<void>, applyWarehouseReceipt(): Promise<void>, applyPayablesMigration(): Promise<void>, applyShipmentDeliveryMigration(): Promise<void> }> {
  const baseDatabaseUrl = process.env.DATABASE_URL
  if (!baseDatabaseUrl) throw new Error('Isolated database is required')
  const url = new URL(baseDatabaseUrl)
  const knownTestDatabase = (url.username === 'qianshu_ci' && url.pathname === '/qianshu_ci')
    || (url.username === 'receipt_test' && url.pathname === '/receipt_test')
  if (!knownTestDatabase || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Database is outside isolated boundary')
  }
  const schemaName = `purchase_mark_e2e_${randomUUID().replaceAll('-', '')}`
  if (!/^purchase_mark_e2e_[a-f0-9]{32}$/u.test(schemaName)) throw new Error('Invalid isolated schema')
  const client = new Client({ connectionString: baseDatabaseUrl })
  await client.connect()
  const quoted = `"${schemaName}"`
  let created = false
  try {
    await client.query(`CREATE SCHEMA ${quoted}`)
    created = true
    await client.query(`SET search_path TO ${quoted}, public`)
    const directory = resolve(__dirname, '../prisma/migrations')
    for (const migration of readdirSync(directory).filter(name => /^\d+_/u.test(name)).sort()) {
      // 签收迁移、装柜签收守卫与撤销装柜迁移都依赖新增的签收列，必须一起延后；
      // 出单人前缀迁移与签收无关，提前应用才能让当前查询代码读取它。
      if (deferShipmentDelivery && DEFERRED_SHIPMENT_DELIVERY_MIGRATIONS.includes(
        migration as (typeof DEFERRED_SHIPMENT_DELIVERY_MIGRATIONS)[number],
      )) continue
      if (deferPayablesMigration && migration >= '20260916160000_purchase_order_payables') continue
      if (deferShipmentNumbers && migration >= '20260914091234_purchase_shipment_number') continue
      if (deferWarehouseReceipt && migration >= '20260915020459_purchase_shipment_warehouse_receipt') continue
      if (deferPartsMigration && migration >= '20260907120000_purchase_order_parts') continue
      if (deferReviewMigration && migration >= '20260908013900_purchase_order_review_shipping_marks') continue
      await client.query(readFileSync(resolve(directory, migration, 'migration.sql'), 'utf8'))
    }
  }
  catch (error) {
    await client.query('ROLLBACK')
    if (created) await client.query(`DROP SCHEMA ${quoted} CASCADE`)
    await client.end()
    throw error
  }
  url.searchParams.set('options', `-c search_path=${schemaName},public`)
  let disposed = false
  return {
    baseDatabaseUrl, databaseUrl: url.toString(), schemaName,
    async applyPartsMigration() {
      const directory = resolve(__dirname, '../prisma/migrations')
      for (const migration of readdirSync(directory).filter(name => /^\d+_/u.test(name) && name >= '20260907120000_purchase_order_parts').sort()) {
        await client.query(readFileSync(resolve(directory, migration, 'migration.sql'), 'utf8'))
      }
    },
    async applyReviewMigration() {
      // 恢复全部延后的迁移，当前服务才能使用生命周期与发货字段。
      const directory = resolve(__dirname, '../prisma/migrations')
      for (const migration of readdirSync(directory).filter(name => /^\d+_/u.test(name) && name >= '20260908013900_purchase_order_review_shipping_marks').sort()) {
        await client.query(readFileSync(resolve(directory, migration, 'migration.sql'), 'utf8'))
      }
    },
    async applyShipmentNumbers() {
      // 编号和后续迁移一起延后、顺序恢复，避免旧函数定义覆盖新入仓保护。
      const directory = resolve(__dirname, '../prisma/migrations')
      for (const migration of readdirSync(directory).filter(name => /^\d+_/u.test(name) && name >= '20260914091234_purchase_shipment_number').sort()) {
        await client.query(readFileSync(resolve(directory, migration, 'migration.sql'), 'utf8'))
      }
    },
    async applyPayablesMigration() {
      const directory = resolve(__dirname, '../prisma/migrations')
      try {
        for (const migration of readdirSync(directory).filter(name => /^\d+_/u.test(name) && name >= '20260916160000_purchase_order_payables').sort()) {
          await client.query(readFileSync(resolve(directory, migration, 'migration.sql'), 'utf8'))
        }
      }
      catch (error) { await client.query('ROLLBACK'); throw error }
    },
    async applyWarehouseReceipt() {
      const directory = resolve(__dirname, '../prisma/migrations')
      try {
        for (const migration of readdirSync(directory).filter(name => /^\d+_/u.test(name) && name >= '20260915020459_purchase_shipment_warehouse_receipt').sort()) {
          await client.query(readFileSync(resolve(directory, migration, 'migration.sql'), 'utf8'))
        }
      }
      catch (error) { await client.query('ROLLBACK'); throw error }
    },
    async applyShipmentDeliveryMigration() {
      const directory = resolve(__dirname, '../prisma/migrations')
      try {
        // 只重放初始阶段确实跳过的三条签收相关迁移；后续迁移（含 2026-10-28
        // 的归属/寄仓迁移）已在初始 schema 应用，按日期范围重放会重复建类型。
        for (const migration of [...DEFERRED_SHIPMENT_DELIVERY_MIGRATIONS].sort()) {
          await client.query(readFileSync(resolve(directory, migration, 'migration.sql'), 'utf8'))
        }
      }
      catch (error) { await client.query('ROLLBACK'); throw error }
    },
    async dispose() {
      if (disposed) return
      disposed = true
      try { await client.query(`DROP SCHEMA ${quoted} CASCADE`) }
      finally { await client.end() }
    },
  }
}

export async function createTestShippingMarkRule(prisma: PrismaService, actorUserId: string, ruleCode: string) {
  const service = new NumberingCommandService(prisma, new AuditService(), new NumberingQueryService(prisma))
  const context = { actorUserId, requestId: `mark-rule-${randomUUID()}` }
  const created = await service.create(context, {
    ruleCode, name: ruleCode, purpose: 'SHIPPING_MARK', resetPolicy: 'NEVER',
    segments: [{ type: 'FIXED', value: 'MARK' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }],
  })
  const published = await service.publish(context, created.id, { expectedVersion: created.version, draftRevision: 1 })
  return service.enable(context, created.id, { expectedVersion: published.version })
}
