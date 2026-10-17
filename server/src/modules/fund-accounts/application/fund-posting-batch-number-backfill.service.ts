import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { NumberingGenerationError } from '../../numbering/numbering.errors'
import { NumberingGeneratorService } from '../../numbering/numbering-generator.service'
import {
  FUND_POSTING_BATCH_NUMBER_BACKFILL_LOCK,
  FUND_POSTING_BATCH_NUMBER_CONSUMER_CODE,
  FUND_POSTING_BATCH_NUMBER_RENUMBER_SETTING,
  FUND_POSTING_BATCH_NUMBER_RULE_CODE,
} from './fund-posting-batch-number'

export interface FundPostingBatchNumberBackfillOptions {
  readonly apply?: boolean
  readonly limit?: number
}

export interface FundPostingBatchNumberMapping {
  readonly batchId: string
  readonly oldBatchNo: string
  readonly newBatchNo: string
  readonly numberingIssuanceId: string
}

export interface FundPostingBatchNumberBackfillResult {
  readonly mode: 'DRY_RUN' | 'APPLY'
  readonly selected: number
  readonly assigned: number
  readonly skipped: number
  readonly failed: number
  readonly remaining: number
  readonly ruleAvailable: boolean
  readonly errorCode: string | null
  readonly mappings: readonly FundPostingBatchNumberMapping[]
}

interface BackfillCandidate {
  readonly id: string
  readonly batchNo: string
  readonly postedAt: Date
}

class DryRunCompleted extends Error {
  constructor(readonly mappings: readonly FundPostingBatchNumberMapping[]) {
    super('fund posting batch number dry-run completed')
    this.name = 'DryRunCompleted'
  }
}

function backfillFingerprint(batchId: string): string {
  return createHash('sha256')
    .update(`fund-batch-number-backfill:v1:${batchId}`, 'utf8')
    .digest('hex')
}

function safeErrorCode(error: unknown): string {
  if (error instanceof ApiException) return error.code
  if (error instanceof NumberingGenerationError) {
    return 'FUND_POSTING_NUMBERING_UNAVAILABLE'
  }
  return 'FUND_POSTING_NUMBER_BACKFILL_FAILED'
}

/**
 * 历史资金批次换号：编号必须经由编号域生成，不能在 SQL 中重复实现发号逻辑。
 * 默认 dry-run 在事务内完整演练并回滚；--apply 才提交。候选按 posted_at,id 排序，
 * 编号日期取执行当天，旧号到新号映射随结果输出。
 */
@Injectable()
export class FundPostingBatchNumberBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingGeneratorService,
  ) {}

  async run(
    options: FundPostingBatchNumberBackfillOptions,
  ): Promise<FundPostingBatchNumberBackfillResult> {
    const limit = options.limit ?? 1000
    if (
      !Number.isSafeInteger(limit)
      || limit < 1
      || limit > 10_000
    ) {
      throw new ApiException(422, 'VALIDATION_FAILED', '换号参数无效')
    }

    const [rule, remaining, integrity] = await Promise.all([
      this.prisma.numberingRule.findUnique({
        where: { ruleCode: FUND_POSTING_BATCH_NUMBER_RULE_CODE },
        select: {
          status: true,
          purpose: true,
          versions: {
            where: { status: 'ACTIVE' },
            select: { id: true },
            take: 1,
          },
        },
      }),
      this.prisma.fundPostingBatch.count({
        where: { numberingIssuanceId: null },
      }),
      this.prisma.$queryRaw<{ readonly invalid: boolean }[]>(Prisma.sql`
        SELECT EXISTS (
          SELECT 1
          FROM "fund_posting_batches" AS batch
          LEFT JOIN "numbering_issuances" AS issuance
            ON issuance."id" = batch."numbering_issuance_id"
          LEFT JOIN "numbering_rules" AS rule
            ON rule."id" = issuance."rule_id"
          WHERE batch."numbering_issuance_id" IS NOT NULL
            AND (
              issuance."id" IS NULL
              OR issuance."generated_number" <> batch."batch_no"
              OR issuance."consumer_code" <> 'FUND_POSTING'
              OR rule."rule_code" <> 'FUND_POSTING_BATCH_NO'
            )
        ) AS "invalid"
      `),
    ])
    const ruleAvailable = rule?.status === 'ENABLED'
      && rule.purpose === 'BUSINESS'
      && rule.versions.length === 1

    const base = {
      mode: options.apply ? 'APPLY' as const : 'DRY_RUN' as const,
      selected: 0,
      assigned: 0,
      skipped: 0,
      failed: 0,
      remaining,
      ruleAvailable,
      errorCode: null,
      mappings: [] as FundPostingBatchNumberMapping[],
    }
    if (integrity[0]?.invalid !== false) {
      return {
        ...base,
        errorCode: 'FUND_POSTING_NUMBER_CONFLICT',
        failed: 1,
      }
    }
    if (!ruleAvailable) {
      return {
        ...base,
        errorCode: remaining > 0 ? 'FUND_POSTING_NUMBERING_UNAVAILABLE' : null,
        failed: remaining > 0 ? 1 : 0,
      }
    }

    let selected = 0
    try {
      const mappings = await this.prisma.$transaction(
        async (transaction) => {
          await applyTransactionTimeouts(transaction)
          await transaction.$queryRaw(Prisma.sql`
            SELECT set_config(
              ${FUND_POSTING_BATCH_NUMBER_RENUMBER_SETTING},
              'on',
              true
            )
          `)
          if (options.apply) {
            await transaction.$executeRaw(Prisma.sql`
              SELECT pg_advisory_xact_lock(
                hashtextextended(${FUND_POSTING_BATCH_NUMBER_BACKFILL_LOCK}, 0)
              )
            `)
          }
          const candidates = await transaction.$queryRaw<BackfillCandidate[]>(
            Prisma.sql`
              SELECT
                "id",
                "batch_no" AS "batchNo",
                "posted_at" AS "postedAt"
              FROM "fund_posting_batches"
              WHERE "numbering_issuance_id" IS NULL
              ORDER BY "posted_at" ASC, "id" ASC
              LIMIT ${limit}
              FOR UPDATE
            `,
          )
          selected = candidates.length
          const applied: FundPostingBatchNumberMapping[] = []
          for (const candidate of candidates) {
            const numbering = await this.numbering.generateScopedInTransaction(
              transaction,
              {
                ruleCode: FUND_POSTING_BATCH_NUMBER_RULE_CODE,
                consumerCode: FUND_POSTING_BATCH_NUMBER_CONSUMER_CODE,
                idempotencyKey: `fund-batch-backfill:v1:${candidate.id}`,
                requestFingerprint: backfillFingerprint(candidate.id),
              },
            )
            const updated = await transaction.fundPostingBatch.update({
              where: { id: candidate.id },
              data: {
                batchNo: numbering.number,
                numberingIssuanceId: numbering.issuanceId,
              },
              select: { id: true },
            })
            if (updated.id !== candidate.id) {
              throw new ApiException(
                409,
                'FUND_POSTING_NUMBER_CONFLICT',
                '资金批次换号写入结果不一致',
              )
            }
            applied.push(Object.freeze({
              batchId: candidate.id,
              oldBatchNo: candidate.batchNo,
              newBatchNo: numbering.number,
              numberingIssuanceId: numbering.issuanceId,
            }))
          }
          if (!options.apply) {
            throw new DryRunCompleted(Object.freeze(applied))
          }
          return Object.freeze(applied)
        },
        { timeout: 60_000 },
      )
      const remainingAfter = await this.prisma.fundPostingBatch.count({
        where: { numberingIssuanceId: null },
      })
      return {
        ...base,
        selected,
        assigned: mappings.length,
        remaining: remainingAfter,
        mappings,
      }
    }
    catch (error) {
      if (error instanceof DryRunCompleted) {
        return {
          ...base,
          selected,
          assigned: error.mappings.length,
          mappings: error.mappings,
        }
      }
      return {
        ...base,
        selected,
        failed: 1,
        errorCode: safeErrorCode(error),
      }
    }
  }
}
