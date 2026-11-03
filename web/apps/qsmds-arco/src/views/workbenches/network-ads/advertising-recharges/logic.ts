import type { AdvertisingRechargeDto } from '@/api/generated/types.gen'

export type AdvertisingRechargeStatus = AdvertisingRechargeDto['status']

export const ADVERTISING_RECHARGE_STATUS_META: Record<AdvertisingRechargeStatus, { labelKey: string, tagClass: string }> = {
  PENDING: {
    labelKey: 'advertisingRecharge.status.pending',
    tagClass: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  PAID: {
    labelKey: 'advertisingRecharge.status.paid',
    tagClass: 'border-primary/35 bg-primary/10 text-primary dark:text-emerald-300',
  },
  REJECTED: {
    labelKey: 'advertisingRecharge.status.rejected',
    tagClass: 'border-destructive/35 bg-destructive/10 text-destructive',
  },
  WITHDRAWN: {
    labelKey: 'advertisingRecharge.status.withdrawn',
    tagClass: 'border-border bg-muted text-muted-foreground',
  },
  VOIDED: {
    labelKey: 'advertisingRecharge.status.voided',
    tagClass: 'border-border bg-muted text-muted-foreground',
  },
}

export function advertisingRechargeStatusMeta(status: AdvertisingRechargeStatus) {
  return ADVERTISING_RECHARGE_STATUS_META[status]
}

export const ADVERTISING_RECHARGE_STATUS_FILTER_OPTIONS: { value: 'ALL' | AdvertisingRechargeStatus, labelKey: string }[] = [
  { value: 'ALL', labelKey: 'advertisingRecharge.status.all' },
  ...(Object.keys(ADVERTISING_RECHARGE_STATUS_META) as AdvertisingRechargeStatus[]).map(status => ({
    value: status,
    labelKey: ADVERTISING_RECHARGE_STATUS_META[status].labelKey,
  })),
]

export const ADVERTISING_RECHARGE_ACCOUNT_TYPE_OPTIONS: { value: AdvertisingRechargeDto['accountType'], labelKey: string }[] = [
  { value: 'PERSONAL', labelKey: 'advertisingRecharge.accountType.personal' },
  { value: 'NON_PERSONAL', labelKey: 'advertisingRecharge.accountType.nonPersonal' },
]

/** 充值币种：美元默认、人民币可选；付款金额始终是财务手填的 CNY。 */
export const ADVERTISING_RECHARGE_CURRENCY_OPTIONS = ['USD', 'CNY'] as const

/**
 * 复制给财务的申请摘要。需求固定三行，不附加金额等额外信息；
 * 链接指向财务工作台的详情页，由运营复制后发给财务。
 */
export function buildAdvertisingRechargeCopyText(input: {
  readonly adAccountName: string
  readonly adAccountNo: string
  readonly link: string
}): string {
  return [
    '【广告户充值】',
    `广告账户名称：${input.adAccountName}`,
    `广告账户编号：${input.adAccountNo}`,
    `广告账户充值链接：${input.link}`,
  ].join('\n')
}

/** 绝对链接需要站点 origin；hash / history 两种路由模式都由 router.resolve 给出正确 href。 */
export function buildAdvertisingRechargeDetailLink(origin: string, href: string): string {
  return `${origin.replace(/\/+$/u, '')}${href}`
}

/** 运营视角读取本人图片，财务视角读取全量图片；服务端按权限分别校验。 */
export function advertisingRechargeQrUrl(id: string, scope: 'self' | 'finance'): string {
  return scope === 'self'
    ? `/api/advertising-recharges/me/${encodeURIComponent(id)}/qr-content`
    : `/api/advertising-recharges/${encodeURIComponent(id)}/qr-content`
}

export function advertisingRechargeProofUrl(id: string, scope: 'self' | 'finance'): string {
  return scope === 'self'
    ? `/api/advertising-recharges/me/${encodeURIComponent(id)}/payment-proof-content`
    : `/api/advertising-recharges/${encodeURIComponent(id)}/payment-proof-content`
}
