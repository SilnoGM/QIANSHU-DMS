import type { TemplateDomain } from './template-key-grouping.logic'

import type {
  NotificationChannelPolicyDto,
  NotificationEventDto,
  NotificationTemplateDto,
} from '@/api/generated/types.gen'
import { TEMPLATE_DOMAIN_OPTIONS } from './template-key-grouping.logic'

export type NotificationChannelValue = 'IN_APP' | 'ASSISTANT'

export type EventChannelState = 'READY' | 'MISSING_TEMPLATE' | 'UNCONFIGURED' | 'DISABLED' | 'UNKNOWN'

export type EffectiveTemplateSource = 'POLICY' | 'DEFAULT' | 'NONE'

export type MissingTemplateReason = 'NO_TEMPLATE_KEY' | 'TEMPLATE_NOT_FOUND' | 'TEMPLATE_DISABLED'

export interface EffectiveTemplate {
  key: string | null
  source: EffectiveTemplateSource
  template: NotificationTemplateDto | null
  state: EventChannelState
  missingReason: MissingTemplateReason | null
}

export type EventCoverageState = 'READY' | 'PARTIAL' | 'MISSING_TEMPLATE' | 'UNCONFIGURED' | 'DISABLED' | 'UNKNOWN'

export interface EventCoverage {
  event: NotificationEventDto
  inApp: EffectiveTemplate
  assistant: EffectiveTemplate
  state: EventCoverageState
}

export interface EventCoverageSummary {
  total: number
  ready: number
  partial: number
  missingTemplate: number
  unconfigured: number
  unimplemented: number
  disabled: number
  unknown: number
}

export interface EventDomainGroup {
  domain: TemplateDomain
  label: string
  events: EventCoverage[]
}

export type EventTableFilter = 'ALL' | 'UNIMPLEMENTED' | EventCoverageState

export interface EventTableRow {
  id: string
  kind: 'event'
  label: string
  event: NotificationEventDto
  coverage: EventCoverage
  updatedAt: string | null
  updatedByName: string | null
}

export interface EventTableGroupRow {
  id: string
  kind: 'domain'
  label: string
  domain: TemplateDomain
  children: EventTableRow[]
}

export interface EventTableQuery {
  filter?: EventTableFilter
  keyword?: string
}

export interface SelectOption {
  label: string
  value: string
}

export interface PolicyOptionLists {
  users: SelectOption[]
  roles: SelectOption[]
  permissions: SelectOption[]
  groups: SelectOption[]
}

const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/gu

export function findChannelPolicy(
  policies: readonly NotificationChannelPolicyDto[],
  eventType: string,
  channel: NotificationChannelValue,
): NotificationChannelPolicyDto | null {
  return policies.find(policy => policy.eventType === eventType && policy.channel === channel) ?? null
}

/**
 * 实际生效模板 = 策略绑定键优先，否则回退业务默认键。
 * templates 为 null 表示当前账号没有模板查看权限，此时不判定缺模板。
 */
export function resolveChannelTemplate(
  event: NotificationEventDto,
  channel: NotificationChannelValue,
  policy: NotificationChannelPolicyDto | null,
  templates: readonly NotificationTemplateDto[] | null,
): EffectiveTemplate {
  const policyKey = policy?.templateKey?.trim() ?? ''
  const defaultKey = event.defaultTemplateKey?.trim() ?? ''
  const key = policyKey.length > 0 ? policyKey : defaultKey.length > 0 ? defaultKey : null
  const source: EffectiveTemplateSource = policyKey.length > 0 && policyKey !== defaultKey
    ? 'POLICY'
    : defaultKey.length > 0 ? 'DEFAULT' : 'NONE'
  const template = templates === null || key === null
    ? null
    : templates.find(item => item.key === key && item.channel === channel) ?? null

  if (policy === null) {
    return { key, source, template, state: 'UNCONFIGURED', missingReason: null }
  }
  if (!policy.enabled) {
    return { key, source, template, state: 'DISABLED', missingReason: null }
  }
  if (templates === null) {
    return { key, source, template: null, state: 'UNKNOWN', missingReason: null }
  }
  if (key === null) {
    return { key, source, template: null, state: 'MISSING_TEMPLATE', missingReason: 'NO_TEMPLATE_KEY' }
  }
  if (template === null) {
    return { key, source, template: null, state: 'MISSING_TEMPLATE', missingReason: 'TEMPLATE_NOT_FOUND' }
  }
  if (!template.enabled) {
    return { key, source, template, state: 'MISSING_TEMPLATE', missingReason: 'TEMPLATE_DISABLED' }
  }
  return { key, source, template, state: 'READY', missingReason: null }
}

function deriveEventState(inApp: EffectiveTemplate, assistant: EffectiveTemplate): EventCoverageState {
  const channels = [inApp, assistant]
  const configured = channels.filter(channel => channel.state !== 'UNCONFIGURED')
  if (configured.length === 0) {
    return 'UNCONFIGURED'
  }
  if (channels.every(channel => channel.state === 'READY')) {
    return 'READY'
  }
  if (channels.some(channel => channel.state === 'MISSING_TEMPLATE')) {
    return 'MISSING_TEMPLATE'
  }
  if (channels.some(channel => channel.state === 'UNKNOWN')) {
    return 'UNKNOWN'
  }
  if (configured.every(channel => channel.state === 'DISABLED')) {
    return 'DISABLED'
  }
  return 'PARTIAL'
}

export function buildEventCoverage(
  events: readonly NotificationEventDto[],
  policies: readonly NotificationChannelPolicyDto[],
  templates: readonly NotificationTemplateDto[] | null,
): EventCoverage[] {
  return events.map((event) => {
    const inApp = resolveChannelTemplate(
      event,
      'IN_APP',
      findChannelPolicy(policies, event.eventType, 'IN_APP'),
      templates,
    )
    const assistant = resolveChannelTemplate(
      event,
      'ASSISTANT',
      findChannelPolicy(policies, event.eventType, 'ASSISTANT'),
      templates,
    )
    return { event, inApp, assistant, state: deriveEventState(inApp, assistant) }
  })
}

export function summarizeEventCoverage(coverage: readonly EventCoverage[]): EventCoverageSummary {
  const summary: EventCoverageSummary = {
    total: coverage.length,
    ready: 0,
    partial: 0,
    missingTemplate: 0,
    unconfigured: 0,
    unimplemented: 0,
    disabled: 0,
    unknown: 0,
  }
  for (const item of coverage) {
    if (item.state === 'READY') {
      summary.ready += 1
    }
    else if (item.state === 'PARTIAL') {
      summary.partial += 1
    }
    else if (item.state === 'MISSING_TEMPLATE') {
      summary.missingTemplate += 1
    }
    else if (item.state === 'UNCONFIGURED') {
      if (item.event.implemented) {
        summary.unconfigured += 1
      }
      else {
        summary.unimplemented += 1
      }
    }
    else if (item.state === 'DISABLED') {
      summary.disabled += 1
    }
    else { summary.unknown += 1 }
  }
  return summary
}

export function groupEventCoverageByDomain(coverage: readonly EventCoverage[]): EventDomainGroup[] {
  return TEMPLATE_DOMAIN_OPTIONS.flatMap((option) => {
    const events = coverage.filter(item => item.event.domain === option.value)
    return events.length === 0
      ? []
      : [{ domain: option.value, label: option.label, events }]
  })
}

function matchesTableFilter(item: EventCoverage, filter: EventTableFilter): boolean {
  if (filter === 'ALL') {
    return true
  }
  if (filter === 'UNIMPLEMENTED') {
    return !item.event.implemented && item.state === 'UNCONFIGURED'
  }
  if (filter === 'UNCONFIGURED') {
    return item.event.implemented && item.state === 'UNCONFIGURED'
  }
  return item.state === filter
}

function matchesTableKeyword(item: EventCoverage, normalized: string): boolean {
  if (normalized.length === 0) {
    return true
  }
  const haystack = [
    item.event.label,
    item.event.eventType,
    item.inApp.key ?? '',
    item.assistant.key ?? '',
    item.inApp.template?.name ?? '',
    item.assistant.template?.name ?? '',
  ].join(' ').toLowerCase()
  return haystack.includes(normalized)
}

function latestPolicy(
  policies: readonly NotificationChannelPolicyDto[],
  eventType: string,
): NotificationChannelPolicyDto | null {
  return policies
    .filter(policy => policy.eventType === eventType)
    .reduce<NotificationChannelPolicyDto | null>((latest, policy) => {
      if (latest === null) {
        return policy
      }
      const policyAt = Number.isNaN(Date.parse(policy.updatedAt)) ? 0 : Date.parse(policy.updatedAt)
      const latestAt = Number.isNaN(Date.parse(latest.updatedAt)) ? 0 : Date.parse(latest.updatedAt)
      return policyAt >= latestAt ? policy : latest
    }, null)
}

/** 事件表格按业务域分组；父组是域，子行是事件，搜索和状态过滤在页面侧完成。 */
export function buildEventTableGroups(
  coverage: readonly EventCoverage[],
  policies: readonly NotificationChannelPolicyDto[],
  query: EventTableQuery = {},
): EventTableGroupRow[] {
  const filter = query.filter ?? 'ALL'
  const normalized = query.keyword?.trim().toLowerCase() ?? ''
  return TEMPLATE_DOMAIN_OPTIONS.flatMap((option) => {
    const children = coverage
      .filter(item => item.event.domain === option.value
        && matchesTableFilter(item, filter)
        && matchesTableKeyword(item, normalized))
      .map<EventTableRow>((item) => {
        const latest = latestPolicy(policies, item.event.eventType)
        return {
          id: `event:${item.event.eventType}`,
          kind: 'event',
          label: item.event.label,
          event: item.event,
          coverage: item,
          updatedAt: latest?.updatedAt ?? null,
          updatedByName: latest?.updatedByName ?? null,
        }
      })
    return children.length === 0
      ? []
      : [{
          id: `domain:${option.value}`,
          kind: 'domain',
          domain: option.value,
          label: option.label,
          children,
        }]
  })
}

export function filterEventCoverage(
  coverage: readonly EventCoverage[],
  keyword: string,
  onlyIssues: boolean,
): EventCoverage[] {
  const normalized = keyword.trim().toLowerCase()
  return coverage.filter((item) => {
    if (onlyIssues && (item.state === 'READY' || !item.event.implemented)) {
      return false
    }
    if (normalized.length === 0) {
      return true
    }
    const haystack = [
      item.event.label,
      item.event.eventType,
      item.inApp.key ?? '',
      item.assistant.key ?? '',
      item.inApp.template?.name ?? '',
      item.assistant.template?.name ?? '',
    ].join(' ').toLowerCase()
    return haystack.includes(normalized)
  })
}

export function collectTemplatePlaceholders(template: NotificationTemplateDto): string[] {
  const names = new Set<string>()
  for (const text of [template.bodyTemplate, template.titleTemplate ?? '', template.linkUrlTemplate ?? '']) {
    for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
      if (match[1] !== undefined) {
        names.add(match[1])
      }
    }
  }
  return [...names].sort()
}

/** 返回模板使用、但事件不会提供的变量；事件变量契约未知时不拦截。 */
export function templateIncompatibleVariables(
  template: NotificationTemplateDto,
  event: NotificationEventDto,
): string[] {
  if (!event.variablesKnown) {
    return []
  }
  const allowed = new Set(event.variables)
  return collectTemplatePlaceholders(template).filter(name => !allowed.has(name))
}

/** 键 → 使用该模板键的事件集合；同一事件的两个渠道只计一次。 */
export function buildTemplateUsageCounts(
  events: readonly NotificationEventDto[],
  policies: readonly NotificationChannelPolicyDto[],
): Map<string, Set<string>> {
  const usage = new Map<string, Set<string>>()
  const add = (key: string | null | undefined, eventType: string): void => {
    const normalized = key?.trim() ?? ''
    if (normalized.length === 0) {
      return
    }
    const eventTypes = usage.get(normalized) ?? new Set<string>()
    eventTypes.add(eventType)
    usage.set(normalized, eventTypes)
  }
  for (const event of events) {
    add(event.defaultTemplateKey, event.eventType)
  }
  for (const policy of policies) {
    add(policy.templateKey, policy.eventType)
  }
  return usage
}

export function templateUsageCount(usage: ReadonlyMap<string, Set<string>>, key: string): number {
  return usage.get(key.trim())?.size ?? 0
}
