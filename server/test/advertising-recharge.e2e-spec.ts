import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import sharp from 'sharp'

import { AppModule } from '../src/app.module'
import mediaConfig, { createMediaConfiguration } from '../src/config/media.config'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { AdvertisingRechargeQueryService } from '../src/modules/advertising-recharges/advertising-recharge-query.service'
import { AdvertisingRechargeService } from '../src/modules/advertising-recharges/advertising-recharge.service'
import {
  ADVERTISING_RECHARGE_PROOF_POOL,
  ADVERTISING_RECHARGE_PROOF_UPLOAD_PURPOSE,
  ADVERTISING_RECHARGE_QR_POOL,
  ADVERTISING_RECHARGE_QR_UPLOAD_PURPOSE,
} from '../src/modules/advertising-recharges/advertising-recharge.contract'
import { MediaAssetService } from '../src/modules/media/media-asset.service'
import { MediaContentValidator } from '../src/modules/media/media-content-validator'

jest.setTimeout(90_000)

const USER_PREFIX = 'fund_adv_'

describe('advertising recharge against isolated PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let accounts: FundAccountCommandService
  let recharges: AdvertisingRechargeService
  let queries: AdvertisingRechargeQueryService
  let media: MediaAssetService
  let png: Buffer
  let financeId: string
  let applicantId: string
  let otherApplicantId: string
  let applicantAccountId: string
  let otherApplicantAccountId: string
  let mediaRoot: string

  beforeAll(async () => {
    mediaRoot = await mkdtemp(join(homedir(), '.qianshu-advertising-recharge-media-'))
    png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    }).png().toBuffer()
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(mediaConfig.KEY)
      .useValue(createMediaConfiguration({ MEDIA_STORAGE_ROOT: mediaRoot }))
      .overrideProvider(MediaContentValidator)
      .useValue({
        validate: async (input: { declaredMimeType: string, sourcePath: string }) => {
          const bytes = await readFile(input.sourcePath)
          return {
            canonicalExtension: '.png',
            checksumSha256: createHash('sha256').update(bytes).digest('hex'),
            height: 2,
            mediaType: 'IMAGE',
            mimeType: input.declaredMimeType,
            sizeBytes: BigInt(bytes.length),
            width: 2,
          }
        },
      })
      .compile()
    application = moduleRef.createNestApplication()
    await application.init()
    prisma = application.get(PrismaService)
    accounts = application.get(FundAccountCommandService)
    recharges = application.get(AdvertisingRechargeService)
    queries = application.get(AdvertisingRechargeQueryService)
    media = application.get(MediaAssetService)

    financeId = await createUser('finance', '充值财务')
    applicantId = await createUser('applicant', '充值运营')
    otherApplicantId = await createUser('other', '其他运营')
    applicantAccountId = (await accounts.createUserAccount(commandContext('account'), {
      userId: applicantId,
      userShareRate: '30',
    })).id
    otherApplicantAccountId = (await accounts.createUserAccount(commandContext('account2'), {
      userId: otherApplicantId,
      userShareRate: '50',
    })).id
  })

  afterAll(async () => {
    try {
      await cleanup()
    }
    finally {
      await application?.close()
      await rm(mediaRoot, { recursive: true, force: true })
    }
  })

  function commandContext(prefix: string) {
    return {
      actorUserId: financeId,
      requestId: `fund_adv_${prefix.slice(0, 12)}_${randomUUID()}`,
    }
  }

  function applicantContext(prefix: string, userId = applicantId) {
    return {
      actorUserId: userId,
      requestId: `fund_adv_${prefix.slice(0, 12)}_${randomUUID()}`,
    }
  }

  async function createUser(label: string, displayName: string): Promise<string> {
    const suffix = randomUUID().replaceAll('-', '')
    const username = `${USER_PREFIX}${label}_${suffix}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName,
        passwordHash: 'hash',
        passwordChangedAt: new Date(),
        profile: { create: {} },
      },
      select: { id: true },
    })
    return user.id
  }

  async function imageAsset(input: { actorUserId: string, purpose: string, pool: 'voucher' | 'payment-recipient', fileName: string }): Promise<string> {
    const asset = await media.prepare({
      actorUserId: input.actorUserId,
      allowedTypes: ['IMAGE'],
      requestedType: 'IMAGE',
      declaredMimeType: 'image/png',
      originalFilename: input.fileName,
      pool: input.pool,
      stream: Readable.from(png),
    })
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { uploadPurpose: input.purpose },
    })
    return asset.id
  }

  function qrAsset(): Promise<string> {
    return imageAsset({
      actorUserId: applicantId,
      purpose: ADVERTISING_RECHARGE_QR_UPLOAD_PURPOSE,
      pool: ADVERTISING_RECHARGE_QR_POOL,
      fileName: '充值运营-广告账户充值收款码.png',
    })
  }

  function proofAsset(): Promise<string> {
    return imageAsset({
      actorUserId: financeId,
      purpose: ADVERTISING_RECHARGE_PROOF_UPLOAD_PURPOSE,
      pool: ADVERTISING_RECHARGE_PROOF_POOL,
      fileName: '充值运营-广告充值1000元.png',
    })
  }

  async function createRecharge(input: { amount?: string, accountType?: 'PERSONAL' | 'NON_PERSONAL', currency?: 'CNY' | 'USD', userId?: string, qr?: string | null } = {}) {
    const owner = input.userId ?? applicantId
    const accountType = input.accountType ?? 'PERSONAL'
    const qr = accountType === 'PERSONAL'
      ? input.qr ?? (owner === applicantId ? await qrAsset() : await imageAsset({
          actorUserId: owner,
          purpose: ADVERTISING_RECHARGE_QR_UPLOAD_PURPOSE,
          pool: ADVERTISING_RECHARGE_QR_POOL,
          fileName: '其他运营-广告账户充值收款码.png',
        }))
      : null
    return recharges.submit(applicantContext('submit', owner), {
      accountType,
      adAccountName: '千树-美国投放户',
      adAccountNo: `act_${randomUUID().slice(0, 8)}`,
      rechargeAmount: input.amount ?? '1000.00',
      rechargeCurrency: input.currency,
      ...(qr === null ? {} : { paymentQrMediaAssetId: qr }),
      remark: 'E2E 充值',
    }, randomUUID())
  }

  async function balances() {
    const company = await prisma.fundAccount.findFirstOrThrow({ where: { ownerType: 'COMPANY' }, select: { id: true, balance: true } })
    const user = await prisma.fundAccount.findUniqueOrThrow({ where: { id: applicantAccountId }, select: { balance: true } })
    return { companyId: company.id, company: company.balance.toFixed(2), user: user.balance.toFixed(2) }
  }

  it('creates a pending application with the AD/YYYYMMDD-#### number and no fund movement', async () => {
    const before = await balances()
    const created = await createRecharge({ amount: '1000.00', currency: 'USD' })

    expect(created).toMatchObject({
      status: 'PENDING',
      accountType: 'PERSONAL',
      rechargeAmount: '1000.00',
      rechargeCurrency: 'USD',
      remark: 'E2E 充值',
      applicant: { id: applicantId, name: '充值运营' },
      payment: null,
      reject: null,
      void: null,
    })
    expect(created.rechargeNo).toMatch(/^AD\/\d{8}-\d{4}$/u)
    expect(created.paymentQr).not.toBeNull()
    expect(created.paymentQr?.mediaAssetId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(await balances()).toEqual(before)
    expect(await prisma.fundPostingBatch.count({ where: { businessSourceCodeSnapshot: 'ADVERTISING_RECHARGE' } })).toBe(0)
  })

  it('replays the same idempotency key and rejects changed content', async () => {
    const key = randomUUID()
    const qr = await qrAsset()
    const payload = {
      accountType: 'PERSONAL' as const,
      adAccountName: '幂等户',
      adAccountNo: 'act_idem',
      rechargeAmount: '50.00',
      rechargeCurrency: 'USD' as const,
      paymentQrMediaAssetId: qr,
    }
    const first = await recharges.submit(applicantContext('idem'), payload, key)
    const replay = await recharges.submit(applicantContext('idem2'), payload, key)
    expect(replay.id).toBe(first.id)
    await expect(recharges.submit(applicantContext('idem3'), { ...payload, rechargeAmount: '51.00' }, key))
      .rejects.toMatchObject({ code: 'ADVERTISING_RECHARGE_IDEMPOTENCY_CONFLICT' })
  })

  it('requires a QR for personal accounts and rejects one for non-personal accounts', async () => {
    await expect(recharges.submit(applicantContext('noqr'), {
      accountType: 'PERSONAL',
      adAccountName: '无码户',
      adAccountNo: 'act_noqr',
      rechargeAmount: '10.00',
    }, randomUUID())).rejects.toMatchObject({ code: 'ADVERTISING_RECHARGE_QR_REQUIRED' })

    await expect(recharges.submit(applicantContext('badqr'), {
      accountType: 'NON_PERSONAL',
      adAccountName: '对公户',
      adAccountNo: 'act_badqr',
      rechargeAmount: '10.00',
      paymentQrMediaAssetId: await qrAsset(),
    }, randomUUID())).rejects.toMatchObject({ code: 'ADVERTISING_RECHARGE_VALIDATION_FAILED' })

    const nonPersonal = await createRecharge({ accountType: 'NON_PERSONAL', amount: '20.00' })
    expect(nonPersonal.paymentQr).toBeNull()
  })

  it('scopes the own list to the applicant and hides other applicants', async () => {
    const mine = await createRecharge({ amount: '30.00' })
    const others = await createRecharge({ amount: '40.00', userId: otherApplicantId })

    const own = await queries.listOwn(applicantId, { page: 1, pageSize: 100 })
    expect(own.items.some(item => item.id === mine.id)).toBe(true)
    expect(own.items.some(item => item.id === others.id)).toBe(false)
    await expect(queries.getOwn(applicantId, others.id)).rejects.toMatchObject({ code: 'ADVERTISING_RECHARGE_NOT_FOUND' })

    const review = await queries.list({ page: 1, pageSize: 100 })
    expect(review.items.some(item => item.id === mine.id)).toBe(true)
    expect(review.items.some(item => item.id === others.id)).toBe(true)
    expect(review.statusCounts.length).toBeGreaterThan(0)
  })

  it('withdraws and rejects without posting funds, and the terminal states cannot repeat', async () => {
    const withdrawn = await createRecharge({ amount: '60.00' })
    const afterWithdraw = await recharges.withdraw(applicantContext('wd'), withdrawn.id, withdrawn.version)
    expect(afterWithdraw.status).toBe('WITHDRAWN')
    expect(afterWithdraw.withdrawnAt).not.toBeNull()
    await expect(recharges.withdraw(applicantContext('wd2'), withdrawn.id, afterWithdraw.version))
      .rejects.toMatchObject({ code: 'ADVERTISING_RECHARGE_STATUS_NOT_ALLOWED' })
    await expect(recharges.reject(commandContext('rej0'), withdrawn.id, { expectedVersion: afterWithdraw.version, reason: '不该成功' }))
      .rejects.toMatchObject({ code: 'ADVERTISING_RECHARGE_STATUS_NOT_ALLOWED' })

    const rejected = await createRecharge({ amount: '70.00' })
    const afterReject = await recharges.reject(commandContext('rej'), rejected.id, {
      expectedVersion: rejected.version,
      reason: '账户编号填错',
    })
    expect(afterReject.status).toBe('REJECTED')
    expect(afterReject.reject).toMatchObject({ reason: '账户编号填错', reviewedBy: { id: financeId } })
    await expect(recharges.withdraw(applicantContext('wd3'), rejected.id, afterReject.version))
      .rejects.toMatchObject({ code: 'ADVERTISING_RECHARGE_STATUS_NOT_ALLOWED' })
    expect(await prisma.fundPostingBatch.count({ where: { businessId: rejected.id } })).toBe(0)
  })

  it('pays once, splits the CNY amount by the applicant share rate and voids with a full reversal', async () => {
    const created = await createRecharge({ amount: '500.00', currency: 'USD' })
    const before = await balances()
    const proof = await proofAsset()

    const paid = await recharges.pay(commandContext('pay'), created.id, {
      expectedVersion: created.version,
      paymentAmountCny: '1000.00',
      paymentProofMediaAssetId: proof,
    })
    expect(paid.status).toBe('PAID')
    expect(paid.payment).toMatchObject({
      amountCny: '1000.00',
      proof: { mediaAssetId: proof },
      paidBy: { id: financeId },
    })
    expect(paid.payment?.fundPostingBatchNo).toMatch(/^FUND\/\d{8}-\d{5}$/u)
    expect(paid.void).toBeNull()

    const batch = await prisma.fundPostingBatch.findFirstOrThrow({
      where: { businessId: created.id, businessSourceCodeSnapshot: 'ADVERTISING_RECHARGE' },
      include: { entries: { orderBy: { lineNo: 'asc' } } },
    })
    expect(batch).toMatchObject({
      kind: 'BUSINESS',
      consumerCode: 'ADVERTISING_RECHARGE.PAY',
      postingTypeCodeSnapshot: 'ADVERTISING_FEE',
      businessCategorySnapshot: 'COST',
      userId: applicantId,
      businessNo: created.rechargeNo,
      summary: '广告账户充值',
    })
    expect(batch.businessAmount.toFixed(2)).toBe('1000.00')
    expect(batch.userShareRateSnapshot?.toFixed(2)).toBe('30.00')
    expect(batch.companyShareRateSnapshot?.toFixed(2)).toBe('70.00')
    expect(batch.entries).toHaveLength(2)
    expect(batch.entries[0]).toMatchObject({ accountTarget: 'USER', direction: 'DEBIT', accountId: applicantAccountId })
    expect(batch.entries[0]?.amount.toFixed(2)).toBe('300.00')
    expect(batch.entries[1]).toMatchObject({ accountTarget: 'COMPANY', direction: 'DEBIT' })
    expect(batch.entries[1]?.amount.toFixed(2)).toBe('700.00')

    const afterPay = await balances()
    expect(afterPay.user).toBe((Number(before.user) - 300).toFixed(2))
    expect(afterPay.company).toBe((Number(before.company) - 700).toFixed(2))

    await expect(recharges.pay(commandContext('pay2'), created.id, {
      expectedVersion: paid.version,
      paymentAmountCny: '1000.00',
      paymentProofMediaAssetId: await proofAsset(),
    })).rejects.toMatchObject({ code: 'ADVERTISING_RECHARGE_STATUS_NOT_ALLOWED' })

    const voided = await recharges.void(commandContext('void'), created.id, {
      expectedVersion: paid.version,
      reason: '金额填错',
    })
    expect(voided.status).toBe('VOIDED')
    expect(voided.void).toMatchObject({ reason: '金额填错', voidedBy: { id: financeId } })
    expect(voided.payment).toMatchObject({ amountCny: '1000.00', proof: { mediaAssetId: proof } })

    const reversal = await prisma.fundPostingBatch.findFirstOrThrow({
      where: { businessId: created.id, kind: 'REVERSAL' },
      include: { entries: { orderBy: { lineNo: 'asc' } } },
    })
    expect(reversal).toMatchObject({
      consumerCode: 'ADVERTISING_RECHARGE.VOID',
      postingTypeCodeSnapshot: 'ADVERTISING_FEE',
    })
    expect(reversal.businessAmount.toFixed(2)).toBe('-1000.00')
    expect(reversal.entries).toHaveLength(2)
    expect(reversal.entries[0]).toMatchObject({ accountTarget: 'USER', direction: 'CREDIT' })
    expect(reversal.entries[0]?.amount.toFixed(2)).toBe('300.00')
    expect(reversal.entries[1]).toMatchObject({ accountTarget: 'COMPANY', direction: 'CREDIT' })
    expect(reversal.entries[1]?.amount.toFixed(2)).toBe('700.00')

    expect(await balances()).toEqual(before)
    await expect(recharges.void(commandContext('void2'), created.id, {
      expectedVersion: voided.version,
      reason: '重复作废',
    })).rejects.toMatchObject({ code: 'ADVERTISING_RECHARGE_STATUS_NOT_ALLOWED' })
  })

  it('refuses submission when the applicant has no usable fund account', async () => {
    const noAccountId = await createUser('noaccount', '无账户运营')
    await expect(recharges.submit(applicantContext('noacct', noAccountId), {
      accountType: 'NON_PERSONAL',
      adAccountName: '无账户户',
      adAccountNo: 'act_noaccount',
      rechargeAmount: '10.00',
    }, randomUUID())).rejects.toMatchObject({ code: 'ADVERTISING_RECHARGE_ACCOUNT_UNAVAILABLE' })
  })

  it('keeps the applicant share owner and company rate snapshot independent of later rate changes', async () => {
    const created = await createRecharge({ amount: '200.00' })
    const proof = await proofAsset()
    await recharges.pay(commandContext('payrate'), created.id, {
      expectedVersion: created.version,
      paymentAmountCny: '200.00',
      paymentProofMediaAssetId: proof,
    })
    const batch = await prisma.fundPostingBatch.findFirstOrThrow({
      where: { businessId: created.id, businessSourceCodeSnapshot: 'ADVERTISING_RECHARGE' },
    })
    expect(batch.userId).toBe(applicantId)
    expect(batch.userShareRateSnapshot?.toFixed(2)).toBe('30.00')
    expect(batch.companyShareRateSnapshot?.toFixed(2)).toBe('70.00')
    const otherAccount = await prisma.fundAccount.findUniqueOrThrow({
      where: { id: otherApplicantAccountId },
      select: { userShareRate: true },
    })
    expect(otherAccount.userShareRate?.toFixed(2)).toBe('50.00')
  })

  async function cleanup(): Promise<void> {
    const users = await prisma.user.findMany({
      where: { usernameNormalized: { startsWith: USER_PREFIX } },
      select: { id: true },
    })
    const userIds = users.map(user => user.id)
    if (userIds.length === 0) return
    const requests = await prisma.advertisingRechargeRequest.findMany({
      where: { applicantUserId: { in: userIds } },
      select: { id: true, numberingIssuanceId: true },
    })
    const requestIds = requests.map(request => request.id)
    const accounts = await prisma.fundAccount.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    })
    const accountIds = accounts.map(account => account.id)
    const batches = await prisma.fundPostingBatch.findMany({
      where: { OR: [{ userId: { in: userIds } }, { actorUserId: { in: userIds } }] },
      select: { id: true, numberingIssuanceId: true },
    })
    const batchIds = batches.map(batch => batch.id)
    const mediaAssets = await prisma.mediaAsset.findMany({
      where: { createdByUserId: { in: userIds } },
      select: { id: true },
    })
    // 充值与作废会为申请人生成通知；通知对请求人、发号记录都是 RESTRICT 外键。
    const notifications = await prisma.notification.findMany({
      where: { requestedByUserId: { in: userIds } },
      select: { id: true, numberingIssuanceId: true },
    })
    const notificationIds = notifications.map(notification => notification.id)
    const issuanceIds = [...new Set([
      ...requests.map(request => request.numberingIssuanceId),
      ...batches.flatMap(batch => batch.numberingIssuanceId === null ? [] : [batch.numberingIssuanceId]),
      ...notifications.flatMap(notification => notification.numberingIssuanceId === null ? [] : [notification.numberingIssuanceId]),
    ])]

    await prisma.$transaction(async (transaction) => {
      for (const table of [
        'advertising_recharge_requests',
        'fund_posting_batches',
        'fund_ledger_entries',
        'fund_accounts',
        'numbering_issuances',
        'media_assets',
      ]) {
        await transaction.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`)
      }
      await transaction.auditEvent.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: userIds } },
            ...(requestIds.length === 0 ? [] : [{ targetType: 'ADVERTISING_RECHARGE_REQUEST', targetId: { in: requestIds } }]),
          ],
        },
      })
      if (requestIds.length > 0) {
        await transaction.advertisingRechargeRequest.deleteMany({ where: { id: { in: requestIds } } })
      }
      if (batchIds.length > 0) {
        await transaction.fundLedgerEntry.deleteMany({ where: { batchId: { in: batchIds } } })
        await transaction.fundPostingBatchSource.deleteMany({ where: { batchId: { in: batchIds } } })
        await transaction.fundPostingBatch.deleteMany({ where: { id: { in: batchIds } } })
      }
      await transaction.assistantDelivery.deleteMany({ where: { recipientUserId: { in: userIds } } })
      if (notificationIds.length > 0) {
        await transaction.notification.deleteMany({ where: { id: { in: notificationIds } } })
      }
      if (issuanceIds.length > 0) {
        await transaction.numberingIssuance.deleteMany({ where: { id: { in: issuanceIds } } })
      }
      if (accountIds.length > 0) {
        await transaction.fundAccount.deleteMany({ where: { id: { in: accountIds } } })
      }
      if (mediaAssets.length > 0) {
        await transaction.mediaAsset.deleteMany({ where: { id: { in: mediaAssets.map(asset => asset.id) } } })
      }
      await transaction.authSession.deleteMany({ where: { userId: { in: userIds } } })
      await transaction.userRole.deleteMany({ where: { userId: { in: userIds } } })
      await transaction.user.updateMany({
        where: { id: { in: userIds } },
        data: { status: 'ACTIVE', createdByUserId: null, disabledAt: null, disabledByUserId: null },
      })
      await transaction.user.deleteMany({ where: { id: { in: userIds } } })
      for (const table of [
        'advertising_recharge_requests',
        'fund_posting_batches',
        'fund_ledger_entries',
        'fund_accounts',
        'numbering_issuances',
        'media_assets',
      ]) {
        await transaction.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER USER`)
      }
    })
  }
})
