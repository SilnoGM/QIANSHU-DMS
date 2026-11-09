import type { NotificationTemplateDto } from '@/api/generated/types.gen'

export type TemplateDomain = 'SALES' | 'PURCHASE' | 'SHIPMENT' | 'FINANCE' | 'INVOICE' | 'RECONCILIATION' | 'SYSTEM'

export const TEMPLATE_DOMAIN_OPTIONS: Array<{ label: string, value: TemplateDomain }> = [
  { label: '销售域', value: 'SALES' },
  { label: '采购域', value: 'PURCHASE' },
  { label: '货件运输域', value: 'SHIPMENT' },
  { label: '财务域', value: 'FINANCE' },
  { label: '发票域', value: 'INVOICE' },
  { label: '对账域', value: 'RECONCILIATION' },
  { label: '系统', value: 'SYSTEM' },
]

export const TEMPLATE_DOMAIN_LABELS: Record<string, string> = Object.fromEntries(
  TEMPLATE_DOMAIN_OPTIONS.map(option => [option.value, option.label]),
)

export interface TemplateKeyGroup {
  key: string
  domain: TemplateDomain
  displayName: string
  assistant: NotificationTemplateDto | null
  inApp: NotificationTemplateDto | null
  channelCount: number
  updatedAt: string | null
  updatedByName: string | null
}

export interface TemplateDomainGroup {
  domain: TemplateDomain
  label: string
  keys: TemplateKeyGroup[]
  keyCount: number
  channelCount: number
}

export interface TemplateBodySegment {
  text: string
  token: boolean
}

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
})

export function formatNotificationDateTime(value: string | null): string {
  return value === null ? '—' : dateTimeFormatter.format(new Date(value))
}

export function templateDomainLabel(domain: string): string {
  return TEMPLATE_DOMAIN_LABELS[domain] ?? domain
}

export function templateDomainClass(domain: string): string {
  const classes: Record<string, string> = {
    SALES: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    PURCHASE: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    SHIPMENT: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
    FINANCE: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    INVOICE: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    RECONCILIATION: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    SYSTEM: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300',
  }
  return classes[domain] ?? classes.SYSTEM
}

export function messageKindLabel(kind: string): string {
  return kind === 'LINK' ? '链接' : '文本'
}

export function templateKeyDisplayName(
  assistant: NotificationTemplateDto | null,
  inApp: NotificationTemplateDto | null,
  key: string,
): string {
  return assistant?.name.trim() || inApp?.name.trim() || key
}

function latestTemplate(
  current: { template: NotificationTemplateDto, at: number } | null,
  template: NotificationTemplateDto,
): { template: NotificationTemplateDto, at: number } {
  const at = Number.isNaN(Date.parse(template.updatedAt)) ? 0 : Date.parse(template.updatedAt)
  return current === null || at >= current.at ? { template, at } : current
}

export function groupTemplatesByKey(templates: readonly NotificationTemplateDto[]): TemplateKeyGroup[] {
  const groups = new Map<string, {
    assistant: NotificationTemplateDto | null
    inApp: NotificationTemplateDto | null
    key: string
    latest: { template: NotificationTemplateDto, at: number } | null
    domain: TemplateDomain
  }>()

  for (const template of templates) {
    const group = groups.get(template.key) ?? {
      assistant: null,
      inApp: null,
      key: template.key,
      latest: null,
      domain: template.domain,
    }
    if (template.channel === 'ASSISTANT') {
      group.assistant = template
    }
    else {
      group.inApp = template
    }
    group.latest = latestTemplate(group.latest, template)
    groups.set(template.key, group)
  }

  return [...groups.values()]
    .map((group) => {
      const latest = group.latest?.template ?? null
      const fallback = latest?.channel === 'ASSISTANT' ? group.inApp : group.assistant
      return {
        key: group.key,
        domain: group.domain,
        displayName: templateKeyDisplayName(group.assistant, group.inApp, group.key),
        assistant: group.assistant,
        inApp: group.inApp,
        channelCount: (group.assistant === null ? 0 : 1) + (group.inApp === null ? 0 : 1),
        updatedAt: latest?.updatedAt ?? null,
        updatedByName: latest?.updatedByName ?? fallback?.updatedByName ?? null,
      }
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN') || left.key.localeCompare(right.key))
}

export function groupTemplateKeysByDomain(groups: readonly TemplateKeyGroup[]): TemplateDomainGroup[] {
  return TEMPLATE_DOMAIN_OPTIONS.flatMap((option) => {
    const keys = groups.filter(group => group.domain === option.value)
    return keys.length === 0
      ? []
      : [{
          domain: option.value,
          label: option.label,
          keys,
          keyCount: keys.length,
          channelCount: keys.reduce((total, key) => total + key.channelCount, 0),
        }]
  })
}

export function filterTemplateDomainGroups(
  groups: readonly TemplateDomainGroup[],
  keyword: string,
): TemplateDomainGroup[] {
  const normalized = keyword.trim().toLowerCase()
  if (normalized.length === 0) {
    return [...groups]
  }
  return groups.flatMap((group) => {
    if (group.label.toLowerCase().includes(normalized) || group.domain.toLowerCase().includes(normalized)) {
      return [group]
    }
    const keys = group.keys.filter(keyGroup =>
      keyGroup.key.toLowerCase().includes(normalized)
      || keyGroup.displayName.toLowerCase().includes(normalized))
    return keys.length === 0
      ? []
      : [{
          ...group,
          keys,
          keyCount: keys.length,
          channelCount: keys.reduce((total, key) => total + key.channelCount, 0),
        }]
  })
}

export function splitTemplateBody(body: string): TemplateBodySegment[] {
  return body.split(/(\{\{\w+\}\})/g).map((text) => {
    return {
      text,
      token: /^\{\{\w+\}\}$/u.test(text),
    }
  })
}
