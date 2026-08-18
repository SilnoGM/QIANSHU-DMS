import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { AuditService } from '../../audit/audit.service'
import {
  FundCalculationError,
  INITIAL_FUND_POSTING_RULES,
  validateFundPostingRule,
  type FundPostingRule,
  type FundPostingRuleLeg,
} from '../domain'
import { normalizeFundAccountCommandContext } from './fund-account.normalizer'
import {
  lockFundBusinessSourceConfiguration,
  lockFundPostingTypeConfiguration,
  readDraftRuleVersion,
  readFundBusinessSourceView,
  readFundPostingTypeView,
  readRuleVersionForPublish,
  type FundBusinessSourceConfigurationLockRow,
  type FundEditableRuleVersionRow,
  type FundPostingTypeConfigurationLockRow,
} from './fund-configuration-command.persistence'
import type {
  FundBusinessSourceCreateInput,
  FundBusinessSourceEnabledUpdateInput,
  FundBusinessSourceMutationResult,
  FundBusinessSourceUpdateInput,
  FundBusinessSourceView,
  FundConfigurationCommandContext,
  FundDraftRuleReplaceInput,
  FundPostingRulePublishInput,
  FundPostingTypeCreateInput,
  FundPostingTypeEnabledUpdateInput,
  FundPostingTypeMutationResult,
  FundPostingTypeUpdateInput,
  FundPostingTypeView,
} from './fund-configuration.contract'
import {
  mapFundBusinessSourceView,
  mapFundPostingTypeView,
  type FundBusinessSourceViewRow,
  type FundPostingTypeViewRow,
} from './fund-configuration.mapper'
import {
  normalizeFundBusinessSourceCreate,
  normalizeFundBusinessSourceEnabledUpdate,
  normalizeFundBusinessSourceUpdate,
  normalizeFundDraftRuleReplace,
  normalizeFundPostingRulePublish,
  normalizeFundPostingTypeCreate,
  normalizeFundPostingTypeEnabledUpdate,
  normalizeFundPostingTypeUpdate,
} from './fund-configuration.normalizer'
import { mapFundPersistenceError } from './fund-persistence-error.mapper'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
  type FundPostingErrorCode,
  type FundPostingErrorField,
} from './fund-posting.errors'

const ADMIN_ADJUSTMENT_RULE = INITIAL_FUND_POSTING_RULES.find(
  rule => rule.postingTypeCode === 'ADMIN_MANUAL_ADJUSTMENT',
)

function configurationError(code: FundPostingErrorCode): FundPostingError {
  return new FundPostingError(code)
}

function validationError(field: FundPostingErrorField): FundPostingError {
  return new FundPostingError(FUND_POSTING_ERROR_CODES.VALIDATION_FAILED, field)
}

function requirePostingTypeView(
  row: FundPostingTypeViewRow | null,
): FundPostingTypeView {
  if (row === null) {
    throw configurationError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }
  return mapFundPostingTypeView(row)
}

function requireBusinessSourceView(
  row: FundBusinessSourceViewRow | null,
): FundBusinessSourceView {
  if (row === null) {
    throw configurationError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }
  return mapFundBusinessSourceView(row)
}

function requirePostingTypeVersion(
  row: FundPostingTypeConfigurationLockRow | null,
  expectedVersion: number,
): FundPostingTypeConfigurationLockRow {
  if (row === null) {
    throw configurationError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_FOUND)
  }
  if (row.version !== expectedVersion) {
    throw configurationError(FUND_POSTING_ERROR_CODES.CONFIG_STATE_CHANGED)
  }
  return row
}

function requireBusinessSourceVersion(
  row: FundBusinessSourceConfigurationLockRow | null,
  expectedVersion: number,
): FundBusinessSourceConfigurationLockRow {
  if (row === null) {
    throw configurationError(FUND_POSTING_ERROR_CODES.BUSINESS_SOURCE_NOT_FOUND)
  }
  if (row.version !== expectedVersion) {
    throw configurationError(FUND_POSTING_ERROR_CODES.CONFIG_STATE_CHANGED)
  }
  return row
}

function comparableLeg(leg: FundPostingRuleLeg): string {
  return [
    leg.position,
    leg.accountTarget,
    leg.directionPolicy,
    leg.amountStrategy,
    leg.adjustmentMode ?? '',
  ].join('|')
}

function sameRuleLegs(
  left: readonly FundPostingRuleLeg[],
  right: readonly FundPostingRuleLeg[],
): boolean {
  return left.length === right.length
    && left.every((leg, index) => comparableLeg(leg) === comparableLeg(right[index]))
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every(value => rightSet.has(value))
}

/**
 * 规则发布和 DRAFT 替换共用纯校验器。管理员保留类型在通用守恒校验之外，
 * 还必须与初始化真相源逐 leg 一致，不能扩展出第三种模板或任意账户集合。
 */
function validateRuleForType(
  postingType: Pick<
    FundPostingTypeConfigurationLockRow,
    | 'code'
    | 'businessCategory'
    | 'requiresUser'
    | 'amountSignPolicy'
    | 'inputMode'
  >,
  legs: readonly FundPostingRuleLeg[],
): FundPostingRule {
  try {
    const validated = validateFundPostingRule({
      postingTypeCode: postingType.code,
      businessCategory: postingType.businessCategory,
      requiresUser: postingType.requiresUser,
      amountSignPolicy: postingType.amountSignPolicy,
      inputMode: postingType.inputMode,
      legs,
    })
    if (
      postingType.inputMode === 'ADMIN_ADJUSTMENT'
      && (
        ADMIN_ADJUSTMENT_RULE === undefined
        || postingType.code !== ADMIN_ADJUSTMENT_RULE.postingTypeCode
        || !sameRuleLegs(validated.legs, ADMIN_ADJUSTMENT_RULE.legs)
      )
    ) {
      throw configurationError(FUND_POSTING_ERROR_CODES.POSTING_RULE_INVALID)
    }
    return validated
  }
  catch (error) {
    if (error instanceof FundPostingError) throw error
    if (error instanceof FundCalculationError) {
      throw new FundPostingError(error.code)
    }
    throw error
  }
}

function editableLegs(
  rule: FundEditableRuleVersionRow,
): readonly FundPostingRuleLeg[] {
  return rule.legs.map(leg => ({
    position: leg.position,
    accountTarget: leg.accountTarget,
    directionPolicy: leg.directionPolicy,
    amountStrategy: leg.amountStrategy,
    ...(leg.adjustmentMode === null
      ? {}
      : { adjustmentMode: leg.adjustmentMode }),
  }))
}

/**
 * 类型、版本和来源配置全部通过本服务持有事务边界。每个事务第一条 SQL 设置
 * 超时；资源写入与 Audit 共用 transaction，任何一方失败都会整体回滚。
 */
@Injectable()
export class FundConfigurationCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createPostingType(
    rawContext: FundConfigurationCommandContext,
    rawInput: FundPostingTypeCreateInput,
  ): Promise<FundPostingTypeView> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const input = normalizeFundPostingTypeCreate(rawInput)
    validateRuleForType(input, input.legs)

    return this.runMutation(async (transaction) => {
      const created = await transaction.fundPostingType.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description,
          businessCategory: input.businessCategory,
          requiresUser: input.requiresUser,
          amountSignPolicy: input.amountSignPolicy,
          inputMode: input.inputMode,
          enabled: input.enabled,
          version: 1,
          ruleVersions: {
            create: {
              revision: 1,
              status: 'DRAFT',
              createdByUserId: context.actorUserId,
              legs: { createMany: { data: [...input.legs] } },
            },
          },
        },
        select: { id: true },
      })
      const postingType = requirePostingTypeView(
        await readFundPostingTypeView(transaction, created.id),
      )
      await this.audit.record(transaction, {
        eventType: AuditEventType.FUND_POSTING_TYPE_CREATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'FundPostingType',
        targetId: postingType.id,
        requestId: context.requestId,
        correlationId: context.correlationId,
        metadata: {
          code: input.code,
          draftRevision: 1,
          enabled: false,
        },
      })
      return postingType
    })
  }

  async updatePostingType(
    rawContext: FundConfigurationCommandContext,
    rawInput: FundPostingTypeUpdateInput,
  ): Promise<FundPostingTypeMutationResult> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const input = normalizeFundPostingTypeUpdate(rawInput)

    return this.runMutation(async (transaction) => {
      const current = requirePostingTypeVersion(
        await lockFundPostingTypeConfiguration(transaction, input.postingTypeId),
        input.expectedVersion,
      )
      if (
        current.name === input.name
        && current.description === input.description
      ) {
        return Object.freeze({
          changed: false,
          postingType: requirePostingTypeView(
            await readFundPostingTypeView(transaction, current.id),
          ),
        })
      }

      await this.updatePostingTypeVersion(transaction, current.id, input.expectedVersion, {
        name: input.name,
        description: input.description,
      })
      const postingType = requirePostingTypeView(
        await readFundPostingTypeView(transaction, current.id),
      )
      await this.audit.record(transaction, {
        eventType: AuditEventType.FUND_POSTING_TYPE_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'FundPostingType',
        targetId: current.id,
        requestId: context.requestId,
        correlationId: context.correlationId,
        metadata: {
          code: current.code,
          description: input.description,
          name: input.name,
        },
      })
      return Object.freeze({ changed: true, postingType })
    })
  }

  async replaceDraftRule(
    rawContext: FundConfigurationCommandContext,
    rawInput: FundDraftRuleReplaceInput,
  ): Promise<FundPostingTypeMutationResult> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const input = normalizeFundDraftRuleReplace(rawInput)

    return this.runMutation(async (transaction) => {
      const current = requirePostingTypeVersion(
        await lockFundPostingTypeConfiguration(transaction, input.postingTypeId),
        input.expectedVersion,
      )
      validateRuleForType(current, input.legs)
      const draft = await readDraftRuleVersion(transaction, current.id)
      if (draft !== null && sameRuleLegs(editableLegs(draft), input.legs)) {
        return Object.freeze({
          changed: false,
          postingType: requirePostingTypeView(
            await readFundPostingTypeView(transaction, current.id),
          ),
        })
      }

      let ruleVersionId: string
      let revision: number
      if (draft === null) {
        const latest = await transaction.fundPostingRuleVersion.findFirst({
          where: { postingTypeId: current.id },
          select: { revision: true },
          orderBy: [{ revision: 'desc' }, { id: 'desc' }],
        })
        revision = (latest?.revision ?? 0) + 1
        const created = await transaction.fundPostingRuleVersion.create({
          data: {
            postingTypeId: current.id,
            revision,
            status: 'DRAFT',
            createdByUserId: context.actorUserId,
            legs: { createMany: { data: [...input.legs] } },
          },
          select: { id: true },
        })
        ruleVersionId = created.id
      }
      else {
        ruleVersionId = draft.id
        revision = draft.revision
        // 资源没有 DELETE API；这里只在父版本仍为 DRAFT 时原子替换其受控 legs。
        await transaction.fundPostingRuleLeg.deleteMany({
          where: { ruleVersionId: draft.id },
        })
        await transaction.fundPostingRuleLeg.createMany({
          data: input.legs.map(leg => ({ ruleVersionId: draft.id, ...leg })),
        })
      }

      await this.updatePostingTypeVersion(
        transaction,
        current.id,
        input.expectedVersion,
        {},
      )
      const postingType = requirePostingTypeView(
        await readFundPostingTypeView(transaction, current.id),
      )
      await this.audit.record(transaction, {
        eventType: AuditEventType.FUND_POSTING_TYPE_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'FundPostingRuleVersion',
        targetId: ruleVersionId,
        requestId: context.requestId,
        correlationId: context.correlationId,
        metadata: {
          action: 'DRAFT_RULE_REPLACED',
          postingTypeCode: current.code,
          postingTypeId: current.id,
          revision,
        },
      })
      return Object.freeze({ changed: true, postingType })
    })
  }

  async publishDraftRule(
    rawContext: FundConfigurationCommandContext,
    rawInput: FundPostingRulePublishInput,
  ): Promise<FundPostingTypeMutationResult> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const input = normalizeFundPostingRulePublish(rawInput)

    return this.runMutation(async (transaction) => {
      const current = requirePostingTypeVersion(
        await lockFundPostingTypeConfiguration(transaction, input.postingTypeId),
        input.expectedVersion,
      )
      const draft = await readRuleVersionForPublish(
        transaction,
        input.draftRuleVersionId,
      )
      if (
        draft === null
        || draft.postingTypeId !== current.id
        || draft.status !== 'DRAFT'
      ) {
        throw configurationError(FUND_POSTING_ERROR_CODES.POSTING_RULE_UNAVAILABLE)
      }
      validateRuleForType(current, editableLegs(draft))

      // Partial unique index 要求先退役旧 ACTIVE，再激活 DRAFT，最后移动当前指针。
      await transaction.fundPostingRuleVersion.updateMany({
        where: { postingTypeId: current.id, status: 'ACTIVE' },
        data: { status: 'RETIRED' },
      })
      await transaction.fundPostingRuleVersion.update({
        where: { id: draft.id },
        data: {
          status: 'ACTIVE',
          publishedByUserId: context.actorUserId,
          publishedAt: new Date(),
        },
        select: { id: true },
      })
      await this.updatePostingTypeVersion(
        transaction,
        current.id,
        input.expectedVersion,
        { currentRuleVersionId: draft.id },
      )
      const postingType = requirePostingTypeView(
        await readFundPostingTypeView(transaction, current.id),
      )
      await this.audit.record(transaction, {
        eventType: AuditEventType.FUND_POSTING_RULE_PUBLISHED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'FundPostingRuleVersion',
        targetId: draft.id,
        requestId: context.requestId,
        correlationId: context.correlationId,
        metadata: {
          postingTypeCode: current.code,
          postingTypeId: current.id,
          revision: draft.revision,
        },
      })
      return Object.freeze({ changed: true, postingType })
    })
  }

  async setPostingTypeEnabled(
    rawContext: FundConfigurationCommandContext,
    rawInput: FundPostingTypeEnabledUpdateInput,
  ): Promise<FundPostingTypeMutationResult> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const input = normalizeFundPostingTypeEnabledUpdate(rawInput)

    return this.runMutation(async (transaction) => {
      const current = requirePostingTypeVersion(
        await lockFundPostingTypeConfiguration(transaction, input.postingTypeId),
        input.expectedVersion,
      )
      if (current.enabled === input.enabled) {
        return Object.freeze({
          changed: false,
          postingType: requirePostingTypeView(
            await readFundPostingTypeView(transaction, current.id),
          ),
        })
      }
      if (input.enabled && current.currentRuleVersionId === null) {
        throw configurationError(FUND_POSTING_ERROR_CODES.POSTING_RULE_UNAVAILABLE)
      }

      await this.updatePostingTypeVersion(
        transaction,
        current.id,
        input.expectedVersion,
        { enabled: input.enabled },
      )
      const postingType = requirePostingTypeView(
        await readFundPostingTypeView(transaction, current.id),
      )
      await this.audit.record(transaction, {
        eventType: input.enabled
          ? AuditEventType.FUND_POSTING_TYPE_ENABLED
          : AuditEventType.FUND_POSTING_TYPE_DISABLED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'FundPostingType',
        targetId: current.id,
        requestId: context.requestId,
        correlationId: context.correlationId,
        metadata: { code: current.code, enabled: input.enabled },
      })
      return Object.freeze({ changed: true, postingType })
    })
  }

  async createBusinessSource(
    rawContext: FundConfigurationCommandContext,
    rawInput: FundBusinessSourceCreateInput,
  ): Promise<FundBusinessSourceView> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const input = normalizeFundBusinessSourceCreate(rawInput)

    return this.runMutation(async (transaction) => {
      await this.requirePostingTypeIds(transaction, input.allowedPostingTypeIds)
      const created = await transaction.fundBusinessSource.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description,
          enabled: input.enabled,
          version: 1,
          ...(input.allowedPostingTypeIds.length === 0
            ? {}
            : {
                allowedPostingTypes: {
                  createMany: {
                    data: input.allowedPostingTypeIds.map(postingTypeId => ({
                      postingTypeId,
                    })),
                  },
                },
              }),
        },
        select: { id: true },
      })
      const businessSource = requireBusinessSourceView(
        await readFundBusinessSourceView(transaction, created.id),
      )
      await this.audit.record(transaction, {
        eventType: AuditEventType.FUND_BUSINESS_SOURCE_CREATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'FundBusinessSource',
        targetId: created.id,
        requestId: context.requestId,
        correlationId: context.correlationId,
        metadata: {
          allowedPostingTypeIdsCsv: input.allowedPostingTypeIds.join(','),
          code: input.code,
          enabled: input.enabled,
        },
      })
      return businessSource
    })
  }

  async updateBusinessSource(
    rawContext: FundConfigurationCommandContext,
    rawInput: FundBusinessSourceUpdateInput,
  ): Promise<FundBusinessSourceMutationResult> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const input = normalizeFundBusinessSourceUpdate(rawInput)

    return this.runMutation(async (transaction) => {
      const current = requireBusinessSourceVersion(
        await lockFundBusinessSourceConfiguration(
          transaction,
          input.businessSourceId,
        ),
        input.expectedVersion,
      )
      if (current.enabled && input.allowedPostingTypeIds.length === 0) {
        throw validationError('allowedPostingTypeIds')
      }
      await this.requirePostingTypeIds(transaction, input.allowedPostingTypeIds)
      const currentRelations = await transaction
        .fundBusinessSourcePostingType.findMany({
          where: { businessSourceId: current.id },
          select: { postingTypeId: true },
          orderBy: { postingTypeId: 'asc' },
        })
      const currentTypeIds = currentRelations.map(item => item.postingTypeId)
      const profileChanged = current.name !== input.name
        || current.description !== input.description
      if (
        !profileChanged
        && sameStringSet(currentTypeIds, input.allowedPostingTypeIds)
      ) {
        return Object.freeze({
          changed: false,
          businessSource: requireBusinessSourceView(
            await readFundBusinessSourceView(transaction, current.id),
          ),
        })
      }

      const desiredIds = new Set(input.allowedPostingTypeIds)
      const currentIds = new Set(currentTypeIds)
      const removedIds = currentTypeIds.filter(id => !desiredIds.has(id))
      const addedIds = input.allowedPostingTypeIds.filter(id => !currentIds.has(id))
      if (removedIds.length > 0) {
        await transaction.fundBusinessSourcePostingType.deleteMany({
          where: {
            businessSourceId: current.id,
            postingTypeId: { in: removedIds },
          },
        })
      }
      if (addedIds.length > 0) {
        await transaction.fundBusinessSourcePostingType.createMany({
          data: addedIds.map(postingTypeId => ({
            businessSourceId: current.id,
            postingTypeId,
          })),
        })
      }
      const updated = await transaction.fundBusinessSource.updateMany({
        where: { id: current.id, version: input.expectedVersion },
        data: {
          name: input.name,
          description: input.description,
          version: { increment: 1 },
        },
      })
      if (updated.count !== 1) {
        throw configurationError(FUND_POSTING_ERROR_CODES.CONFIG_STATE_CHANGED)
      }
      const businessSource = requireBusinessSourceView(
        await readFundBusinessSourceView(transaction, current.id),
      )
      await this.audit.record(transaction, {
        eventType: AuditEventType.FUND_BUSINESS_SOURCE_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'FundBusinessSource',
        targetId: current.id,
        requestId: context.requestId,
        correlationId: context.correlationId,
        metadata: {
          addedPostingTypeIdsCsv: addedIds.join(','),
          code: current.code,
          removedPostingTypeIdsCsv: removedIds.join(','),
        },
      })
      return Object.freeze({ changed: true, businessSource })
    })
  }

  async setBusinessSourceEnabled(
    rawContext: FundConfigurationCommandContext,
    rawInput: FundBusinessSourceEnabledUpdateInput,
  ): Promise<FundBusinessSourceMutationResult> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const input = normalizeFundBusinessSourceEnabledUpdate(rawInput)

    return this.runMutation(async (transaction) => {
      const current = requireBusinessSourceVersion(
        await lockFundBusinessSourceConfiguration(
          transaction,
          input.businessSourceId,
        ),
        input.expectedVersion,
      )
      if (current.enabled === input.enabled) {
        return Object.freeze({
          changed: false,
          businessSource: requireBusinessSourceView(
            await readFundBusinessSourceView(transaction, current.id),
          ),
        })
      }
      if (input.enabled) {
        const allowedCount = await transaction
          .fundBusinessSourcePostingType.count({
            where: { businessSourceId: current.id },
          })
        if (allowedCount < 1) throw validationError('allowedPostingTypeIds')
      }

      const updated = await transaction.fundBusinessSource.updateMany({
        where: { id: current.id, version: input.expectedVersion },
        data: { enabled: input.enabled, version: { increment: 1 } },
      })
      if (updated.count !== 1) {
        throw configurationError(FUND_POSTING_ERROR_CODES.CONFIG_STATE_CHANGED)
      }
      const businessSource = requireBusinessSourceView(
        await readFundBusinessSourceView(transaction, current.id),
      )
      await this.audit.record(transaction, {
        eventType: input.enabled
          ? AuditEventType.FUND_BUSINESS_SOURCE_ENABLED
          : AuditEventType.FUND_BUSINESS_SOURCE_DISABLED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'FundBusinessSource',
        targetId: current.id,
        requestId: context.requestId,
        correlationId: context.correlationId,
        metadata: { code: current.code, enabled: input.enabled },
      })
      return Object.freeze({ changed: true, businessSource })
    })
  }

  private async requirePostingTypeIds(
    transaction: Prisma.TransactionClient,
    postingTypeIds: readonly string[],
  ): Promise<void> {
    if (postingTypeIds.length === 0) return
    const rows = await transaction.fundPostingType.findMany({
      where: { id: { in: [...postingTypeIds] } },
      select: { id: true },
    })
    if (!sameStringSet(rows.map(row => row.id), postingTypeIds)) {
      throw configurationError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_FOUND)
    }
  }

  private async updatePostingTypeVersion(
    transaction: Prisma.TransactionClient,
    postingTypeId: string,
    expectedVersion: number,
    data: Omit<
      Prisma.FundPostingTypeUncheckedUpdateManyInput,
      'id' | 'version'
    >,
  ): Promise<void> {
    const updated = await transaction.fundPostingType.updateMany({
      where: { id: postingTypeId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    })
    if (updated.count !== 1) {
      throw configurationError(FUND_POSTING_ERROR_CODES.CONFIG_STATE_CHANGED)
    }
  }

  private async runMutation<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        return operation(transaction)
      })
    }
    catch (error) {
      throw mapFundPersistenceError(error)
    }
  }
}
