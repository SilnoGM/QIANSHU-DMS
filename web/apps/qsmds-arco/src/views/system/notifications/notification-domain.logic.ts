export type NotificationDomainValue = 'SALES' | 'PURCHASE' | 'SHIPMENT' | 'FINANCE' | 'INVOICE' | 'RECONCILIATION' | 'OPERATIONS' | 'SYSTEM'

export const NOTIFICATION_DOMAIN_OPTIONS: Array<{ label: string, value: NotificationDomainValue }> = [
  { label: '销售域', value: 'SALES' },
  { label: '采购域', value: 'PURCHASE' },
  { label: '货件运输域', value: 'SHIPMENT' },
  { label: '财务域', value: 'FINANCE' },
  { label: '发票域', value: 'INVOICE' },
  { label: '对账域', value: 'RECONCILIATION' },
  { label: '运营域', value: 'OPERATIONS' },
  { label: '系统', value: 'SYSTEM' },
]

export const NOTIFICATION_DOMAIN_LABELS: Record<string, string> = Object.fromEntries(
  NOTIFICATION_DOMAIN_OPTIONS.map(option => [option.value, option.label]),
)

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

export function notificationDomainLabel(domain: string): string {
  return NOTIFICATION_DOMAIN_LABELS[domain] ?? domain
}

export function notificationDomainClass(domain: string): string {
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
