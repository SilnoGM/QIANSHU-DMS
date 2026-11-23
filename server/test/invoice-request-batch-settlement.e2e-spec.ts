import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Client } from 'pg'

import { AppModule } from '../src/app.module'
import { Prisma } from '../src/generated/prisma/client'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { FundPostingApplicationService } from '../src/modules/fund-accounts/application/fund-posting.service'
import { INVOICE_REQUEST_ERROR_CODES } from '../src/modules/invoice-requests/invoice-request.errors'
import { calculateSettleAmountCny, sumBatchSettleAmountsCny } from '../src/modules/invoice-requests/invoice-request.logic'
import { InvoiceRequestQueryService } from '../src/modules/invoice-requests/invoice-request-query.service'
import { InvoiceRequestService } from '../src/modules/invoice-requests/invoice-request.service'
import { cleanupFundE2eData } from './fixtures/fund-e2e-cleanup'
import { insertInvoiceDocumentAsset, insertInvoiceRequest } from './fixtures/invoice-request.fixture'

/**
 * 批量结算的服务级 E2E：真实事务、真实资金入账与真实触发器。
 *
 * 单据只能按合法流转造出来：INSERT 必须是「开票审核中」，再 UPDATE 到「已通知开票」，
 * 最后 UPDATE 到「已开出邮寄」并把照片上传时间回拨——触发器的列白名单只在这两步放行。
 */

jest.setTimeout(120_000)

const USER_PREFIX = 'invoice_batch_e2e_'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for Invoice Request Batch Settlement E2E tests')
  return value
}

interface LockedRow {
  readonly id: string
  readonly version: number
}

describe('invoice request batch settlement against isolated PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let client: Client
  let commands: InvoiceRequestService
  let queries: InvoiceRequestQueryService
  let financeId: string
  let applicantAId: string
  let applicantBId: string
  let rate: { readonly id: string, readonly version: number, readonly foreignUnitsPerCny: string }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    application = moduleRef.createNestApplication()
    await application.init()
    prisma = application.get(PrismaService)
    commands = application.get(InvoiceRequestService)
    queries = application.get(InvoiceRequestQueryService)
    const accounts = application.get(FundAccountCommandService)
    const postings = application.get(FundPostingApplicationService)

    client = new Client({ connectionString: requireDatabaseUrl() })
    await client.connect()

    const twd = await prisma.currency.findUniqueOrThrow({
      where: { code: 'TWD' },
      select: { id: true, exchangeRate: { select: { id: true, version: true, foreignUnitsPerCny: true } } },
    })
    // 数据库要求启用外币前必须已有汇率：先补汇率再启用，空库也能跑；已启用时更新为空操作。
    const exchangeRate = twd.exchangeRate ?? await prisma.exchangeRate.create({
      data: { currencyId: twd.id, foreignUnitsPerCny: '4.500000000000' },
      select: { id: true, version: true, foreignUnitsPerCny: true },
    })
    await prisma.currency.update({ where: { code: 'TWD' }, data: { enabled: true } })
    rate = {
      id: exchangeRate.id,
      version: exchangeRate.version,
      foreignUnitsPerCny: exchangeRate.foreignUnitsPerCny.toString(),
    }

    // 财务只需要跨提交人视角；成本归属始终是单据申请人，与操作人身份无关。
    const permission = await prisma.permission.findFirstOrThrow({
      where: { code: 'data-scope:all' },
      select: { id: true },
    })
    const financeRole = await prisma.role.create({
      data: {
        code: [USER_PREFIX, 'finance_', randomUUID().slice(0, 8)].join(''),
        name: '开票批量结算 E2E 财务',
        permissions: { create: [{ permissionId: permission.id }] },
      },
      select: { id: true },
    })

    financeId = await createUser('finance', financeRole.id)
    applicantAId = await createUser('applicant_a')
    applicantBId = await createUser('applicant_b')

    for (const applicantId of [applicantAId, applicantBId]) {
      const account = await accounts.createUserAccount(
        { actorUserId: financeId, requestId: [USER_PREFIX, randomUUID()].join('') },
        { userId: applicantId, userShareRate: '30' },
      )
      await postings.postManualAdjustment(
        { actorUserId: financeId, requestId: [USER_PREFIX, randomUUID()].join('') },
        {
          userAccountId: account.id,
          amount: '10000',
          adjustmentMode: 'USER_ONLY',
          reason: '开票批量结算 E2E 初始余额',
          idempotencyKey: randomUUID(),
        },
      )
    }
  })

  afterAll(async () => {
    try {
      await cleanupInvoiceE2eData()
    }
    finally {
      await client?.end()
      await application?.close()
    }
  })

  async function createUser(label: string, roleId?: string): Promise<string> {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const username = [USER_PREFIX, label, '_', suffix].join('')
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: ['开票批量结算 E2E', label].join(' '),
        passwordHash: 'e2e-only-not-a-real-password-hash',
        passwordChangedAt: new Date(),
        ...(roleId === undefined ? {} : { roles: { create: { roleId } } }),
      },
      select: { id: true },
    })
    return user.id
  }

  /** 造一张「已开出邮寄」的单；`uploadedHoursAgo` 控制是否已满 120 小时。 */
  async function createIssuedRequest(input: {
    readonly applicantUserId: string
    readonly salesAmount?: number
    readonly uploadedHoursAgo: number
  }): Promise<LockedRow & { readonly invoiceNo: string, readonly totalAmount: number }> {
    const salesAmount = input.salesAmount ?? 1_000
    const taxAmount = Math.round(salesAmount * 0.05)
    const totalAmount = salesAmount + taxAmount
    // 「至少一行明细」与「READY 资产必须有活跃引用」都是延迟约束：建单、照片与两次流转
    // 必须落在同一个事务里，提交时两条约束才同时成立。
    await client.query('BEGIN')
    try {
      const { requestId, invoiceNo } = await insertInvoiceRequest(client, {
        actorUserId: input.applicantUserId,
        salesAmount,
        taxAmount,
        totalAmount,
      })
      const assetId = await insertInvoiceDocumentAsset(client, input.applicantUserId)
      await client.query(
        'UPDATE "invoice_requests" SET "status" = \'NOTIFIED\', "notified_at" = CURRENT_TIMESTAMP, "notified_by_user_id" = $2, "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
        [requestId, input.applicantUserId],
      )
      await client.query(
        'UPDATE "invoice_requests" SET "status" = \'ISSUED\', "document_media_asset_id" = $2, "document_uploaded_at" = $3, "document_uploaded_by_user_id" = $4, "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
        [requestId, assetId, new Date(Date.now() - input.uploadedHoursAgo * 3_600_000), input.applicantUserId],
      )
      const row = await client.query<{ id: string, version: number }>(
        'SELECT "id", "version" FROM "invoice_requests" WHERE "id" = $1',
        [requestId],
      )
      await client.query('COMMIT')
      return { ...row.rows[0], invoiceNo, totalAmount }
    }
    catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }

  async function cleanupInvoiceE2eData(): Promise<void> {
    const users = await prisma.user.findMany({
      where: { usernameNormalized: { startsWith: USER_PREFIX } },
      select: { id: true },
    })
    const userIds = users.map(user => user.id)
    if (userIds.length > 0) {
      const requests = await prisma.invoiceRequest.findMany({
        where: { createdById: { in: userIds } },
        select: { id: true, numberingIssuanceId: true },
      })
      const requestIds = requests.map(request => request.id)
      const issuanceIds = [...new Set(requests.map(request => request.numberingIssuanceId))]
      // 开票单据、状态历史与编号派发都是「不可删除的证据」，只有测试清理才临时关闭 USER 触发器。
      await prisma.$transaction(async (transaction) => {
        const tables = ['invoice_requests', 'invoice_request_status_history', 'invoice_request_lines', 'numbering_issuances']
        for (const table of tables) {
          await transaction.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`)
        }
        await transaction.auditEvent.deleteMany({
          where: requestIds.length === 0
            ? { actorUserId: { in: userIds } }
            : {
                OR: [
                  { actorUserId: { in: userIds } },
                  { targetType: 'INVOICE_REQUEST', targetId: { in: requestIds } },
                ],
              },
        })
        if (requestIds.length > 0) {
          await transaction.invoiceRequestStatusHistory.deleteMany({ where: { requestId: { in: requestIds } } })
          await transaction.invoiceRequestLine.deleteMany({ where: { requestId: { in: requestIds } } })
          await transaction.invoiceRequest.deleteMany({ where: { id: { in: requestIds } } })
        }
        if (issuanceIds.length > 0) {
          await transaction.numberingIssuance.deleteMany({ where: { id: { in: issuanceIds } } })
        }
        for (const table of tables) {
          await transaction.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER USER`)
        }
      })
    }
    // 资金批次、通知、媒体与用户由资金域清理夹具统一收尾；角色 code 也带同一前缀。
    await cleanupFundE2eData(prisma, { usernamePrefix: USER_PREFIX, roleCodePrefix: USER_PREFIX })
  }

  it('settles multiple requests in one transaction and tags the audit with a shared batch id', async () => {
    const first = await createIssuedRequest({ applicantUserId: applicantAId, salesAmount: 1_000, uploadedHoursAgo: 144 })
    const second = await createIssuedRequest({ applicantUserId: applicantBId, salesAmount: 2_000, uploadedHoursAgo: 169 })

    const result = await commands.batchSettle(
      { actorUserId: financeId, requestId: [USER_PREFIX, randomUUID()].join('') },
      {
        items: [
          { id: first.id, expectedVersion: first.version },
          { id: second.id, expectedVersion: second.version },
        ],
        exchangeRateId: rate.id,
        exchangeRateVersion: rate.version,
      },
    )

    const expectedFirst = calculateSettleAmountCny(BigInt(first.totalAmount), new Prisma.Decimal(rate.foreignUnitsPerCny))
    const expectedSecond = calculateSettleAmountCny(BigInt(second.totalAmount), new Prisma.Decimal(rate.foreignUnitsPerCny))
    expect(result.items).toHaveLength(2)
    expect(result.items.map(item => item.invoiceNo).sort()).toEqual([first.invoiceNo, second.invoiceNo].sort())
    expect(result.foreignUnitsPerCny).toBe(rate.foreignUnitsPerCny)
    expect(result.totalAmountCny).toBe(sumBatchSettleAmountsCny([expectedFirst, expectedSecond]))
    expect(new Set(result.items.map(item => item.settleAmountCny))).toEqual(new Set([expectedFirst, expectedSecond]))
    expect(result.items.every(item => item.fundPostingBatchId.length > 0)).toBe(true)

    const rows = await prisma.invoiceRequest.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { status: true, settleAmountCny: true, fundPostingBatchId: true, exchangeRateVersionSnapshot: true },
    })
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.status).toBe('SETTLED')
      expect(row.settleAmountCny).not.toBeNull()
      expect(row.fundPostingBatchId).not.toBeNull()
      expect(row.exchangeRateVersionSnapshot).toBe(rate.version)
    }

    const batches = await prisma.fundPostingBatch.findMany({
      where: { businessId: { in: [first.id, second.id] } },
      select: { businessId: true, userId: true },
    })
    expect(batches).toHaveLength(2)
    expect(new Set(batches.map(batch => batch.businessId))).toEqual(new Set([first.id, second.id]))

    const audits = await prisma.auditEvent.findMany({
      where: { eventType: 'INVOICE_REQUEST_SETTLED', targetId: { in: [first.id, second.id] } },
      select: { targetId: true, metadata: true },
    })
    expect(audits).toHaveLength(2)
    const batchIds = new Set(audits.map((audit) => {
      const metadata = audit.metadata
      return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
        ? Reflect.get(metadata, 'settlementBatchId')
        : undefined
    }))
    expect(batchIds.size).toBe(1)
    expect([...batchIds][0]).toEqual(expect.any(String))

    const histories = await prisma.invoiceRequestStatusHistory.count({
      where: { requestId: { in: [first.id, second.id] }, action: 'SETTLE', toStatus: 'SETTLED' },
    })
    expect(histories).toBe(2)
  })

  it('rejects the whole batch before writing anything when one request is not settleable', async () => {
    const ready = await createIssuedRequest({ applicantUserId: applicantAId, uploadedHoursAgo: 144 })
    const waiting = await createIssuedRequest({ applicantUserId: applicantBId, uploadedHoursAgo: 1 })

    await expect(commands.batchSettle(
      { actorUserId: financeId, requestId: [USER_PREFIX, randomUUID()].join('') },
      {
        items: [
          { id: ready.id, expectedVersion: ready.version },
          { id: waiting.id, expectedVersion: waiting.version },
        ],
        exchangeRateId: rate.id,
        exchangeRateVersion: rate.version,
      },
    )).rejects.toMatchObject({
      code: INVOICE_REQUEST_ERROR_CODES.BATCH_SETTLE_INVALID,
      status: 409,
    })

    const rows = await prisma.invoiceRequest.findMany({
      where: { id: { in: [ready.id, waiting.id] } },
      select: { status: true, fundPostingBatchId: true },
    })
    expect(rows.map(row => row.status)).toEqual(['ISSUED', 'ISSUED'])
    expect(rows.every(row => row.fundPostingBatchId === null)).toBe(true)

    const batches = await prisma.fundPostingBatch.count({
      where: { businessId: { in: [ready.id, waiting.id] } },
    })
    expect(batches).toBe(0)

    // 未满 120 小时的那张必须出现在逐张原因里，财务才能直接剔除。
    const failure: unknown = await commands.batchSettle(
      { actorUserId: financeId, requestId: [USER_PREFIX, randomUUID()].join('') },
      {
        items: [
          { id: ready.id, expectedVersion: ready.version },
          { id: waiting.id, expectedVersion: waiting.version },
        ],
        exchangeRateId: rate.id,
        exchangeRateVersion: rate.version,
      },
    ).then(() => null, (error: unknown) => error)
    const invalidItems = (failure as { fieldErrors?: { invalidItems?: string[] } } | null)?.fieldErrors?.invalidItems ?? []
    expect(invalidItems.some(item => item.includes(waiting.invoiceNo))).toBe(true)
    expect(invalidItems.some(item => item.includes(ready.invoiceNo))).toBe(false)
  })

  it('rejects duplicate ids before touching any request', async () => {
    const request = await createIssuedRequest({ applicantUserId: applicantAId, uploadedHoursAgo: 144 })

    await expect(commands.batchSettle(
      { actorUserId: financeId, requestId: [USER_PREFIX, randomUUID()].join('') },
      {
        items: [
          { id: request.id, expectedVersion: request.version },
          { id: request.id, expectedVersion: request.version },
        ],
        exchangeRateId: rate.id,
        exchangeRateVersion: rate.version,
      },
    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 })

    const row = await prisma.invoiceRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true },
    })
    expect(row.status).toBe('ISSUED')
  })

  it('rejects a stale expected version without settling any request in the batch', async () => {
    const first = await createIssuedRequest({ applicantUserId: applicantAId, uploadedHoursAgo: 144 })
    const second = await createIssuedRequest({ applicantUserId: applicantBId, uploadedHoursAgo: 144 })

    await expect(commands.batchSettle(
      { actorUserId: financeId, requestId: [USER_PREFIX, randomUUID()].join('') },
      {
        items: [
          { id: first.id, expectedVersion: first.version },
          { id: second.id, expectedVersion: second.version + 1 },
        ],
        exchangeRateId: rate.id,
        exchangeRateVersion: rate.version,
      },
    )).rejects.toMatchObject({ code: INVOICE_REQUEST_ERROR_CODES.BATCH_SETTLE_INVALID, status: 409 })

    const rows = await prisma.invoiceRequest.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { status: true },
    })
    expect(rows.map(row => row.status)).toEqual(['ISSUED', 'ISSUED'])
  })

  it('splits the issued view into waiting and settleable with matching counts', async () => {
    const settleable = await createIssuedRequest({ applicantUserId: applicantAId, uploadedHoursAgo: 144 })
    const waiting = await createIssuedRequest({ applicantUserId: applicantBId, uploadedHoursAgo: 1 })

    const settleableView = await queries.list(financeId, { status: 'ISSUED', issuedView: 'SETTLEABLE', pageSize: 100 })
    expect(settleableView.items.some(row => row.id === settleable.id)).toBe(true)
    expect(settleableView.items.some(row => row.id === waiting.id)).toBe(false)

    const waitingView = await queries.list(financeId, { status: 'ISSUED', issuedView: 'WAITING', pageSize: 100 })
    expect(waitingView.items.some(row => row.id === waiting.id)).toBe(true)
    expect(waitingView.items.some(row => row.id === settleable.id)).toBe(false)

    // 二级计数必须与第一层 ISSUED 计数共用分母，否则切换两视图时数字会对不上。
    const counts = await queries.statusCounts(financeId, {})
    const issuedCount = counts.statuses.find(item => item.value === 'ISSUED')?.count ?? 0
    expect(counts.issuedWaiting + counts.issuedSettleable).toBe(issuedCount)
    expect(counts.issuedWaiting).toBeGreaterThanOrEqual(1)
    expect(counts.issuedSettleable).toBeGreaterThanOrEqual(1)
  })
})
