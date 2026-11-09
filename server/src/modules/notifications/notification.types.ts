import type { Prisma } from '../../generated/prisma/client'

export const NOTIFICATION_EVENT_TYPES = [
  'PURCHASE_REVIEW_PENDING',
  'INVOICE_REQUEST_REVIEW_PENDING',
  'SLH_RECONCILIATION_COMPLETED',
  'SHIPMENT_ARRIVED',
  'FUND_WITHDRAWAL_REVIEW_PENDING',
  'PACKAGING_COST_PAYMENT_PENDING',
  'PURCHASE_PAYABLE_PENDING',
] as const

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

export type NotificationChannel = 'IN_APP' | 'ASSISTANT'

export type NotificationPriority = 'NORMAL' | 'HIGH'

export type NotificationDomain =
  | 'purchase'
  | 'fund'
  | 'invoice'
  | 'reconciliation'
  | 'shipment'

export const NOTIFICATION_DOMAIN_LABELS: Readonly<Record<NotificationDomain, string>> = Object.freeze({
  purchase: '采购',
  fund: '资金',
  invoice: '发票',
  reconciliation: '对账',
  shipment: '货件',
})

/** 站内通知的业务域筛选由事件类型派生，不单独落库。 */
export const NOTIFICATION_EVENT_DOMAIN: Readonly<Record<NotificationEventType, NotificationDomain>> = Object.freeze({
  PURCHASE_REVIEW_PENDING: 'purchase',
  INVOICE_REQUEST_REVIEW_PENDING: 'invoice',
  SLH_RECONCILIATION_COMPLETED: 'reconciliation',
  SHIPMENT_ARRIVED: 'shipment',
  FUND_WITHDRAWAL_REVIEW_PENDING: 'fund',
  PACKAGING_COST_PAYMENT_PENDING: 'fund',
  PURCHASE_PAYABLE_PENDING: 'fund',
})

export type NotificationTarget =
  | { readonly kind: 'USERS', readonly userIds: readonly string[] }
  | { readonly kind: 'ROLE', readonly roleCodes: readonly string[] }
  | { readonly kind: 'PERMISSION', readonly permissionCode: string }

export interface SystemNotificationPublishCommand {
  readonly eventType: NotificationEventType
  readonly source: { readonly type: string, readonly id: string }
  readonly target: NotificationTarget
  readonly templateKey: string
  readonly variables: Readonly<Record<string, string | number | null>>
  readonly dedupeKey?: string
  readonly priority?: NotificationPriority
  readonly expiresAt?: string
  readonly channels?: readonly NotificationChannel[]
  readonly requestedByUserId?: string
}

export interface SystemNotificationPublishOptions {
  readonly transaction?: Prisma.TransactionClient
  readonly now?: Date
}

export type NotificationSkipReason =
  | 'NOT_BOUND'
  | 'USER_DISABLED'
  | 'NO_RECIPIENT'
  | 'TARGET_DISABLED'
  | 'CHANNEL_DISABLED'
  | 'CHANNEL_NOT_CONFIGURED'
  | 'QUIET_HOURS_EXPIRED'

export type NotificationPublishWarningCode =
  | 'EVENT_NOT_CONFIGURED'
  | 'CHANNEL_NOT_CONFIGURED'
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_VARIABLE_MISSING'
  | 'SENSITIVE_VARIABLE_MASKED'
  | 'NO_RECIPIENT'
  | 'DUPLICATE_IGNORED'

export interface SystemNotificationPublishChannelResult {
  readonly channel: NotificationChannel
  readonly status: 'CREATED' | 'PENDING' | 'SKIPPED'
  readonly recipientCount: number
  readonly skippedCount: number
  readonly skipReason?: NotificationSkipReason
}

export interface SystemNotificationPublishResult {
  readonly notificationId: string
  readonly duplicated: boolean
  readonly channels: readonly SystemNotificationPublishChannelResult[]
  readonly warnings: readonly { readonly code: NotificationPublishWarningCode, readonly message: string }[]
}

export const MAX_NOTIFICATION_TTL_SECONDS = 7 * 24 * 60 * 60
export const DEFAULT_NOTIFICATION_TTL_SECONDS = 24 * 60 * 60
export const MAX_NOTIFICATION_TEMPLATE_LENGTH = 2_000
export const MAX_NOTIFICATION_VARIABLES = 20
export const MAX_NOTIFICATION_VARIABLE_LENGTH = 200
export const MAX_NOTIFICATION_DEDUPE_KEY_LENGTH = 200

export function notificationDomainOf(eventType: string): NotificationDomain | null {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_EVENT_DOMAIN, eventType)
    ? NOTIFICATION_EVENT_DOMAIN[eventType as NotificationEventType]
    : null
}

export type AssistantTransportResult =
  | { readonly ok: true, readonly msgId: string | null, readonly newMsgId: string | null }
  | {
    readonly ok: false
    readonly kind: 'TIMEOUT' | 'NETWORK' | 'REJECTED' | 'OFFLINE' | 'RATE_LIMITED' | 'UNKNOWN'
    readonly code: string
    readonly message: string
  }

export interface AssistantTransport {
  sendText(input: {
    readonly appId: string
    readonly toWxid: string
    readonly content: string
    readonly ats?: string
  }): Promise<AssistantTransportResult>
}

export const ASSISTANT_TRANSPORT = Symbol('ASSISTANT_TRANSPORT')
export const ASSISTANT_TRANSPORT_OPTIONS = Symbol('ASSISTANT_TRANSPORT_OPTIONS')
export const ASSISTANT_ADMIN_TRANSPORT = Symbol('ASSISTANT_ADMIN_TRANSPORT')

export interface AssistantBriefContact {
  readonly wxid: string
  readonly nickname: string | null
  readonly remark: string | null
  readonly alias: string | null
  readonly avatarUrl: string | null
}

export interface AssistantChatroomInfo {
  readonly nickname: string | null
  readonly avatarUrl: string | null
  readonly memberCount: number | null
}

export interface AssistantChatroomMember {
  readonly wxid: string
  readonly nickname: string | null
  readonly displayName: string | null
  readonly avatarUrl: string | null
  readonly inviterName: string | null
  readonly role: 'ADMIN' | 'MEMBER' | 'OWNER'
}

export interface AssistantAdminTransport {
  /** 只读探测节点在线状态；账号登录、重连和退出都在 GeWe 控制台完成。 */
  checkOnline(appId: string): Promise<boolean>
  fetchContactIds(appId: string): Promise<{ readonly friends: readonly string[], readonly chatrooms: readonly string[] }>
  fetchBriefInfo(appId: string, wxids: readonly string[]): Promise<readonly AssistantBriefContact[]>
  fetchChatroomInfo(appId: string, chatroomId: string): Promise<AssistantChatroomInfo>
  fetchChatroomMembers(appId: string, chatroomId: string): Promise<readonly AssistantChatroomMember[]>
  getOwnQrCode(appId: string): Promise<string>
  checkRelations(appId: string, wxids: readonly string[]): Promise<readonly { readonly wxid: string, readonly relation: number }[]>
}

export class AssistantAdminError extends Error {
  constructor(
    readonly code: string,
    readonly kind: string,
    message: string,
  ) {
    super(message)
    this.name = 'AssistantAdminError'
  }
}
