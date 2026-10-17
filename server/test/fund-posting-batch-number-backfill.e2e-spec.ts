import { randomBytes, randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../src/app.module'
import { Prisma } from '../src/generated/prisma/client'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { FundPostingBatchNumberBackfillService } from '../src/modules/fund-accounts/application/fund-posting-batch-number-backfill.service'

jest.setTimeout(60_000)

describe('fund posting batch number backfill', () => {
  let application: INestApplication
  let prisma: PrismaService
  let service: FundPostingBatchNumberBackfillService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    application = moduleRef.createNestApplication()
    await application.init()
    prisma = application.get(PrismaService)
    service = application.get(FundPostingBatchNumberBackfillService)
  })

  afterAll(async () => {
    await application?.close()
  })

  it('renumbers a legacy batch in dry-run and apply mode, then becomes idempotent', async () => {
    const batchId = randomUUID()
    const legacyBatchNo = `FUND_LEGACY_${batchId.replaceAll('-', '').toUpperCase()}`
    const requestId = `fund_backfill_${batchId.slice(0, 8)}`
    const user = await prisma.user.create({
      data: {
        username: `fund-backfill-${batchId.slice(0, 8)}`,
        usernameNormalized: `fund-backfill-${batchId.slice(0, 8)}`,
        displayName: '资金换号 E2E',
        passwordHash: 'hash',
        passwordChangedAt: new Date(),
      },
      select: { id: true },
    })

    await prisma.$executeRawUnsafe(
      'ALTER TABLE "fund_posting_batches" DISABLE TRIGGER "fund_posting_batches_number_identity_trigger"',
    )
    try {
      const inserted = await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "fund_posting_batches" (
          "id", "batch_no", "kind", "posting_type_id",
          "posting_type_code_snapshot", "posting_type_name_snapshot",
          "business_category_snapshot", "business_source_id",
          "business_source_code_snapshot", "business_source_name_snapshot",
          "rule_version_id", "rule_revision_snapshot", "user_id",
          "business_amount", "user_share_rate_snapshot",
          "company_share_rate_snapshot", "business_id", "summary",
          "business_occurred_at", "consumer_code", "idempotency_key_hash",
          "request_fingerprint_hash", "adjustment_mode", "actor_user_id",
          "request_id", "posted_at"
        )
        SELECT
          ${batchId}::uuid, ${legacyBatchNo}, 'MANUAL_ADJUSTMENT', type."id",
          type."code", type."name", 'ADJUSTMENT', source."id",
          source."code", source."name", rule."id", rule."revision",
          ${user.id}::uuid, 100, 30, 70, ${batchId},
          '历史批次换号 E2E', clock_timestamp(), 'ADMIN_MANUAL_ADJUSTMENT',
          ${Uint8Array.from(randomBytes(32))},
          ${Uint8Array.from(randomBytes(32))},
          'USER_AND_COMPANY_BY_SHARE', ${user.id}::uuid, ${requestId},
          clock_timestamp()
        FROM "fund_posting_types" AS type
        JOIN "fund_posting_rule_versions" AS rule
          ON rule."id" = type."current_rule_version_id"
        CROSS JOIN "fund_business_sources" AS source
        WHERE type."code" = 'ADMIN_MANUAL_ADJUSTMENT'
          AND source."code" = 'ADMIN_CONSOLE'
      `)
      expect(inserted).toBe(1)
    }
    finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "fund_posting_batches" ENABLE TRIGGER "fund_posting_batches_number_identity_trigger"',
      )
    }

    const dryRun = await service.run({ apply: false })
    const dryMapping = dryRun.mappings.find(item => item.batchId === batchId)
    expect(dryMapping).toMatchObject({ oldBatchNo: legacyBatchNo })
    expect(dryMapping?.newBatchNo).toMatch(/^FUND\/\d{8}-\d{5}$/u)
    await expect(prisma.fundPostingBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { batchNo: true, numberingIssuanceId: true },
    })).resolves.toEqual({
      batchNo: legacyBatchNo,
      numberingIssuanceId: null,
    })

    const applied = await service.run({ apply: true })
    const mapping = applied.mappings.find(item => item.batchId === batchId)
    expect(mapping).toMatchObject({ oldBatchNo: legacyBatchNo })
    expect(applied.assigned).toBeGreaterThanOrEqual(1)
    expect(applied.remaining).toBe(0)

    const stored = await prisma.fundPostingBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { batchNo: true, numberingIssuanceId: true },
    })
    expect(stored.batchNo).toBe(mapping?.newBatchNo)
    expect(stored.numberingIssuanceId).not.toBeNull()
    await expect(prisma.numberingIssuance.findUniqueOrThrow({
      where: { id: stored.numberingIssuanceId! },
      select: { generatedNumber: true, consumerCode: true },
    })).resolves.toEqual({
      generatedNumber: stored.batchNo,
      consumerCode: 'FUND_POSTING',
    })

    const repeat = await service.run({ apply: true })
    expect(repeat.mappings.find(item => item.batchId === batchId)).toBeUndefined()
    expect(repeat.remaining).toBe(0)
  })
})
