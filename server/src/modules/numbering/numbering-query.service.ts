import {
  HttpStatus,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { validateIssuedRuleConfigCompatibility } from './numbering-config-compatibility'
import {
  type NumberingIssuanceListQueryDto,
  type NumberingRuleListQueryDto,
  type NumberingRuleVersionListQueryDto,
} from './dto/numbering-management.dto'
import type { PreviewNumberingRuleRequestDto } from './dto/numbering-command.dto'
import type {
  NumberingIssuancePageDto,
  NumberingRuleDetailDto,
  NumberingRulePageDto,
  NumberingRuleVersionPageDto,
  PreviewNumberingRuleResponseDto,
} from './dto/numbering-response.dto'
import { NUMBERING_ERROR_CODES } from './numbering.errors'
import { mapNumberingPersistenceError } from './numbering.persistence-error.mapper'
import {
  normalizeNumberingIssuanceQuery,
  normalizeNumberingPagination,
  normalizeNumberingRuleListQuery,
} from './numbering-query.normalizer'
import {
  readDatabaseAsOfInTransaction,
  readNumberingIssuancesPageInTransaction,
  readNumberingPeriodUsageInTransaction,
  readNumberingRuleDetailInTransaction,
  readNumberingRuleHasIssuancesInTransaction,
  readNumberingRuleListPageInTransaction,
  readNumberingRuleVersionsPageInTransaction,
} from './numbering-query.persistence'
import {
  buildNumberingCurrentUsageRequest,
  reconstructStoredNumberingConfig,
  selectNumberingRuleVersions,
  toNumberingConfigResponse,
  toNumberingDetailDto,
  toNumberingIssuanceDto,
  toNumberingListItemDto,
  toNumberingVersionDto,
} from './numbering-query.mapper'
import {
  cryptoNumberingRandomSource,
  type NumberingRandomSource,
} from './random-source'
import { previewNumberingRule } from './rule-engine'
import type { NumberingRuleConfig } from './rule-types'
import { NumberingRuleConfigError } from './rule-types'
import { validateNumberingRuleConfig } from './rule-validation'
import { getNumberingPeriodKey } from './period'

/** 模块编排可覆盖该窄端口；未注册时稳定回退到共享 crypto singleton。 */
export const NUMBERING_RANDOM_SOURCE = Symbol('NUMBERING_RANDOM_SOURCE')

function ruleNotFound(): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    NUMBERING_ERROR_CODES.RULE_NOT_FOUND,
    '编号规则不存在',
  )
}

function configFailure(error?: NumberingRuleConfigError): never {
  const fieldErrors = error === undefined
    ? undefined
    : Object.fromEntries(error.issues.map((issue) => [
        issue.path,
        [issue.message],
      ]))

  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID,
    '编号规则配置无效',
    fieldErrors,
  )
}

function rethrowQueryError(error: unknown): never {
  // 复用结构化持久化映射：事务冲突/timeout 返回可重试 state-changed；未知
  // 驱动错误及 stored-config TypeError 仍安全收口为固定 INTERNAL_ERROR。
  throw mapNumberingPersistenceError(error)
}

@Injectable()
export class NumberingQueryService {
  private readonly randomSource: NumberingRandomSource

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(NUMBERING_RANDOM_SOURCE)
    randomSource?: NumberingRandomSource,
  ) {
    this.randomSource = randomSource ?? cryptoNumberingRandomSource
  }

  private async inRepeatableReadSnapshot<T>(
    reader: (
      transaction: Prisma.TransactionClient,
      asOf: Date,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      // 公开查询自行建立 snapshot；timeout 必须是该事务第一条 SQL。
      await applyTransactionTimeouts(transaction)
      const asOf = await readDatabaseAsOfInTransaction(transaction)
      return reader(transaction, asOf)
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    })
  }

  async list(
    input: Readonly<Partial<NumberingRuleListQueryDto>>,
  ): Promise<NumberingRulePageDto> {
    try {
      const query = normalizeNumberingRuleListQuery(input)

      return await this.inRepeatableReadSnapshot(async (transaction, asOf) => {
        const page = await readNumberingRuleListPageInTransaction(
          transaction,
          query,
        )
        const selected = page.rows.map(selectNumberingRuleVersions)
        const usages = await readNumberingPeriodUsageInTransaction(
          transaction,
          page.rows.map((rule, index) =>
            buildNumberingCurrentUsageRequest(rule, selected[index], asOf),
          ),
        )

        return {
          items: page.rows.map((rule) => toNumberingListItemDto(
            rule,
            usages.get(rule.id),
            asOf,
            this.randomSource,
          )),
          page: query.page,
          pageSize: query.pageSize,
          total: page.total,
          purposeCounts: page.purposeCounts,
        }
      })
    }
    catch (error) {
      return rethrowQueryError(error)
    }
  }

  async getDetail(ruleId: string): Promise<NumberingRuleDetailDto> {
    try {
      return await this.inRepeatableReadSnapshot(
        (transaction, asOf) => this.getDetailInTransaction(
          transaction,
          ruleId,
          asOf,
        ),
      )
    }
    catch (error) {
      return rethrowQueryError(error)
    }
  }

  /**
   * command 可在同一写事务、同一 database asOf 下取得最终响应。这里不会再打开
   * transaction、不会设置 timeout，也不会调用 Date.now()。
   */
  async getDetailInTransaction(
    transaction: Prisma.TransactionClient,
    ruleId: string,
    asOf: Date,
  ): Promise<NumberingRuleDetailDto> {
    try {
      const rule = await readNumberingRuleDetailInTransaction(
        transaction,
        ruleId,
      )
      if (rule === null) {
        return ruleNotFound()
      }

      const versions = selectNumberingRuleVersions(rule)
      const usages = await readNumberingPeriodUsageInTransaction(
        transaction,
        [buildNumberingCurrentUsageRequest(rule, versions, asOf)],
      )
      return toNumberingDetailDto(
        rule,
        usages.get(rule.id),
        asOf,
        this.randomSource,
      )
    }
    catch (error) {
      return rethrowQueryError(error)
    }
  }

  async listVersions(
    ruleId: string,
    input: Readonly<Partial<NumberingRuleVersionListQueryDto>>,
  ): Promise<NumberingRuleVersionPageDto> {
    try {
      const query = normalizeNumberingPagination(input)

      return await this.inRepeatableReadSnapshot(async (transaction) => {
        const page = await readNumberingRuleVersionsPageInTransaction(
          transaction,
          ruleId,
          query,
        )
        if (!page.ruleExists) {
          return ruleNotFound()
        }

        return {
          items: page.rows.map(toNumberingVersionDto),
          page: query.page,
          pageSize: query.pageSize,
          total: page.total,
        }
      })
    }
    catch (error) {
      return rethrowQueryError(error)
    }
  }

  async listIssuances(
    ruleId: string,
    input: Readonly<Partial<NumberingIssuanceListQueryDto>>,
  ): Promise<NumberingIssuancePageDto> {
    try {
      const query = normalizeNumberingIssuanceQuery(input)

      return await this.inRepeatableReadSnapshot(async (transaction) => {
        const page = await readNumberingIssuancesPageInTransaction(
          transaction,
          ruleId,
          query,
        )
        if (!page.ruleExists) {
          return ruleNotFound()
        }

        return {
          items: page.rows.map(toNumberingIssuanceDto),
          page: query.page,
          pageSize: query.pageSize,
          total: page.total,
        }
      })
    }
    catch (error) {
      return rethrowQueryError(error)
    }
  }

  async preview(
    input: Readonly<{
      readonly ruleId?: PreviewNumberingRuleRequestDto['ruleId']
      readonly resetPolicy: unknown
      readonly segments: unknown
    }>,
  ): Promise<PreviewNumberingRuleResponseDto> {
    let config: NumberingRuleConfig
    try {
      config = validateNumberingRuleConfig({
        resetPolicy: input.resetPolicy,
        segments: input.segments,
      })
    }
    catch (error) {
      if (error instanceof NumberingRuleConfigError) {
        return configFailure(error)
      }
      return rethrowQueryError(error)
    }

    try {
      return await this.inRepeatableReadSnapshot(async (transaction, asOf) => {
        let usedCount = '0'

        if (input.ruleId !== undefined) {
          const rule = await readNumberingRuleDetailInTransaction(
            transaction,
            input.ruleId,
          )
          if (rule === null) {
            return ruleNotFound()
          }

          const versions = selectNumberingRuleVersions(rule)
          const hasIssuances = await readNumberingRuleHasIssuancesInTransaction(
            transaction,
            rule.id,
          )
          if (hasIssuances) {
            config = validateIssuedRuleConfigCompatibility(
              reconstructStoredNumberingConfig(versions.statisticsVersion),
              config,
            )
          }

          if (versions.active !== null) {
            const usages = await readNumberingPeriodUsageInTransaction(
              transaction,
              [{
                ruleId: rule.id,
                periodKey: getNumberingPeriodKey(config.resetPolicy, asOf),
              }],
            )
            usedCount = usages.get(rule.id)?.usedCount ?? '0'
          }
        }

        const preview = previewNumberingRule({
          config,
          databaseTime: asOf,
          usedCount,
          randomSource: this.randomSource,
        })

        return {
          normalizedConfig: toNumberingConfigResponse(config),
          periodKey: preview.periodKey,
          capacity: preview.capacity,
          usedCount: preview.usedCount,
          remainingCount: preview.remainingCount,
          nextSequenceValue: preview.nextSequenceValue,
          nextNumberPreview: preview.nextNumberPreview,
          nextNumberDeterministic: preview.nextNumberDeterministic,
          periodStatus: preview.periodStatus,
          samples: [...preview.samples],
          asOf: asOf.toISOString(),
        }
      })
    }
    catch (error) {
      if (error instanceof NumberingRuleConfigError) {
        return configFailure(error)
      }
      return rethrowQueryError(error)
    }
  }
}
