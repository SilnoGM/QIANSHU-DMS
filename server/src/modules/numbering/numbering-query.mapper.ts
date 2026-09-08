import { calculateRuleCapacity } from './capacity'
import type {
  NumberingIssuanceDto,
  NumberingRuleConfigResponseDto,
  NumberingRuleDetailDto,
  NumberingRuleListItemDto,
  NumberingRuleStatisticsDto,
  NumberingRuleVersionDto,
} from './dto/numbering-response.dto'
import { NUMBERING_TIME_ZONE } from './dto/numbering-response.dto'
import { getNumberingPeriodKey } from './period'
import { previewNumberingRule } from './preview'
import type {
  NumberingIssuanceReadRow,
  NumberingPeriodUsage,
  NumberingPeriodUsageRequest,
  NumberingRuleReadRow,
  NumberingVersionReadRow,
} from './numbering-query.persistence'
import type { NumberingRandomSource } from './random-source'
import type { NumberingRuleConfig } from './rule-types'
import {
  calculateMaxOutputLength,
  validateNumberingRuleConfig,
} from './rule-validation'

export interface SelectedNumberingRuleVersions {
  readonly active: NumberingVersionReadRow | null
  readonly draft: NumberingVersionReadRow | null
  readonly statisticsVersion: NumberingVersionReadRow
  readonly statisticsSource: 'ACTIVE' | 'DRAFT'
}

/** 从显式 read select 重建领域配置；损坏的持久化快照只作为内部一致性错误。 */
export function reconstructStoredNumberingConfig(
  version: NumberingVersionReadRow,
): NumberingRuleConfig {
  if (version.timezone !== NUMBERING_TIME_ZONE) {
    throw new TypeError('数据库编号时区无效')
  }

  const segments = version.segments.map((segment): unknown => {
    switch (segment.type) {
      case 'FIXED':
        return { type: segment.type, value: segment.fixedValue }
      case 'DATE':
        return { type: segment.type, format: segment.dateFormat }
      case 'SEPARATOR':
        return { type: segment.type, value: segment.separatorValue }
      case 'SEQUENCE':
        return {
          type: segment.type,
          width: segment.sequenceWidth,
          startValue: segment.sequenceStartValue?.toString(),
          step: segment.sequenceStep?.toString(),
        }
      case 'RANDOM':
        return {
          type: segment.type,
          letterLength: segment.randomLetterLength,
          digitLength: segment.randomDigitLength,
          mode: segment.randomMode,
        }
    }
  })

  try {
    return validateNumberingRuleConfig({
      resetPolicy: version.resetPolicy,
      segments,
    })
  }
  catch {
    throw new TypeError('数据库编号配置无效')
  }
}

export function toNumberingConfigResponse(
  config: NumberingRuleConfig,
): NumberingRuleConfigResponseDto {
  return {
    resetPolicy: config.resetPolicy,
    timezone: NUMBERING_TIME_ZONE,
    maxOutputLength: calculateMaxOutputLength(config),
    segments: config.segments.map((segment) => ({ ...segment })),
  }
}

export function toNumberingVersionDto(
  version: NumberingVersionReadRow,
): NumberingRuleVersionDto {
  const config = reconstructStoredNumberingConfig(version)

  return {
    id: version.id,
    revision: version.revision,
    status: version.status,
    config: toNumberingConfigResponse(config),
    capacity: calculateRuleCapacity(config).toString(),
    createdAt: version.createdAt.toISOString(),
    publishedAt: version.publishedAt?.toISOString() ?? null,
  }
}

export function selectNumberingRuleVersions(
  rule: NumberingRuleReadRow,
): SelectedNumberingRuleVersions {
  const activeVersions = rule.versions.filter(
    (version) => version.status === 'ACTIVE',
  )
  const draftVersions = rule.versions.filter(
    (version) => version.status === 'DRAFT',
  )

  if (activeVersions.length > 1 || draftVersions.length > 1) {
    throw new TypeError('数据库编号版本唯一性无效')
  }

  const active = activeVersions[0] ?? null
  const draft = draftVersions[0] ?? null
  const statisticsVersion = active ?? draft

  if (statisticsVersion === null) {
    throw new TypeError('编号规则缺少可展示版本')
  }

  return {
    active,
    draft,
    statisticsVersion,
    statisticsSource: active === null ? 'DRAFT' : 'ACTIVE',
  }
}

export function buildNumberingCurrentUsageRequest(
  rule: NumberingRuleReadRow,
  versions: SelectedNumberingRuleVersions,
  asOf: Date,
): NumberingPeriodUsageRequest {
  if (versions.active === null) {
    return { ruleId: rule.id, periodKey: null }
  }

  const config = reconstructStoredNumberingConfig(versions.active)
  return {
    ruleId: rule.id,
    periodKey: getNumberingPeriodKey(config.resetPolicy, asOf),
  }
}

function toNumberingStatisticsDto(
  versions: SelectedNumberingRuleVersions,
  usage: NumberingPeriodUsage | undefined,
  asOf: Date,
  randomSource: NumberingRandomSource,
): NumberingRuleStatisticsDto {
  const config = reconstructStoredNumberingConfig(versions.statisticsVersion)
  const usedCount = versions.active === null
    ? '0'
    : usage?.usedCount ?? '0'
  const lifetimeUsedCount = usage?.lifetimeUsedCount ?? '0'
  const preview = previewNumberingRule({
    config,
    databaseTime: asOf,
    usedCount,
    randomSource,
  })

  return {
    statisticsSource: versions.statisticsSource,
    periodKey: preview.periodKey,
    capacity: preview.capacity,
    usedCount: preview.usedCount,
    remainingCount: preview.remainingCount,
    lifetimeUsedCount,
    nextSequenceValue: preview.nextSequenceValue,
    nextNumberPreview: preview.nextNumberPreview,
    nextNumberDeterministic: preview.nextNumberDeterministic,
    periodStatus: preview.periodStatus,
    asOf: asOf.toISOString(),
  }
}

export function toNumberingListItemDto(
  rule: NumberingRuleReadRow,
  usage: NumberingPeriodUsage | undefined,
  asOf: Date,
  randomSource: NumberingRandomSource,
): NumberingRuleListItemDto {
  const versions = selectNumberingRuleVersions(rule)
  const displayVersion = versions.active ?? versions.draft

  if (displayVersion === null) {
    throw new TypeError('编号规则缺少展示版本')
  }

  return {
    id: rule.id,
    ruleCode: rule.ruleCode,
    purpose: rule.purpose,
    name: rule.name,
    description: rule.description,
    status: rule.status,
    version: rule.version,
    activeRevision: versions.active?.revision ?? null,
    draftRevision: versions.draft?.revision ?? null,
    displayVersion: toNumberingVersionDto(displayVersion),
    statistics: toNumberingStatisticsDto(
      versions,
      usage,
      asOf,
      randomSource,
    ),
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }
}

export function toNumberingDetailDto(
  rule: NumberingRuleReadRow,
  usage: NumberingPeriodUsage | undefined,
  asOf: Date,
  randomSource: NumberingRandomSource,
): NumberingRuleDetailDto {
  const versions = selectNumberingRuleVersions(rule)

  return {
    id: rule.id,
    ruleCode: rule.ruleCode,
    purpose: rule.purpose,
    name: rule.name,
    description: rule.description,
    status: rule.status,
    version: rule.version,
    activeVersion: versions.active === null
      ? null
      : toNumberingVersionDto(versions.active),
    draftVersion: versions.draft === null
      ? null
      : toNumberingVersionDto(versions.draft),
    statistics: toNumberingStatisticsDto(
      versions,
      usage,
      asOf,
      randomSource,
    ),
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }
}

export function toNumberingIssuanceDto(
  row: NumberingIssuanceReadRow,
): NumberingIssuanceDto {
  return {
    id: row.id,
    ruleRevision: row.ruleRevision,
    periodKey: row.periodKey,
    generatedNumber: row.generatedNumber,
    sequenceValue: row.sequenceValue,
    consumerCode: row.consumerCode,
    issuedAt: row.issuedAt.toISOString(),
  }
}
