import { HttpStatus, Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  NumberingRuleStatus,
  NumberingRuleVersionStatus,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  calculateRuleCapacity,
  parseNonNegativeDecimal,
} from './capacity'
import type {
  ChangeNumberingRuleStatusRequestDto,
  CloneNumberingRuleRequestDto,
  CreateNumberingRuleRequestDto,
  PublishNumberingRuleRequestDto,
  UpdateNumberingRuleRequestDto,
} from './dto/numbering-command.dto'
import type { NumberingRuleDetailDto } from './dto/numbering-response.dto'
import {
  createNumberingDraftVersion,
  createNumberingRuleRecord,
  hasNumberingIssuance,
  readNumberingLifetimeUsedCount,
  readNumberingRuleForClone,
  readNumberingRuleForUpdate,
  readNumberingRuleVersionSnapshots,
  readNumberingTransactionTimestamp,
  replaceNumberingDraftVersion,
  transitionNumberingRuleVersionStatus,
  updateNumberingRuleRecord,
  type NumberingRuleVersionSnapshot,
  type UpdateNumberingRuleRecordInput,
} from './numbering-command.persistence'
import { validateIssuedRuleConfigCompatibility } from './numbering-config-compatibility'
import {
  prepareNumberingRuleConfig,
  type PreparedNumberingRuleConfig,
} from './numbering-config-fingerprint'
import { NumberingQueryService } from './numbering-query.service'
import { NUMBERING_ERROR_CODES } from './numbering.errors'
import {
  calculateMaxOutputLength,
  type NumberingRuleConfig,
  NumberingRuleConfigError,
  type NumberingRuleSegment,
} from './rule-engine'
import {
  normalizeNumberingRuleCode,
  normalizeNumberingRuleDescription,
  normalizeNumberingRuleName,
  normalizeOptionalNumberingRuleDescription,
} from './numbering.normalizer'
import { mapNumberingPersistenceError } from './numbering.persistence-error.mapper'

export interface NumberingCommandContext {
  readonly actorUserId: string
  readonly requestId: string
}

function numberingException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function prepareConfig(input: unknown): PreparedNumberingRuleConfig {
  try {
    return prepareNumberingRuleConfig(input)
  } catch (error) {
    if (error instanceof NumberingRuleConfigError) {
      throw numberingException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID,
        '编号规则配置无效',
      )
    }
    throw error
  }
}

function configSummary(config: NumberingRuleConfig) {
  return {
    resetPolicy: config.resetPolicy,
    segmentTypes: config.segments.map(segment => segment.type).join(','),
    maxOutputLength: calculateMaxOutputLength(config),
  }
}

function sameSegments(
  left: readonly NumberingRuleSegment[],
  right: readonly NumberingRuleSegment[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function findVersion(
  versions: readonly NumberingRuleVersionSnapshot[],
  status: typeof NumberingRuleVersionStatus.ACTIVE
    | typeof NumberingRuleVersionStatus.DRAFT,
): NumberingRuleVersionSnapshot | undefined {
  return versions.find(version => version.status === status)
}

@Injectable()
export class NumberingCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly query: NumberingQueryService,
  ) {}

  async create(
    context: NumberingCommandContext,
    input: CreateNumberingRuleRequestDto,
  ): Promise<NumberingRuleDetailDto> {
    const ruleCode = normalizeNumberingRuleCode(input.ruleCode)
    const name = normalizeNumberingRuleName(input.name)
    const description = normalizeNumberingRuleDescription(input.description)
    const prepared = prepareConfig({
      resetPolicy: input.resetPolicy,
      segments: input.segments,
    })
    const changedFields = [
      ...(Object.hasOwn(input, 'description') ? ['description'] : []),
      'name',
      'resetPolicy',
      'ruleCode',
      'segments',
    ].sort().join(',')

    return this.runMutation(async (transaction, asOf) => {
      const created = await createNumberingRuleRecord(transaction, {
        ruleCode,
        name,
        description,
      })
      await createNumberingDraftVersion(transaction, {
        ruleId: created.id,
        revision: 1,
        ...prepared,
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.NUMBERING_RULE_CREATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId.toLowerCase(),
        targetType: 'NumberingRule',
        targetId: created.id,
        requestId: context.requestId,
        metadata: {
          ruleCode,
          changedFields,
          revision: 1,
          version: 1,
          ...configSummary(prepared.config),
        },
      })
      return this.query.getDetailInTransaction(transaction, created.id, asOf)
    })
  }

  async update(
    context: NumberingCommandContext,
    ruleId: string,
    input: UpdateNumberingRuleRequestDto,
  ): Promise<NumberingRuleDetailDto> {
    const normalizedRuleId = ruleId.toLowerCase()
    const updatesName = Object.hasOwn(input, 'name') && input.name !== undefined
    const updatesDescription = Object.hasOwn(input, 'description')
      && input.description !== undefined
    const updatesResetPolicy = Object.hasOwn(input, 'resetPolicy')
      && input.resetPolicy !== undefined
    const updatesSegments = Object.hasOwn(input, 'segments')
      && input.segments !== undefined

    if (
      !updatesName
      && !updatesDescription
      && !updatesResetPolicy
      && !updatesSegments
    ) {
      throw numberingException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '请求参数校验失败',
      )
    }

    const name = updatesName ? normalizeNumberingRuleName(input.name) : undefined
    const description = updatesDescription
      ? normalizeOptionalNumberingRuleDescription(input.description)
      : undefined

    return this.runMutation(async (transaction, asOf) => {
      const current = await readNumberingRuleForUpdate(
        transaction,
        normalizedRuleId,
      )
      if (current === null) {
        throw numberingException(
          HttpStatus.NOT_FOUND,
          NUMBERING_ERROR_CODES.RULE_NOT_FOUND,
          '编号规则不存在',
        )
      }
      if (current.version !== input.expectedVersion) {
        throw numberingException(
          HttpStatus.CONFLICT,
          NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
          '编号规则状态已变化，请刷新后重试',
        )
      }

      const ruleUpdates: UpdateNumberingRuleRecordInput = {}
      const changedFields: string[] = []
      if (name !== undefined && name !== current.name) {
        ruleUpdates.name = name
        changedFields.push('name')
      }
      if (updatesDescription && description !== current.description) {
        ruleUpdates.description = description
        changedFields.push('description')
      }

      let prepared: PreparedNumberingRuleConfig | undefined
      let targetRevision: number | undefined
      if (updatesResetPolicy || updatesSegments) {
        const versions = await readNumberingRuleVersionSnapshots(
          transaction,
          normalizedRuleId,
        )
        const draft = findVersion(versions, NumberingRuleVersionStatus.DRAFT)
        const active = findVersion(versions, NumberingRuleVersionStatus.ACTIVE)
        const base = draft ?? active
        if (base === undefined) {
          throw numberingException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID,
            '编号规则配置无效',
          )
        }
        prepared = prepareConfig({
          resetPolicy: updatesResetPolicy
            ? input.resetPolicy
            : base.config.resetPolicy,
          segments: updatesSegments ? input.segments : base.config.segments,
        })

        if (prepared.configFingerprint !== base.configFingerprint) {
          if (
            active !== undefined
            && await hasNumberingIssuance(transaction, normalizedRuleId)
          ) {
            try {
              validateIssuedRuleConfigCompatibility(
                active.config,
                prepared.config,
              )
            } catch (error) {
              if (error instanceof NumberingRuleConfigError) {
                throw numberingException(
                  HttpStatus.UNPROCESSABLE_ENTITY,
                  NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID,
                  '首次发号后只能扩大序列位数',
                )
              }
              throw error
            }
          }
          if (prepared.config.resetPolicy !== base.config.resetPolicy) {
            changedFields.push('resetPolicy')
          }
          if (!sameSegments(prepared.config.segments, base.config.segments)) {
            changedFields.push('segments')
          }

          if (draft !== undefined) {
            targetRevision = draft.revision
            await replaceNumberingDraftVersion(transaction, {
              versionId: draft.id,
              ...prepared,
            })
          } else {
            targetRevision = active!.revision + 1
            await createNumberingDraftVersion(transaction, {
              ruleId: normalizedRuleId,
              revision: targetRevision,
              ...prepared,
            })
          }
        }
      }

      if (changedFields.length === 0) {
        return this.query.getDetailInTransaction(
          transaction,
          normalizedRuleId,
          asOf,
        )
      }

      await updateNumberingRuleRecord(
        transaction,
        normalizedRuleId,
        ruleUpdates,
      )
      changedFields.sort()
      await this.audit.record(transaction, {
        eventType: AuditEventType.NUMBERING_RULE_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId.toLowerCase(),
        targetType: 'NumberingRule',
        targetId: normalizedRuleId,
        requestId: context.requestId,
        metadata: {
          ruleCode: current.ruleCode,
          changedFields: changedFields.join(','),
          previousVersion: current.version,
          version: current.version + 1,
          ...(targetRevision === undefined ? {} : { revision: targetRevision }),
          ...(prepared === undefined ? {} : configSummary(prepared.config)),
        },
      })
      return this.query.getDetailInTransaction(
        transaction,
        normalizedRuleId,
        asOf,
      )
    })
  }

  async publish(
    context: NumberingCommandContext,
    ruleId: string,
    input: PublishNumberingRuleRequestDto,
  ): Promise<NumberingRuleDetailDto> {
    const normalizedRuleId = ruleId.toLowerCase()

    return this.runMutation(async (transaction, asOf) => {
      const current = await readNumberingRuleForUpdate(
        transaction,
        normalizedRuleId,
      )
      if (current === null) {
        throw numberingException(
          HttpStatus.NOT_FOUND,
          NUMBERING_ERROR_CODES.RULE_NOT_FOUND,
          '编号规则不存在',
        )
      }
      if (current.version !== input.expectedVersion) {
        throw numberingException(
          HttpStatus.CONFLICT,
          NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
          '编号规则状态已变化，请刷新后重试',
        )
      }

      const versions = await readNumberingRuleVersionSnapshots(
        transaction,
        normalizedRuleId,
      )
      const draft = findVersion(versions, NumberingRuleVersionStatus.DRAFT)
      if (draft === undefined || draft.revision !== input.draftRevision) {
        throw numberingException(
          HttpStatus.CONFLICT,
          NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
          '编号规则状态已变化，请刷新后重试',
        )
      }
      const active = findVersion(versions, NumberingRuleVersionStatus.ACTIVE)
      if (await hasNumberingIssuance(transaction, normalizedRuleId)) {
        if (active === undefined) {
          throw numberingException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID,
            '编号规则配置无效',
          )
        }
        try {
          validateIssuedRuleConfigCompatibility(active.config, draft.config)
        } catch (error) {
          if (error instanceof NumberingRuleConfigError) {
            throw numberingException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID,
              '首次发号后只能扩大序列位数',
            )
          }
          throw error
        }
      }

      const lifetimeUsedCount = parseNonNegativeDecimal(
        await readNumberingLifetimeUsedCount(transaction, normalizedRuleId),
      )
      if (calculateRuleCapacity(draft.config) < lifetimeUsedCount) {
        throw numberingException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID,
          '编号规则容量不能小于历史使用量',
        )
      }

      if (
        active !== undefined
        && !await transitionNumberingRuleVersionStatus(transaction, {
          versionId: active.id,
          fromStatus: NumberingRuleVersionStatus.ACTIVE,
          toStatus: NumberingRuleVersionStatus.RETIRED,
        })
      ) {
        throw numberingException(
          HttpStatus.CONFLICT,
          NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
          '编号规则状态已变化，请刷新后重试',
        )
      }
      if (!await transitionNumberingRuleVersionStatus(transaction, {
        versionId: draft.id,
        fromStatus: NumberingRuleVersionStatus.DRAFT,
        toStatus: NumberingRuleVersionStatus.ACTIVE,
        publishedAt: asOf,
      })) {
        throw numberingException(
          HttpStatus.CONFLICT,
          NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
          '编号规则状态已变化，请刷新后重试',
        )
      }

      await updateNumberingRuleRecord(transaction, normalizedRuleId, {})
      await this.audit.record(transaction, {
        eventType: AuditEventType.NUMBERING_RULE_VERSION_PUBLISHED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId.toLowerCase(),
        targetType: 'NumberingRule',
        targetId: normalizedRuleId,
        requestId: context.requestId,
        metadata: {
          ruleCode: current.ruleCode,
          revision: draft.revision,
          previousVersion: current.version,
          version: current.version + 1,
          changedFields: 'activeVersion,draftVersion',
        },
      })
      return this.query.getDetailInTransaction(
        transaction,
        normalizedRuleId,
        asOf,
      )
    })
  }

  async enable(
    context: NumberingCommandContext,
    ruleId: string,
    input: ChangeNumberingRuleStatusRequestDto,
  ): Promise<NumberingRuleDetailDto> {
    const normalizedRuleId = ruleId.toLowerCase()

    return this.runMutation(async (transaction, asOf) => {
      const current = await readNumberingRuleForUpdate(
        transaction,
        normalizedRuleId,
      )
      if (current === null) {
        throw numberingException(
          HttpStatus.NOT_FOUND,
          NUMBERING_ERROR_CODES.RULE_NOT_FOUND,
          '编号规则不存在',
        )
      }
      if (current.version !== input.expectedVersion) {
        throw numberingException(
          HttpStatus.CONFLICT,
          NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
          '编号规则状态已变化，请刷新后重试',
        )
      }
      if (current.status === NumberingRuleStatus.ENABLED) {
        return this.query.getDetailInTransaction(
          transaction,
          normalizedRuleId,
          asOf,
        )
      }

      const versions = await readNumberingRuleVersionSnapshots(
        transaction,
        normalizedRuleId,
      )
      const active = findVersion(versions, NumberingRuleVersionStatus.ACTIVE)
      if (active === undefined) {
        throw numberingException(
          HttpStatus.CONFLICT,
          NUMBERING_ERROR_CODES.RULE_UNAVAILABLE,
          '编号规则当前不可用',
        )
      }

      await updateNumberingRuleRecord(transaction, normalizedRuleId, {
        status: NumberingRuleStatus.ENABLED,
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.NUMBERING_RULE_ENABLED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId.toLowerCase(),
        targetType: 'NumberingRule',
        targetId: normalizedRuleId,
        requestId: context.requestId,
        metadata: {
          ruleCode: current.ruleCode,
          revision: active.revision,
          previousVersion: current.version,
          version: current.version + 1,
          changedFields: 'status',
        },
      })
      return this.query.getDetailInTransaction(
        transaction,
        normalizedRuleId,
        asOf,
      )
    })
  }

  async disable(
    context: NumberingCommandContext,
    ruleId: string,
    input: ChangeNumberingRuleStatusRequestDto,
  ): Promise<NumberingRuleDetailDto> {
    const normalizedRuleId = ruleId.toLowerCase()

    return this.runMutation(async (transaction, asOf) => {
      const current = await readNumberingRuleForUpdate(
        transaction,
        normalizedRuleId,
      )
      if (current === null) {
        throw numberingException(
          HttpStatus.NOT_FOUND,
          NUMBERING_ERROR_CODES.RULE_NOT_FOUND,
          '编号规则不存在',
        )
      }
      if (current.version !== input.expectedVersion) {
        throw numberingException(
          HttpStatus.CONFLICT,
          NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
          '编号规则状态已变化，请刷新后重试',
        )
      }
      if (current.status === NumberingRuleStatus.DISABLED) {
        return this.query.getDetailInTransaction(
          transaction,
          normalizedRuleId,
          asOf,
        )
      }
      if (current.status !== NumberingRuleStatus.ENABLED) {
        throw numberingException(
          HttpStatus.CONFLICT,
          NUMBERING_ERROR_CODES.RULE_UNAVAILABLE,
          '编号规则当前不可用',
        )
      }

      await updateNumberingRuleRecord(transaction, normalizedRuleId, {
        status: NumberingRuleStatus.DISABLED,
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.NUMBERING_RULE_DISABLED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId.toLowerCase(),
        targetType: 'NumberingRule',
        targetId: normalizedRuleId,
        requestId: context.requestId,
        metadata: {
          ruleCode: current.ruleCode,
          previousVersion: current.version,
          version: current.version + 1,
          changedFields: 'status',
        },
      })
      return this.query.getDetailInTransaction(
        transaction,
        normalizedRuleId,
        asOf,
      )
    })
  }

  async clone(
    context: NumberingCommandContext,
    sourceRuleId: string,
    input: CloneNumberingRuleRequestDto,
  ): Promise<NumberingRuleDetailDto> {
    const normalizedSourceId = sourceRuleId.toLowerCase()
    const ruleCode = normalizeNumberingRuleCode(input.ruleCode)
    const name = normalizeNumberingRuleName(input.name)
    const overridesDescription = Object.hasOwn(input, 'description')
      && input.description !== undefined
    const descriptionOverride = overridesDescription
      ? normalizeOptionalNumberingRuleDescription(input.description)
      : undefined

    return this.runMutation(async (transaction, asOf) => {
      const source = await readNumberingRuleForClone(
        transaction,
        normalizedSourceId,
      )
      if (source === null) {
        throw numberingException(
          HttpStatus.NOT_FOUND,
          NUMBERING_ERROR_CODES.RULE_NOT_FOUND,
          '编号规则不存在',
        )
      }
      if (source.version !== input.expectedVersion) {
        throw numberingException(
          HttpStatus.CONFLICT,
          NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
          '编号规则状态已变化，请刷新后重试',
        )
      }
      const versions = await readNumberingRuleVersionSnapshots(
        transaction,
        normalizedSourceId,
      )
      const sourceVersion =
        findVersion(versions, NumberingRuleVersionStatus.ACTIVE)
        ?? findVersion(versions, NumberingRuleVersionStatus.DRAFT)
      if (sourceVersion === undefined) {
        throw numberingException(
          HttpStatus.CONFLICT,
          NUMBERING_ERROR_CODES.RULE_UNAVAILABLE,
          '编号规则当前不可用',
        )
      }
      // 来源配置已由 persistence 重建并验证；若该内部不变量被破坏，应按 500
      // 收口，而不是误报成调用方的 422 输入错误。
      const prepared = prepareNumberingRuleConfig(sourceVersion.config)
      const created = await createNumberingRuleRecord(transaction, {
        ruleCode,
        name,
        description: overridesDescription
          ? descriptionOverride ?? null
          : source.description,
      })
      await createNumberingDraftVersion(transaction, {
        ruleId: created.id,
        revision: 1,
        ...prepared,
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.NUMBERING_RULE_CREATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId.toLowerCase(),
        targetType: 'NumberingRule',
        targetId: created.id,
        requestId: context.requestId,
        metadata: {
          clonedFromRuleCode: source.ruleCode,
          ruleCode,
          changedFields: 'description,name,resetPolicy,ruleCode,segments',
          revision: 1,
          version: 1,
          ...configSummary(prepared.config),
        },
      })
      return this.query.getDetailInTransaction(transaction, created.id, asOf)
    })
  }

  private async runMutation<T>(
    operation: (
      transaction: Prisma.TransactionClient,
      asOf: Date,
    ) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        // 必须是事务内第一条 SQL；随后统一读取 transaction_timestamp 作为响应快照。
        await applyTransactionTimeouts(transaction)
        const asOf = await readNumberingTransactionTimestamp(transaction)
        return operation(transaction, asOf)
      })
    } catch (error) {
      throw mapNumberingPersistenceError(error)
    }
  }
}
