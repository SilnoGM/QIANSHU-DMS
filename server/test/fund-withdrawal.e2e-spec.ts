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
import { FundPostingApplicationService } from '../src/modules/fund-accounts/application/fund-posting.service'
import { FundWithdrawalDocumentService } from '../src/modules/fund-withdrawals/fund-withdrawal-document.service'
import { FundWithdrawalQueryService } from '../src/modules/fund-withdrawals/fund-withdrawal-query.service'
import { FundWithdrawalService } from '../src/modules/fund-withdrawals/fund-withdrawal.service'
import {
  FUND_WITHDRAWAL_PAYMENT_PROOF_UPLOAD_PURPOSE,
} from '../src/modules/fund-withdrawals/fund-withdrawal.contract'
import { buildFundWithdrawalProofFilename } from '../src/modules/fund-withdrawals/fund-withdrawal.logic'
import { MediaAssetService } from '../src/modules/media/media-asset.service'
import { MediaContentValidator } from '../src/modules/media/media-content-validator'
import { cleanupFundE2eData } from './fixtures/fund-e2e-cleanup'

jest.setTimeout(90_000)

describe('fund withdrawals against isolated PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let accounts: FundAccountCommandService
  let postings: FundPostingApplicationService
  let withdrawals: FundWithdrawalService
  let queries: FundWithdrawalQueryService
  let documents: FundWithdrawalDocumentService
  let media: MediaAssetService
  let png: Buffer
  let financeId: string
  let applicantId: string
  let applicantAccountId: string
  let mediaRoot: string

  beforeAll(async () => {
    // CI 中默认媒体根不可写；付款截图使用用户目录下的独占目录，结束时清理。
    mediaRoot = await mkdtemp(join(homedir(), '.qianshu-fund-withdrawal-media-'))
    png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    }).png().toBuffer()
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(mediaConfig.KEY)
      .useValue(createMediaConfiguration({ MEDIA_STORAGE_ROOT: mediaRoot }))
      // Jest 29 不能解析 ESM-only file-type；这里只跳过解码/魔数探测，
      // 媒体写入、摘要/大小一致性、引用与付款截图形状仍走生产实现。
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
    postings = application.get(FundPostingApplicationService)
    withdrawals = application.get(FundWithdrawalService)
    queries = application.get(FundWithdrawalQueryService)
    documents = application.get(FundWithdrawalDocumentService)
    media = application.get(MediaAssetService)

    financeId = await createUser('finance', '提款财务')
    applicantId = await createUser('applicant', '提款测试用户')
    const account = await accounts.createUserAccount(commandContext('account'), {
      userId: applicantId,
      userShareRate: '30',
    })
    applicantAccountId = account.id
    await postings.postManualAdjustment(commandContext('seed'), {
      userAccountId: applicantAccountId,
      amount: '100',
      adjustmentMode: 'USER_ONLY',
      reason: '提款 E2E 初始余额',
      idempotencyKey: randomUUID(),
    })
  })

  afterAll(async () => {
    try {
      await cleanupFundE2eData(prisma, { usernamePrefix: 'fund_wd_' })
    }
    finally {
      await application?.close()
      await rm(mediaRoot, { recursive: true, force: true })
    }
  })

  function commandContext(prefix: string) {
    return {
      actorUserId: financeId,
      requestId: `fund_wd_${prefix.slice(0, 12)}_${randomUUID()}`,
    }
  }

  function applicantContext(prefix: string) {
    return {
      actorUserId: applicantId,
      requestId: `fund_wd_${prefix.slice(0, 12)}_${randomUUID()}`,
    }
  }

  async function createUser(label: string, displayName: string): Promise<string> {
    const suffix = randomUUID().replaceAll('-', '')
    const username = `fund_wd_${label}_${suffix}`
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

  async function proofAsset(amount: string): Promise<{ assetId: string, fileName: string }> {
    const fileName = buildFundWithdrawalProofFilename({
      amount,
      displayName: '提款测试用户',
      extension: '.png',
      uploadedAt: new Date(),
    })
    const asset = await media.prepare({
      actorUserId: financeId,
      allowedTypes: ['IMAGE'],
      requestedType: 'IMAGE',
      declaredMimeType: 'image/png',
      originalFilename: fileName,
      pool: 'voucher',
      stream: Readable.from(png),
    })
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { uploadPurpose: FUND_WITHDRAWAL_PAYMENT_PROOF_UPLOAD_PURPOSE },
    })
    const stored = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: asset.id },
      select: { originalFilename: true },
    })
    return { assetId: asset.id, fileName: stored.originalFilename }
  }

  async function createWithdrawal(amount = '150.00') {
    return withdrawals.submit(applicantContext('submit'), { amount }, randomUUID())
  }

  it('creates a pending request without touching funds and scopes the own list', async () => {
    const before = await prisma.fundAccount.findUniqueOrThrow({
      where: { id: applicantAccountId },
      select: { balance: true, nextSequence: true },
    })
    const created = await createWithdrawal('150.00')

    expect(created).toMatchObject({
      amount: '150.00',
      applicantName: '提款测试用户',
      status: 'PENDING',
      rejectReason: null,
      paymentProof: null,
    })
    expect(created.withdrawalNo).toMatch(/^WD\/\d{8}-\d{4}$/u)
    expect(created.accountBalance).toBe('100.00')
    await expect(queries.getOwn(applicantId, created.id)).resolves.toMatchObject({ id: created.id })
    await expect(queries.getReview(created.id)).resolves.toMatchObject({ id: created.id })
    expect(await prisma.fundAccount.findUniqueOrThrow({
      where: { id: applicantAccountId },
      select: { balance: true, nextSequence: true },
    })).toEqual(before)
    expect(await prisma.fundPostingBatch.count({
      where: { businessSourceCodeSnapshot: 'FUND_WITHDRAWAL' },
    })).toBe(0)
  })

  it('replays the same idempotency key and rejects a different amount', async () => {
    const key = randomUUID()
    const first = await withdrawals.submit(applicantContext('idem'), { amount: '10.00' }, key)
    const replay = await withdrawals.submit(applicantContext('idem2'), { amount: '10.00' }, key)
    expect(replay.id).toBe(first.id)
    await expect(withdrawals.submit(applicantContext('idem3'), { amount: '11.00' }, key))
      .rejects.toMatchObject({ code: 'FUND_WITHDRAWAL_IDEMPOTENCY_CONFLICT' })
  })

  it('rejects without posting funds', async () => {
    const created = await createWithdrawal('10.00')
    const beforeBatchCount = await prisma.fundPostingBatch.count({
      where: { businessSourceCodeSnapshot: 'FUND_WITHDRAWAL' },
    })
    const rejected = await withdrawals.reject(commandContext('reject'), created.id, {
      expectedVersion: created.version,
      reason: '收款信息不完整',
    })
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      rejectReason: '收款信息不完整',
      paymentProof: null,
      fundPostingBatchNo: null,
    })
    expect(await prisma.fundPostingBatch.count({
      where: { businessSourceCodeSnapshot: 'FUND_WITHDRAWAL' },
    })).toBe(beforeBatchCount)
    await expect(queries.getOwn(applicantId, created.id)).resolves.toMatchObject({
      status: 'REJECTED',
      rejectReason: '收款信息不完整',
    })
  })

  it('approves with a proof, posts a user debit and allows a negative balance', async () => {
    const created = await createWithdrawal('150.00')
    const proof = await proofAsset('150.00')

    const approved = await withdrawals.approve(commandContext('approve'), created.id, {
      expectedVersion: created.version,
      paymentProofMediaAssetId: proof.assetId,
    })
    expect(approved).toMatchObject({
      status: 'APPROVED',
      amount: '150.00',
      paymentProof: { mediaAssetId: proof.assetId, fileName: proof.fileName },
    })
    expect(approved.paymentProof?.fileName).toContain('提款测试用户-提款150元-')
    expect(approved.fundPostingBatchNo).toMatch(/^FUND\/\d{8}-\d{5}$/u)
    expect(approved.accountBalance).toBe('-50.00')

    const batch = await prisma.fundPostingBatch.findFirstOrThrow({
      where: { businessId: created.id, businessSourceCodeSnapshot: 'FUND_WITHDRAWAL' },
      include: { entries: true },
    })
    expect(batch).toMatchObject({
      consumerCode: 'FUND_WITHDRAWAL.PAY',
      postingTypeCodeSnapshot: 'USER_WITHDRAWAL',
      businessCategorySnapshot: 'NEUTRAL',
      businessNo: created.withdrawalNo,
      summary: '用户提款',
    })
    expect(batch.businessAmount.toFixed(2)).toBe('150.00')
    expect(batch.entries).toHaveLength(1)
    expect(batch.entries[0]).toMatchObject({
      accountId: applicantAccountId,
      accountTarget: 'USER',
      direction: 'DEBIT',
      amountStrategy: 'FULL_AMOUNT',
    })
    expect(batch.entries[0]?.amount.toFixed(2)).toBe('150.00')
    expect(batch.entries[0]?.balanceAfter.toFixed(2)).toBe('-50.00')

    const account = await prisma.fundAccount.findUniqueOrThrow({
      where: { id: applicantAccountId },
      select: { balance: true },
    })
    expect(account.balance.toFixed(2)).toBe('-50.00')

    const ownList = await queries.listOwn(applicantId, { page: 1, pageSize: 50 })
    expect(ownList.items.find(item => item.id === created.id)).toMatchObject({
      status: 'APPROVED',
      paymentProof: { fileName: proof.fileName },
    })
    const reviewList = await queries.listReview({ page: 1, pageSize: 50 })
    expect(reviewList.items.find(item => item.id === created.id)).toMatchObject({
      status: 'APPROVED',
    })

    const ownAsset = await queries.proofAssetOwn(applicantId, created.id)
    const reviewAsset = await queries.proofAssetReview(created.id)
    expect(ownAsset).toEqual(reviewAsset)
    const content = await documents.content(ownAsset, 'GET')
    expect(content.headers['Content-Type']).toBe('image/png')
    expect(content.headers['Cache-Control']).toBe('private, no-store')

    await expect(withdrawals.approve(commandContext('approve_again'), created.id, {
      expectedVersion: created.version,
      paymentProofMediaAssetId: proof.assetId,
    })).rejects.toMatchObject({ code: 'FUND_WITHDRAWAL_STATE_CHANGED' })
  })
})
