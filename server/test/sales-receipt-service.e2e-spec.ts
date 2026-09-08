import { Prisma } from '../src/generated/prisma/client'
import { SalesOrderProductEditService } from '../src/modules/sales-orders/sales-order-product-edit.service'
import { ConfigService } from '@nestjs/config'
import { createReceiptTestDatabase } from './fixtures/receipt-test-database'
import { FundPostingApplicationService } from '../src/modules/fund-accounts/application/fund-posting.service'
import { MediaContentDeliveryService } from '../src/modules/media/media-content-delivery.service'
import { chmod, mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { SalesReceiptService } from '../src/modules/sales-orders/receipts/sales-receipt.service'
import { SalesReceiptQueryService } from '../src/modules/sales-orders/receipts/sales-receipt-query.service'
import { SalesOrderMutationService } from '../src/modules/sales-orders/sales-order-mutation.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { insertFixture } from './fixtures/sales-receipt-schema.fixture'
import { SalesReceiptStatusDto, type SalesReceiptRequestCreateDto } from '../src/modules/sales-orders/dto/sales-receipt.dto'

describe('sales receipt atomic posting in isolated PostgreSQL', () => {
  jest.setTimeout(90000)
  let app: INestApplication
  let prisma: PrismaService
  let service: SalesReceiptService
  let query: SalesReceiptQueryService
  let client: Client
  let database: Awaited<ReturnType<typeof createReceiptTestDatabase>>
  beforeAll(async () => {
    database = await createReceiptTestDatabase()
    const isolated = new PrismaService(new ConfigService({ DATABASE_URL: database.databaseUrl }))
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(isolated).compile()
    app = module.createNestApplication()
    configureApplication(app, { nodeEnvironment: 'test' })
    await app.init()
    prisma = app.get(PrismaService)
    service = app.get(SalesReceiptService)
    query = app.get(SalesReceiptQueryService)
    client = new Client({ connectionString: database.databaseUrl })
    await client.connect()
    const currency = await prisma.currency.findUniqueOrThrow({ where: { code: 'TWD' } })
    await prisma.exchangeRate.upsert({ where: { currencyId: currency.id }, create: { currencyId: currency.id, foreignUnitsPerCny: '4.8' }, update: { foreignUnitsPerCny: '4.8', version: { increment: 1 } } })
    await prisma.currency.update({ where: { code: 'TWD' }, data: { enabled: true } })
    await prisma.$transaction(async tx => {
    const dictionary = await tx.dictionaryType.upsert({ where: { code: 'payment.method' }, create: { code: 'payment.method', name: '收款方式', enabled: false }, update: {} })
    if (!await tx.dictionaryItem.findFirst({ where: { dictionaryTypeId: dictionary.id, value: 'RECEIPT_TEST_TRANSFER' } })) await tx.dictionaryItem.create({ data: { dictionaryTypeId: dictionary.id, value: 'RECEIPT_TEST_TRANSFER', label: '测试转账', enabled: true } })
      await tx.dictionaryType.update({ where: { id: dictionary.id }, data: { enabled: true } })
    })
  })
  afterAll(async () => { await client?.end(); await app?.close(); await database?.close() })
  function context(userId: string) { return { actorUserId: userId, requestId: randomUUID() } }
  async function fixture(share = '30') {
    await client.query('BEGIN')
    let fixture: Awaited<ReturnType<typeof insertFixture>>
    try {
      fixture = await insertFixture(client)
      await client.query(`INSERT INTO sales_order_documents (sales_order_id,media_asset_id,document_type,title,created_by_user_id) VALUES ($1,$2,'ORDER_ISSUANCE_VOUCHER','测试开单凭证',$3)`, [fixture.salesOrderId, fixture.assetId, fixture.userId])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'system_admin' } })
    await prisma.userRole.create({ data: { userId: fixture.userId, roleId: role.id } })
    const account = await app.get(FundAccountCommandService).createUserAccount(context(fixture.userId), { userId: fixture.userId, userShareRate: share })
    const media = await prisma.mediaAsset.create({ data: { createdByUserId: fixture.userId, mediaType: 'DOCUMENT', status: 'UPLOADING', originalFilename: 'receipt.pdf', objectKey: `assets/${randomUUID()}.pdf`, mimeType: 'application/pdf', sizeBytes: 128n, checksumSha256: 'b'.repeat(64), uploadExpiresAt: new Date(Date.now() + 3600000) } })
    const root = process.env.MEDIA_STORAGE_ROOT!
    await mkdir(join(root, 'assets'), { recursive: true, mode: 0o700 })
    await chmod(root, 0o700)
    await chmod(join(root, 'assets'), 0o700)
    await writeFile(join(root, media.objectKey!), Buffer.alloc(128), { mode: 0o600 })
    await app.get(MediaContentDeliveryService).stat(media.objectKey!)
    const method = await prisma.dictionaryItem.findFirstOrThrow({ where: { dictionaryType: { code: 'payment.method' }, enabled: true } })
    const input: SalesReceiptRequestCreateDto = { paymentType: 'DEPOSIT', amount: '1000', receivedAt: new Date(Date.now() - 1000).toISOString(), paymentMethod: method.value, remark: null, voucher: { mediaAssetId: media.id } }
    return { ...fixture, account, input }
  }
  it('submits without posting, replays once, approves once, and reverses original split after ratio/rate change', async () => {
    const f = await fixture()
    const reviewer = (await fixture()).userId
    const key = randomUUID()
    const submitted = await service.submit(context(f.userId), f.salesOrderId, f.input, key)
    expect(submitted.status).toBe('PENDING_REVIEW')
    expect(submitted.accountOwner.id).toBe(f.userId)
    expect(submitted.accountOwner.id).not.toBe(reviewer)
    expect(await prisma.salesOrderPayment.count({ where: { salesOrderId: f.salesOrderId } })).toBe(0)
    expect((await prisma.fundAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2)).toBe('0.00')
    expect((await service.submit(context(f.userId), f.salesOrderId, f.input, key)).id).toBe(submitted.id)
    await expect(service.submit(context(f.userId), f.salesOrderId, { ...f.input, amount: '999' }, key)).rejects.toMatchObject({ code: 'SALES_RECEIPT_IDEMPOTENCY_CONFLICT' })
    const preview = await service.approvalContext(context(reviewer), submitted.id)
    expect(preview.businessAmount).toBe('208.33')
    const approved = await Promise.all([1, 2].map(() => service.approve(context(reviewer), submitted.id, { expectedVersion: 1, expectedContext: preview.expectedContext })))
    expect(approved[0]?.approvedPayment?.id).toBe(approved[1]?.approvedPayment?.id)
    const payment = approved[0].approvedPayment!
    expect(payment.posting?.entries.map(entry => entry.amount)).toEqual(['62.50', '145.83'])
    await prisma.fundAccount.update({ where: { id: f.account.id }, data: { userShareRate: '90', version: { increment: 1 } } })
    await app.get(FundPostingApplicationService).postManualAdjustment(context(f.userId), { userAccountId: f.account.id, amount: '-62.50', adjustmentMode: 'USER_ONLY', reason: '模拟余额已使用', idempotencyKey: randomUUID() })
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: f.salesOrderId } })
    const voidInput = { reason: '重复确认收款', expectedOrderVersion: order.version }
    await service.voidPayment(context(reviewer), f.salesOrderId, payment.id, voidInput)
    await service.voidPayment(context(reviewer), f.salesOrderId, payment.id, voidInput)
    const result = await query.getById(submitted.id)
    expect(result.status).toBe('APPROVED')
    expect(result.approvedPayment?.fundReversalBatchId).toBeTruthy()
    expect(result.approvedPayment?.reversal?.entries.map(entry => entry.amount)).toEqual(['62.50', '145.83'])
    expect((await prisma.fundAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2)).toBe('-62.50')
    expect(await prisma.fundPostingBatch.count({ where: { businessId: submitted.id, kind: 'BUSINESS' } })).toBe(1)
  })
  it('reserves pending, rejects with evidence, and resubmits the same voucher as a new request', async () => {
    const f = await fixture()
    const request = await service.submit(context(f.userId), f.salesOrderId, f.input, randomUUID())
    await expect(service.submit(context(f.userId), f.salesOrderId, { ...f.input, amount: '1' }, randomUUID())).rejects.toMatchObject({ code: 'SALES_RECEIPT_AMOUNT_EXCEEDS_AVAILABLE' })
    expect((await query.list({}, f.salesOrderId)).pendingAmount).toBe('1000.0000')
    await service.reject(context(f.userId), request.id, { expectedVersion: 1, reason: '请重新核对金额' })
    expect((await query.list({}, f.salesOrderId)).pendingAmount).toBe('0.0000')
    const resubmitted = await service.submit(context(f.userId), f.salesOrderId, { ...f.input, resubmittedFromId: request.id, amount: '800' }, randomUUID())
    expect(resubmitted.id).not.toBe(request.id)
    expect(resubmitted.voucher.mediaAssetId).toBe(request.voucher.mediaAssetId)
  })
  it('rolls back payment, balance and review when final audit fails', async () => {
    const f = await fixture()
    const request = await service.submit(context(f.userId), f.salesOrderId, f.input, randomUUID())
    const preview = await service.approvalContext(context(f.userId), request.id)
    const audit = app.get(AuditService)
    const real = audit.record.bind(audit)
    const failure = jest.spyOn(audit, 'record').mockImplementation((tx, input) => {
      if (input.eventType === 'SALES_RECEIPT_APPROVED') return Promise.reject(new Error('injected receipt audit failure'))
      return real(tx, input)
    })
    try { await expect(service.approve(context(f.userId), request.id, { expectedVersion: 1, expectedContext: preview.expectedContext })).rejects.toThrow('injected receipt audit failure') }
    finally { failure.mockRestore() }
    expect((await query.getById(request.id)).status).toBe('PENDING_REVIEW')
    expect(await prisma.salesOrderPayment.count({ where: { salesOrderId: f.salesOrderId } })).toBe(0)
    expect((await prisma.fundAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2)).toBe('0.00')
    expect(await prisma.fundPostingBatch.count({ where: { businessId: request.id } })).toBe(0)
  })
  it('rejects stale rate preview and legacy direct endpoint service', async () => {
    const f = await fixture()
    const request = await service.submit(context(f.userId), f.salesOrderId, f.input, randomUUID())
    const preview = await service.approvalContext(context(f.userId), request.id)
    await prisma.exchangeRate.update({ where: { id: preview.expectedContext.exchangeRateId }, data: { version: { increment: 1 } } })
    await expect(service.approve(context(f.userId), request.id, { expectedVersion: 1, expectedContext: preview.expectedContext })).rejects.toMatchObject({ code: 'SALES_RECEIPT_CONTEXT_CHANGED' })
    await expect(app.get(SalesOrderMutationService).recordPayment(context(f.userId), f.salesOrderId, f.input)).rejects.toMatchObject({ code: 'SALES_ORDER_RECEIPT_REVIEW_REQUIRED' })
  })
  it('serializes competing submissions and approve versus reject without duplicate postings', async () => {
    const f = await fixture()
    const secondVoucher = await prisma.mediaAsset.create({ data: { createdByUserId: f.userId, mediaType: 'DOCUMENT', status: 'UPLOADING', originalFilename: 'second.pdf', objectKey: `assets/${randomUUID()}.pdf`, mimeType: 'application/pdf', sizeBytes: 128n, checksumSha256: 'c'.repeat(64), uploadExpiresAt: new Date(Date.now() + 3600000) } })
    await writeFile(join(process.env.MEDIA_STORAGE_ROOT!, secondVoucher.objectKey!), Buffer.alloc(128), { mode: 0o600 })
    const inputs = [{ ...f.input, amount: '600' }, { ...f.input, amount: '600', voucher: { mediaAssetId: secondVoucher.id } }]
    const outcomes = await Promise.allSettled(inputs.map(input => service.submit(context(f.userId), f.salesOrderId, input, randomUUID())))
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    const request = (await query.list({}, f.salesOrderId)).items[0]
    const preview = await service.approvalContext(context(f.userId), request.id)
    const decisions = await Promise.allSettled([
      service.approve(context(f.userId), request.id, { expectedVersion: 1, expectedContext: preview.expectedContext }),
      service.reject(context(f.userId), request.id, { expectedVersion: 1, reason: '并发驳回' }),
    ])
    expect(decisions.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    const final = await query.getById(request.id)
    expect(['APPROVED', 'REJECTED']).toContain(final.status)
    expect(await prisma.salesOrderPayment.count({ where: { salesOrderId: f.salesOrderId } })).toBe(final.status === SalesReceiptStatusDto.APPROVED ? 1 : 0)
  })
  it('blocks cancellation, price reduction, and approval with a physically missing voucher', async () => {
    const f = await fixture()
    await app.get(SalesOrderMutationService).updateOrderStatus(context(f.userId), f.salesOrderId, { toStatus: 'CONFIRMED' })
    const request = await service.submit(context(f.userId), f.salesOrderId, f.input, randomUUID())
    await expect(app.get(SalesOrderMutationService).updateOrderStatus(context(f.userId), f.salesOrderId, { toStatus: 'CANCELLED', reason: '取消订单' })).rejects.toMatchObject({ code: 'SALES_RECEIPT_STATE_CHANGED' })
    const line = await prisma.salesOrderLine.findFirstOrThrow({ where: { salesOrderId: f.salesOrderId } })
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: f.salesOrderId } })
    await expect(app.get(SalesOrderProductEditService).updateProducts(context(f.userId), f.salesOrderId, { expectedVersion: order.version, reason: '调低应收', confirmDepositReduction: false, existingLines: [{ lineId: line.id, name: line.productNameSnapshot, description: null, actualUnitPriceAmount: '450', desiredQuantity: 2 }], newLines: [] })).rejects.toMatchObject({ code: 'SALES_RECEIPT_AMOUNT_EXCEEDS_AVAILABLE' })
    const preview = await service.approvalContext(context(f.userId), request.id)
    const media = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: request.voucher.mediaAssetId } })
    const path = join(process.env.MEDIA_STORAGE_ROOT!, media.objectKey!)
    await rename(path, `${path}.temporarily-missing`)
    try { await expect(service.approve(context(f.userId), request.id, { expectedVersion: 1, expectedContext: preview.expectedContext })).rejects.toMatchObject({ code: 'SALES_ORDER_DOCUMENT_UNAVAILABLE' }) }
    finally { await rename(`${path}.temporarily-missing`, path) }
    expect((await query.getById(request.id)).status).toBe('PENDING_REVIEW')
  })
  it.each(['0', '100'])('reverses only actual nonzero entries at %s percent', async share => {
    const f = await fixture(share)
    const request = await service.submit(context(f.userId), f.salesOrderId, f.input, randomUUID())
    const preview = await service.approvalContext(context(f.userId), request.id)
    const approved = await service.approve(context(f.userId), request.id, { expectedVersion: 1, expectedContext: preview.expectedContext })
    expect(approved.approvedPayment?.posting?.entries).toHaveLength(1)
    await service.voidPayment(context(f.userId), f.salesOrderId, approved.approvedPayment!.id, { expectedOrderVersion: approved.salesOrder.version, reason: '测试完整冲正' })
    expect((await query.getById(request.id)).approvedPayment?.reversal?.entries).toHaveLength(1)
  })

  it.each(['sales_order_documents', 'sales_order_payments', 'fund_ledger_entries', 'sales_orders'] as const)('rolls back the full approval when %s write fails', async table => {
    const f = await fixture()
    const request = await service.submit(context(f.userId), f.salesOrderId, f.input, randomUUID())
    const preview = await service.approvalContext(context(f.userId), request.id)
    await client.query(`CREATE FUNCTION receipt_test_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt write failure'; END $$`)
    await client.query(`CREATE TRIGGER receipt_test_fail_write BEFORE ${table === 'sales_orders' ? 'UPDATE' : 'INSERT'} ON "${table}" FOR EACH ROW EXECUTE FUNCTION receipt_test_fail_write()`)
    try { await expect(service.approve(context(f.userId), request.id, { expectedVersion: 1, expectedContext: preview.expectedContext })).rejects.toThrow() }
    finally {
      await client.query(`DROP TRIGGER receipt_test_fail_write ON "${table}"`)
      await client.query('DROP FUNCTION receipt_test_fail_write()')
    }
    expect((await query.getById(request.id)).status).toBe('PENDING_REVIEW')
    expect(await prisma.salesOrderPayment.count({ where: { salesOrderId: f.salesOrderId } })).toBe(0)
    expect(await prisma.fundPostingBatch.count({ where: { businessId: request.id } })).toBe(0)
    expect((await prisma.fundAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2)).toBe('0.00')
  })

  it('serializes approval and a currency-first rate update without deadlock or partial posting', async () => {
    const f = await fixture()
    const request = await service.submit(context(f.userId), f.salesOrderId, f.input, randomUUID())
    const preview = await service.approvalContext(context(f.userId), request.id)
    const [approval, update] = await Promise.allSettled([
      service.approve(context(f.userId), request.id, { expectedVersion: 1, expectedContext: preview.expectedContext }),
      prisma.$transaction(async tx => {
        const currencies = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM currencies WHERE code = 'TWD' FOR UPDATE`)
        await tx.$queryRaw(Prisma.sql`SELECT id FROM exchange_rates WHERE currency_id = ${currencies[0].id}::uuid FOR UPDATE`)
        await tx.exchangeRate.update({ where: { currencyId: currencies[0].id }, data: { foreignUnitsPerCny: '4.9', version: { increment: 1 } } })
      }),
    ])
    expect(update.status).toBe('fulfilled')
    const final = await query.getById(request.id)
    if (approval.status === 'fulfilled') {
      expect(final.status).toBe('APPROVED')
      expect(final.approvedPayment?.foreignUnitsPerCnySnapshot).toBe(preview.foreignUnitsPerCny)
      expect(final.approvedPayment?.posting?.businessAmount).toBe(preview.businessAmount)
      expect(await prisma.salesOrderPayment.count({ where: { salesOrderId: f.salesOrderId } })).toBe(1)
      expect(await prisma.fundPostingBatch.count({ where: { businessId: request.id } })).toBe(1)
    } else {
      expect(approval.reason).toMatchObject({ code: 'SALES_RECEIPT_CONTEXT_CHANGED' })
      expect(final.status).toBe('PENDING_REVIEW')
      expect(await prisma.salesOrderPayment.count({ where: { salesOrderId: f.salesOrderId } })).toBe(0)
      expect(await prisma.fundPostingBatch.count({ where: { businessId: request.id } })).toBe(0)
      expect((await prisma.fundAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balance.toFixed(2)).toBe('0.00')
    }
  })

})
